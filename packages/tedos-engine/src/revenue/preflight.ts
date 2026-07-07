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
}

/** Returns the final HTTP status of a URL (redirects followed). */
export type UrlFetcher = (url: string) => Promise<{ status: number }>;

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
  const spfOk = /v=spf1/i.test(spf);
  const dkimOk = /(v=DKIM1|p=[A-Za-z0-9])/i.test(dkim);
  const dmarcOk = /v=DMARC1/i.test(dmarc);
  const firstLine = (s: string) => s.split("\n")[0] ?? "";
  const lastLine = (s: string) => { const p = s.split("\n"); return p[p.length - 1] ?? ""; };
  return [
    { id: "dns-spf", label: "DNS · SPF", ok: spfOk, blocking: true, detail: spfOk ? firstLine(spf) : `kein SPF-Record für ${domain}` },
    { id: "dns-dkim", label: "DNS · DKIM", ok: dkimOk, blocking: true, detail: dkimOk ? `Key veröffentlicht (${DKIM_SELECTOR})` : `kein DKIM-Key ${DKIM_SELECTOR}._domainkey.${domain}` },
    { id: "dns-dmarc", label: "DNS · DMARC", ok: dmarcOk, blocking: true, detail: dmarcOk ? lastLine(dmarc) : `kein DMARC-Record für _dmarc.${domain}` },
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
  }

  // 3–7) Approval queue → approved-only → opt-out → dedupe → batch limit.
  const statusMap = loadLeadStatus(opts.storage);
  const accounts = opts.accounts ?? loadAccounts(opts.accountsPath);
  const sel = selectSendable(accounts, statusMap, opts.batchSize);

  checks.push({ id: "approval-queue", label: "Approval Queue geladen", ok: accounts.length > 0, blocking: true, detail: accounts.length > 0 ? `${accounts.length} CRM-Leads · ${Object.keys(statusMap).length} mit Status` : "keine CRM-Leads geladen" });
  checks.push({ id: "approved-only", label: "Nur 'approved' berücksichtigt", ok: sel.approved > 0, blocking: true, detail: `${sel.approved} approved` });
  checks.push({ id: "opt-out", label: "Opt-out ausgeschlossen", ok: true, blocking: false, detail: `${sel.blockedUnsub} abgemeldete Kontakte blockiert` });
  checks.push({ id: "dedupe", label: "Doppelte Empfänger ausgeschlossen", ok: true, blocking: false, detail: `${sel.dupDropped} Duplikate · ${sel.noEmailDropped} ohne Adresse entfernt` });
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
