// PRE-SEND PREFLIGHT — the fixed gate that runs before every productive batch.
//
// It bundles the eight mandatory checks into one pass/fail result. The runner
// (batch-send-run.ts) aborts the send if any BLOCKING check fails, so a batch
// can only go out when the full contract is green:
//
//   1. SMTP connection            (verify(), only when armed + provider=smtp)
//   2. DNS: SPF / DKIM / DMARC     (published records for the sender domain)
//   3. Approval queue loaded       (CRM + status store readable)
//   4. Approved-only               (at least one lead marked "approved")
//   5. Opt-out excluded            (unsubscribed contacts filtered out)
//   6. Duplicate recipients        (unique addresses only)
//   7. Batch limit                 (something to send within the cap)
//   8. Report file                 (durable per-batch artefact created)
//
// Checks 3–7 reuse selectSendable() — the SAME selector the send uses — so the
// preflight can never clear a different set than what actually dispatches.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Storage } from "./../storage.js";
import { type Account, loadAccounts } from "./accounts.js";
import { loadLeadStatus, selectSendable } from "./batch-send.js";
import { activeBrandProfile } from "./brand-profile.js";
import { ensureReportDir, reportStem, writeReportFile } from "./report-file.js";

const pexecFile = promisify(execFile);

export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  /** A failed blocking check aborts the send; a non-blocking one only warns. */
  blocking: boolean;
  detail: string;
}

export interface PreflightEligibility {
  approved: number;
  withEmail: number;
  afterDedupe: number;
  /** Approved leads dropped because an earlier batch already reached the address. */
  contactedDropped: number;
  toSend: number;
  dupDropped: number;
  noEmailDropped: number;
  blockedUnsub: number;
}

export interface PreflightResult {
  ok: boolean;
  timestamp: string;
  domain: string;
  batchSize: number;
  checks: PreflightCheck[];
  eligibility: PreflightEligibility;
  reportStem: string;
  reportDir: string;
}

export interface PreflightOptions {
  storage: Storage;
  batchSize: number;
  /** Sender address — its domain is what SPF/DKIM/DMARC are checked against. */
  senderEmail: string;
  /** selectedProviderName() — decides whether the SMTP verify runs. */
  provider: string;
  /** isSendArmed() — the SMTP verify only runs for a real, armed send. */
  armed: boolean;
  accounts?: Account[];
  accountsPath?: string;
  campaignLabel?: string;
  dryRun?: boolean;
  clock?: () => string;
  /** Skip the network checks (SMTP + DNS + URLs) — for unit tests. */
  skipNetwork?: boolean;
  /** URLs to validate (defaults to the active brand's landing pages). */
  urls?: { label: string; url: string }[];
  /** Injectable URL fetcher (defaults to a real GET with redirect-follow). */
  urlFetch?: UrlFetcher;
  /** Injectable MX resolver (defaults to the system resolver). */
  mxResolve?: MxResolver;
}

/** Returns the final HTTP status of a URL (redirects followed). */
export type UrlFetcher = (url: string) => Promise<{ status: number }>;

/** Resolves a domain's MX records. Injectable so the check is testable offline. */
export type MxResolver = (domain: string) => Promise<string[]>;

/**
 * A recipient domain without an MX record can never accept mail — every send to
 * it is a guaranteed bounce, and guaranteed bounces are what pushed the campaign
 * over the 3 % threshold. Non-blocking on purpose: one bad address must not stop
 * the other nineteen, but it is named so it can be rejected before the next run.
 */
export async function recipientMxCheck(
  emails: string[],
  resolve: MxResolver,
): Promise<PreflightCheck> {
  const byDomain = new Map<string, string[]>();
  for (const e of emails) {
    const d = e.split("@")[1]?.toLowerCase();
    if (d) byDomain.set(d, [...(byDomain.get(d) ?? []), e]);
  }
  const dead: string[] = [];
  await Promise.all([...byDomain.keys()].map(async (d) => {
    try {
      const mx = await resolve(d);
      if (!mx.length) dead.push(d);
    } catch {
      dead.push(d); // NXDOMAIN or resolver failure — treat as undeliverable
    }
  }));
  const affected = dead.flatMap((d) => byDomain.get(d) ?? []);
  return {
    id: "dns-recipients",
    label: "Empfänger-Domains mit MX",
    ok: affected.length === 0,
    blocking: false,
    detail: affected.length === 0
      ? `${byDomain.size} Domains geprüft · alle nehmen Mail an`
      : `${affected.length} Empfänger auf ${dead.length} Domain(s) OHNE MX — sicherer Bounce: ${affected.slice(0, 8).join(", ")}`,
  };
}

/** Real MX lookup via the system resolver. */
export async function dnsMxResolver(domain: string): Promise<string[]> {
  const { resolveMx } = await import("node:dns/promises");
  return (await resolveMx(domain)).map((r) => r.exchange);
}

/** The four outbound landing pages a productive batch links to (active brand). */
export function brandSendUrls(): { label: string; url: string }[] {
  const u = activeBrandProfile().urls;
  return [
    { label: "signup", url: u.trialUrl },
    { label: "impressum", url: u.imprintUrl },
    { label: "datenschutz", url: u.privacyUrl },
    { label: "abmelden", url: u.unsubscribeBase },
  ];
}

/** Real HTTP fetcher: GET, follow redirects, timeout; returns the FINAL status. */
export async function httpUrlFetcher(url: string, timeoutMs = 8000): Promise<{ status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    return { status: res.status };
  } finally {
    clearTimeout(t);
  }
}

/** Validate each landing page — ONLY a final HTTP 200 is accepted (blocking). */
export async function urlChecks(
  items: { label: string; url: string }[],
  fetchFn: UrlFetcher,
): Promise<PreflightCheck[]> {
  return Promise.all(
    items.map(async ({ label, url }) => {
      try {
        const { status } = await fetchFn(url);
        const ok = status === 200;
        return { id: `url-${label}`, label: `URL · /${label}`, ok, blocking: true, detail: ok ? `200 OK · ${url}` : `HTTP ${status} · ${url}` };
      } catch (e) {
        return { id: `url-${label}`, label: `URL · /${label}`, ok: false, blocking: true, detail: `nicht erreichbar · ${url} · ${(e as Error).message}` };
      }
    }),
  );
}

/**
 * Prüft, ob das Opt-out-Register wirklich funktioniert.
 *
 * Die bisherige URL-Prüfung fragt nur `unsubscribeBase` ab — und die liefert
 * HTTP 200, selbst wenn die Abmeldung defekt ist: vercel.json leitet jeden
 * Pfad auf index.html, die SPA rendert dann ihre 404-Seite. Genau so konnten
 * ~1.715 Mails mit einem toten Abmeldelink rausgehen, ohne dass der Preflight
 * anschlug.
 *
 * Deshalb wird hier der Speicher selbst geprüft: ein lesender GET gegen den
 * Endpunkt (Service-Role, read-only, schreibt nichts). Antwortet er 5xx, fehlt
 * die Tabelle — dann darf kein Batch laufen, weil die gesetzlich zwingende
 * Abmeldung (§ 7 UWG, Art. 21 DSGVO) nicht erfasst würde.
 */
export async function optOutRegisterCheck(
  postUrl: string | undefined,
  serviceKey: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<PreflightCheck> {
  const id = "optout-register";
  const label = "Abmelde-Register erreichbar";
  if (!postUrl) {
    return { id, label, ok: false, blocking: true, detail: "kein Opt-out-Endpunkt konfiguriert (brand profile urls.unsubscribePostUrl)" };
  }
  if (!serviceKey) {
    return { id, label, ok: false, blocking: true, detail: "SUPABASE_SERVICE_ROLE_KEY nicht gesetzt — Register nicht prüfbar, Versand nicht freigegeben" };
  }
  try {
    const res = await fetchFn(`${postUrl}?since=2099-01-01T00:00:00Z`, {
      method: "GET",
      headers: { authorization: `Bearer ${serviceKey}` },
    });
    if (res.status >= 500) {
      return { id, label, ok: false, blocking: true, detail: `HTTP ${res.status} — Register nicht verfügbar (Migration 151 angewendet?). Abmeldungen würden verloren gehen.` };
    }
    if (res.status === 401 || res.status === 403) {
      return { id, label, ok: false, blocking: true, detail: `HTTP ${res.status} — Service-Role-Key wird abgelehnt` };
    }
    if (!res.ok) {
      return { id, label, ok: false, blocking: true, detail: `HTTP ${res.status} — unerwartete Antwort des Registers` };
    }
    return { id, label, ok: true, blocking: true, detail: "Register antwortet, Abmeldungen werden gespeichert" };
  } catch (e) {
    return { id, label, ok: false, blocking: true, detail: `nicht erreichbar — ${(e as Error).message}` };
  }
}

/** DKIM selector to probe (IONOS default). Override for other mail hosts. */
const DKIM_SELECTOR = process.env.REVENUE_DKIM_SELECTOR ?? "s1-ionos";

async function dig(type: string, name: string): Promise<string> {
  try {
    const { stdout } = await pexecFile("dig", ["+short", type, name], { timeout: 8000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

/** SPF / DKIM / DMARC checks against the published DNS for `domain`. */
async function dnsChecks(domain: string): Promise<PreflightCheck[]> {
  const [spf, dkim, dmarc] = await Promise.all([
    dig("TXT", domain),
    dig("TXT", `${DKIM_SELECTOR}._domainkey.${domain}`),
    dig("TXT", `_dmarc.${domain}`),
  ]);
  return evaluateDnsRecords({ domain, spf, dkim, dmarc, selector: DKIM_SELECTOR });
}

/**
 * Pure evaluation of the three mail-auth record sets — split out from the `dig`
 * call so the parsing (especially the multi-SPF hazard) is testable.
 */
export function evaluateDnsRecords(
  { domain, spf, dkim, dmarc, selector }:
  { domain: string; spf: string; dkim: string; dmarc: string; selector: string },
): PreflightCheck[] {
  // Pick the RELEVANT record out of the TXT set. A domain typically also carries
  // site-verification strings; showing the first line displayed those instead of
  // the SPF policy. And RFC 7208 §3.2 allows exactly ONE SPF record — two make
  // every receiver return PERMERROR, which silently destroys deliverability, so
  // "a v=spf1 exists somewhere" is not a sufficient check.
  const linesMatching = (s: string, re: RegExp) =>
    s.split("\n").map((l) => l.trim()).filter((l) => re.test(l));

  const spfRecords = linesMatching(spf, /v=spf1/i);
  const dmarcRecords = linesMatching(dmarc, /v=DMARC1/i);
  const spfOk = spfRecords.length === 1;
  const dkimOk = /(v=DKIM1|p=[A-Za-z0-9])/i.test(dkim);
  const dmarcOk = dmarcRecords.length >= 1;

  const spfDetail = spfRecords.length === 1
    ? (spfRecords[0] as string)
    : spfRecords.length === 0
      ? `kein SPF-Record für ${domain}`
      : `${spfRecords.length} SPF-Records für ${domain} — RFC 7208 erlaubt genau einen (führt zu PERMERROR)`;

  return [
    { id: "dns-spf", label: "DNS · SPF", ok: spfOk, blocking: true, detail: spfDetail },
    { id: "dns-dkim", label: "DNS · DKIM", ok: dkimOk, blocking: true, detail: dkimOk ? `Key veröffentlicht (${selector})` : `kein DKIM-Key ${selector}._domainkey.${domain}` },
    { id: "dns-dmarc", label: "DNS · DMARC", ok: dmarcOk, blocking: true, detail: dmarcOk ? (dmarcRecords[0] as string) : `kein DMARC-Record für _dmarc.${domain}` },
  ];
}

/** SMTP connection + login verify, mirroring the proven send:test transport. */
export async function verifySmtp(): Promise<{ ok: boolean; detail: string }> {
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]);
  if (missing.length) return { ok: false, detail: `SMTP-Konfig unvollständig: ${missing.join(", ")} fehlt` };
  try {
    const mod = "nodemailer";
    const nodemailer = (await import(mod).catch(() => null)) as any;
    if (!nodemailer) return { ok: false, detail: "nodemailer nicht installiert" };
    const secure = process.env.SMTP_SECURE === "1";
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? (secure ? 465 : 587)),
      secure,
      requireTLS: !secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: false, maxConnections: 1, maxMessages: 1,
      connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    await transport.verify();
    transport.close();
    return { ok: true, detail: `SMTP-Verbindung OK (${process.env.SMTP_HOST}:${process.env.SMTP_PORT})` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** Run the full preflight and return a pass/fail with every check's detail. */
export async function runPreflight(opts: PreflightOptions): Promise<PreflightResult> {
  const clock = opts.clock ?? (() => new Date().toISOString());
  const timestamp = clock();
  const domain = opts.senderEmail.split("@")[1] ?? "";
  const checks: PreflightCheck[] = [];

  // 1) SMTP connection — only meaningful for a real, armed SMTP send.
  if (opts.provider === "smtp" && opts.armed && !opts.dryRun && !opts.skipNetwork) {
    const v = await verifySmtp();
    checks.push({ id: "smtp", label: "SMTP-Verbindung", ok: v.ok, blocking: true, detail: v.detail });
  } else {
    const why = opts.skipNetwork ? "übersprungen (Test)"
      : opts.dryRun ? "Dry-Run — kein SMTP nötig"
      : !opts.armed ? "Master-Switch OFF — Dry-Run"
      : `Provider ${opts.provider} (kein SMTP-Verify)`;
    checks.push({ id: "smtp", label: "SMTP-Verbindung", ok: true, blocking: true, detail: why });
  }

  // 2) DNS: SPF / DKIM / DMARC.
  if (opts.skipNetwork || !domain) {
    checks.push({ id: "dns", label: "DNS (SPF/DKIM/DMARC)", ok: !!domain, blocking: true, detail: domain ? "übersprungen (Test)" : "keine Absender-Domain" });
  } else {
    checks.push(...(await dnsChecks(domain)));
  }

  // 2b) Landing pages — /signup /impressum /datenschutz /abmelden must return 200.
  if (opts.skipNetwork) {
    checks.push({ id: "urls", label: "Landingpages (200)", ok: true, blocking: true, detail: "übersprungen (Test)" });
  } else {
    const urls = opts.urls ?? brandSendUrls();
    checks.push(...(await urlChecks(urls, opts.urlFetch ?? ((u) => httpUrlFetcher(u)))));
    // Die Landingpage-Prüfung oben kann eine kaputte Abmeldung nicht sehen
    // (SPA-Fallback liefert 200) — das Register wird separat geprüft.
    checks.push(await optOutRegisterCheck(
      process.env.REVENUE_UNSUBSCRIBE_POST_URL ?? activeBrandProfile().urls.unsubscribePostUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ));
  }

  // 3–7) Approval queue → approved-only → opt-out → dedupe → batch limit.
  const statusMap = loadLeadStatus(opts.storage);
  const accounts = opts.accounts ?? loadAccounts(opts.accountsPath);
  const sel = selectSendable(accounts, statusMap, opts.batchSize);

  checks.push({ id: "approval-queue", label: "Approval Queue geladen", ok: accounts.length > 0, blocking: true, detail: accounts.length > 0 ? `${accounts.length} CRM-Leads · ${Object.keys(statusMap).length} mit Status` : "keine CRM-Leads geladen" });
  checks.push({ id: "approved-only", label: "Nur 'approved' berücksichtigt", ok: sel.approved > 0, blocking: true, detail: `${sel.approved} approved` });
  checks.push({ id: "opt-out", label: "Opt-out ausgeschlossen", ok: true, blocking: false, detail: `${sel.blockedUnsub} abgemeldete Kontakte blockiert` });
  checks.push({ id: "dedupe", label: "Doppelte Empfänger ausgeschlossen", ok: true, blocking: false, detail: `${sel.dupDropped} Duplikate · ${sel.noEmailDropped} ohne Adresse entfernt` });
  checks.push({ id: "already-contacted", label: "Bereits kontaktierte Adressen ausgeschlossen", ok: true, blocking: false, detail: `${sel.contactedDropped} Adressen aus früheren Batches entfernt` });
  if (!opts.skipNetwork) {
    checks.push(await recipientMxCheck(
      sel.batch.map((a) => a.email as string),
      opts.mxResolve ?? dnsMxResolver,
    ));
  }
  checks.push({ id: "batch-limit", label: "Versandlimit", ok: sel.batch.length > 0, blocking: true, detail: `${sel.batch.length} zu senden (Limit ${opts.batchSize} · ${sel.afterDedupe} verfügbar)` });

  // 8) Report file — a durable per-batch artefact must be creatable.
  const stem = reportStem(opts.campaignLabel, timestamp);
  let reportDirPath = "";
  try {
    reportDirPath = ensureReportDir();
    checks.push({ id: "report-file", label: "Report-Datei angelegt", ok: true, blocking: false, detail: `${stem}.*` });
  } catch (e) {
    checks.push({ id: "report-file", label: "Report-Datei angelegt", ok: false, blocking: false, detail: (e as Error).message });
  }

  const ok = checks.filter((c) => c.blocking).every((c) => c.ok);
  const result: PreflightResult = {
    ok,
    timestamp,
    domain,
    batchSize: opts.batchSize,
    checks,
    eligibility: {
      approved: sel.approved,
      withEmail: sel.withEmail,
      afterDedupe: sel.afterDedupe,
      toSend: sel.batch.length,
      dupDropped: sel.dupDropped,
      contactedDropped: sel.contactedDropped,
      noEmailDropped: sel.noEmailDropped,
      blockedUnsub: sel.blockedUnsub,
    },
    reportStem: stem,
    reportDir: reportDirPath,
  };

  // Persist the preflight snapshot immediately (check 8's artefact).
  if (reportDirPath) {
    try { writeReportFile(stem, "preflight.json", JSON.stringify(result, null, 2)); } catch { /* non-fatal */ }
  }
  return result;
}

/** One-screen preflight summary for the CLI / logs. */
export function formatPreflight(r: PreflightResult): string {
  const L: string[] = [];
  L.push("── Preflight-Checks ───────────────────────────────────────");
  for (const c of r.checks) {
    L.push(`  ${c.ok ? "✅" : "⛔"} ${c.label}${c.blocking ? "" : " (nicht blockierend)"} — ${c.detail}`);
  }
  L.push(`  Eligible             : ${r.eligibility.approved} approved → ${r.eligibility.afterDedupe} nach Filter → ${r.eligibility.toSend} zu senden`);
  L.push(`  Ergebnis             : ${r.ok ? "✅ PREFLIGHT OK — Versand freigegeben" : "⛔ PREFLIGHT FEHLGESCHLAGEN — kein Versand"}`);
  L.push("───────────────────────────────────────────────────────────");
  return L.join("\n");
}
