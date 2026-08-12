// Inbox measurement layer — READ-ONLY IMAP scan of the sending mailbox.
//
// Connects to the IONOS mailbox (ted@heycarbo.com), opens INBOX in READ-ONLY
// mode (never deletes, moves, or flags anything), scans messages since a cutoff
// date, and classifies each into: bounce (hard/soft), auto-reply (out-of-office),
// opt-out request, or a genuine human reply. Computes the bounce rate against the
// number of mails actually sent in the campaign window.
//
//   TEDOS_STORAGE_PATH=./.revenue-state \
//   IMAP_HOST=imap.ionos.de IMAP_PORT=993 \
//   IMAP_USER=ted@heycarbo.com IMAP_PASS=… \
//   INBOX_SINCE=2026-07-20 npm run inbox:scan
//
// Falls back to SMTP_USER/SMTP_PASS when IMAP_USER/IMAP_PASS are unset (IONOS
// uses one mailbox password for both SMTP and IMAP).

import { writeFileSync } from "node:fs";

import { ImapFlow } from "imapflow";

import { createStorage } from "./../storage.js";
import { loadAccounts } from "./accounts.js";
import { markBounced, unsubscribeLead, recordInboxScan } from "./batch-send.js";
import { isOptOutMessage } from "./inbox-classify.js";

/** Opt-in write mode: suppress hard-bounced addresses in the lead store. */
const WRITE_SUPPRESSION = process.argv.includes("--write-suppression");
/** Opt-in triage dump — also collects a body excerpt per bounce. */
const DUMP_BOUNCES = process.argv.includes("--dump-bounces");

const HOST = process.env.IMAP_HOST ?? "imap.ionos.de";
const PORT = Number(process.env.IMAP_PORT ?? 993);
const USER = process.env.IMAP_USER ?? process.env.SMTP_USER ?? "";
const PASS = process.env.IMAP_PASS ?? process.env.SMTP_PASS ?? "";
const SINCE = process.env.INBOX_SINCE ?? "2026-07-20";
/** How many campaign mails were sent in the window (for the bounce-rate denominator). */
const SENT_IN_WINDOW = Number(process.env.INBOX_SENT_COUNT ?? 0);

type Kind = "bounce" | "auto-reply" | "opt-out" | "reply" | "other";

interface Classified {
  kind: Kind;
  from: string;
  subject: string;
  date: string;
  /** For bounces: the recipient address that failed, if parseable. */
  failedRecipient?: string;
  /** For bounces: 5.x.x = permanent (suppress), 4.x.x = temporary (retryable). */
  bounceType?: "hard" | "soft";
  /** RFC 3463 enhanced status code, e.g. "5.1.1" (no such mailbox). */
  dsnStatus?: string;
  /** Remote server's diagnostic text, trimmed — tells apart bad address vs block. */
  diagnostic?: string;
  /** Body excerpt, only populated for --dump-bounces (triage of unparsed reasons). */
  excerpt?: string;
}

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (subsystem|system)|delivery status)/i;
const BOUNCE_SUBJECT = /(mail delivery failed|undelivered mail|delivery status notification|failure notice|returned mail|unzustellbar|delivery has failed|could not be delivered|mail delivery system)/i;
const AUTOREPLY_SUBJECT = /(out of office|abwesenheit|automatische antwort|auto[- ]?reply|autoreply|außer haus|ooo|nicht im (b|B)üro|urlaub|vacation)/i;

/** Our own addresses — never the "failed recipient" of one of our bounces. */
const SELF = /(heycarbo\.com|heyaudit\.de|mailer-daemon|postmaster)/i;

/**
 * Pull the failed recipient out of a bounce.
 *
 * A DSN carries the address in a structured field (RFC 3464 `Final-Recipient` /
 * `Original-Recipient`, or the `X-Failed-Recipients` header). Those are the only
 * trustworthy sources: taking the first address in the raw source instead yields
 * the mailer-daemon or our own From, which is what made every bounce look like
 * it came from the same 16 "recipients".
 */
function extractFailedRecipient(source: string): string | undefined {
  const structured = [
    /^final-recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/im,
    /^original-recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/im,
    /^x-failed-recipients:\s*<?([^\s<>,;]+@[^\s<>,;]+)>?/im,
  ];
  for (const re of structured) {
    const m = source.match(re);
    if (m?.[1] && !SELF.test(m[1])) return m[1].toLowerCase();
  }
  // Fallback: first address in the body that is neither ours nor a daemon.
  for (const m of source.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) {
    if (!SELF.test(m[0])) return m[0].toLowerCase();
  }
  return undefined;
}

/** RFC 3463 enhanced status code from the DSN part, when present. */
function extractDsnStatus(source: string): string | undefined {
  return source.match(/^status:\s*([45]\.\d+\.\d+)/im)?.[1];
}

/**
 * The remote server's own explanation. This is what separates a wrong address
 * (5.1.1 "user unknown") from our sender being blocked (5.7.1 "policy") — the
 * first needs data repair, the second needs deliverability work.
 */
function extractDiagnostic(source: string): string | undefined {
  const dsn = source.match(/^diagnostic-code:\s*(?:smtp;)?\s*([^\r\n]+(?:\r?\n[ \t][^\r\n]+)*)/im);
  if (dsn?.[1]) return dsn[1].replace(/\s+/g, " ").trim().slice(0, 180);

  // NOTE: IONOS' own generic bounce ("Your email could not be delivered")
  // carries NO server reason at all — only boilerplate ("There may be a typo…").
  // For those the reason is simply not recoverable from the mailbox; do not
  // invent one. Roughly 80 % of our bounces are of this kind.
  //
  // Fallback for real remote DSNs that quote the SMTP status inline.
  const smtpLine = source.match(/^\s*(?:>>> )?([45]\d{2}[- ][^\r\n]{5,160})/im);
  return smtpLine?.[1].replace(/\s+/g, " ").trim();
}

/** Permanent (5.x.x) vs temporary (4.x.x) failure — only hard bounces suppress. */
function classifyBounceType(source: string): "hard" | "soft" {
  const status = source.match(/^status:\s*([45])\.\d+\.\d+/im);
  if (status) return status[1] === "5" ? "hard" : "soft";
  if (/\b5\d{2}[- ]/.test(source)) return "hard";
  if (/\b4\d{2}[- ]/.test(source)) return "soft";
  return "soft"; // unknown → never suppress on a guess
}

async function main(): Promise<void> {
  if (!USER || !PASS) {
    console.log("⚠ IMAP-Zugang fehlt: setze IMAP_USER/IMAP_PASS (oder SMTP_USER/SMTP_PASS). Abbruch.");
    process.exitCode = 1;
    return;
  }

  const client = new ImapFlow({
    host: HOST, port: PORT, secure: true,
    auth: { user: USER, pass: PASS },
    logger: false,
  });

  const results: Classified[] = [];
  await client.connect();
  console.log(`✅ IMAP verbunden: ${USER}@${HOST}:${PORT}`);

  // READ-ONLY lock — nothing in the mailbox is ever modified.
  const lock = await client.getMailboxLock("INBOX", { readonly: true });
  try {
    const sinceDate = new Date(SINCE + "T00:00:00Z");
    const uids = await client.search({ since: sinceDate }, { uid: true });
    console.log(`📥 ${uids.length} Nachrichten seit ${SINCE} im Posteingang\n`);

    if (uids.length) {
      for await (const msg of client.fetch(
        { uid: uids.join(",") },
        { uid: true, envelope: true, source: true },
      )) {
        const from = msg.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
        const fromName = msg.envelope?.from?.[0]?.name ?? "";
        const subject = msg.envelope?.subject ?? "";
        const date = msg.envelope?.date?.toISOString?.() ?? "";
        const source = msg.source?.toString("utf8") ?? "";
        const autoSubmitted = /auto-submitted:\s*(auto-replied|auto-generated)/i.test(source);

        let kind: Kind = "other";
        let failedRecipient: string | undefined;
        let bounceType: "hard" | "soft" | undefined;
        let dsnStatus: string | undefined;
        let diagnostic: string | undefined;
        let excerpt: string | undefined;

        if (BOUNCE_FROM.test(from) || BOUNCE_FROM.test(fromName) || BOUNCE_SUBJECT.test(subject)) {
          kind = "bounce";
          failedRecipient = extractFailedRecipient(source) ?? extractFailedRecipient(subject);
          bounceType = classifyBounceType(source);
          dsnStatus = extractDsnStatus(source);
          diagnostic = extractDiagnostic(source);
          // Body only — the headers are ~700 chars of DKIM/Received noise.
          if (DUMP_BOUNCES) excerpt = source.split(/\r?\n\r?\n/).slice(1).join(" ").replace(/\s+/g, " ").slice(0, 1200);
        } else if (AUTOREPLY_SUBJECT.test(subject) || autoSubmitted) {
          kind = "auto-reply";
        } else if (isOptOutMessage(subject, source)) {
          kind = "opt-out";
        } else if (from && !from.includes("heycarbo.com")) {
          // Inbound from a real external sender that isn't a bounce/auto — a human reply.
          kind = "reply";
        }

        results.push({
          kind, from, subject, date,
          ...(failedRecipient ? { failedRecipient } : {}),
          ...(bounceType ? { bounceType } : {}),
          ...(dsnStatus ? { dsnStatus } : {}),
          ...(diagnostic ? { diagnostic } : {}),
          ...(excerpt ? { excerpt } : {}),
        });
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  // === Aggregate ============================================================
  const by: Record<Kind, Classified[]> = { bounce: [], "auto-reply": [], "opt-out": [], reply: [], other: [] };
  for (const r of results) by[r.kind].push(r);

  const bounceRecipients = new Set(by.bounce.map((b) => b.failedRecipient).filter(Boolean) as string[]);
  const hardRecipients = new Set(
    by.bounce.filter((b) => b.bounceType === "hard" && b.failedRecipient).map((b) => b.failedRecipient as string),
  );
  const denom = SENT_IN_WINDOW || results.length || 1;
  const bounceRate = (by.bounce.length / denom) * 100;

  const L: string[] = [];
  L.push("── Inbox-Messung (read-only) ──────────────────────────────");
  L.push(`Fenster ab           : ${SINCE}`);
  L.push(`Gesendete Mails (Nenner): ${SENT_IN_WINDOW || "(unbekannt → Inbox-Treffer als Nenner)"}`);
  L.push(`Eingegangen gesamt   : ${results.length}`);
  L.push(`  • Bounces          : ${by.bounce.length}  (eindeutige Empfänger: ${bounceRecipients.size} · davon hart: ${hardRecipients.size})`);
  L.push(`  • Auto-Replies     : ${by["auto-reply"].length}`);
  L.push(`  • Opt-out-Wünsche  : ${by["opt-out"].length}`);
  L.push(`  • Echte Antworten  : ${by.reply.length}`);
  L.push(`  • Sonstiges        : ${by.other.length}`);
  L.push(`Bounce-Rate          : ${bounceRate.toFixed(2)} %  ${bounceRate > 3 ? "⛔ ÜBER 3 % — Rollout stoppen!" : "✅ unter 3 %"}`);
  L.push("───────────────────────────────────────────────────────────");
  if (by.bounce.length) {
    L.push("Bounces (Empfänger):");
    for (const b of by.bounce) L.push(`  ✗ ${b.failedRecipient ?? "?"}  — ${b.subject.slice(0, 60)}`);
  }
  if (by["opt-out"].length) {
    L.push("Opt-out-Wünsche:");
    for (const o of by["opt-out"]) L.push(`  ⊘ ${o.from}  — ${o.subject.slice(0, 60)}`);
  }
  if (by.reply.length) {
    L.push("Echte Antworten:");
    for (const r of by.reply) L.push(`  ✉ ${r.from}  — ${r.subject.slice(0, 70)}`);
  }
  console.log("\n" + L.join("\n"));

  // === Optional: dump every bounce with its DSN reason (for triage) =========
  const dumpIdx = process.argv.indexOf("--dump-bounces");
  if (dumpIdx > -1 && process.argv[dumpIdx + 1]) {
    const csv = ["empfaenger;typ;dsn_status;diagnose;betreff;rohtext_auszug"].concat(
      by.bounce.map((b) => [
        b.failedRecipient ?? "?", b.bounceType ?? "?", b.dsnStatus ?? "",
        b.diagnostic ?? "", b.subject, b.excerpt ?? "",
      ].map((v) => String(v).replaceAll(";", ",")).join(";")),
    );
    writeFileSync(process.argv[dumpIdx + 1], csv.join("\n"), "utf8");
    console.log(`\n📄 Bounce-Dump: ${process.argv[dumpIdx + 1]} (${by.bounce.length} Zeilen)`);
  }

  // === Optional: suppress hard-bounced addresses in the lead store ==========
  // Read-only by default. Only permanent (5.x.x) failures are suppressed —
  // a full mailbox or a greylisting 4.x.x must stay sendable.
  if (!hardRecipients.size) {
    console.log("\nℹ Keine hart gebouncten Empfänger eindeutig zuordenbar — nichts zu unterdrücken.");
    return;
  }
  const accounts = loadAccounts();
  const matched: { id: string; email: string; company: string }[] = [];
  for (const a of accounts) {
    const email = (a.email ?? "").trim().toLowerCase();
    if (email && hardRecipients.has(email)) matched.push({ id: a.id, email, company: a.company ?? a.id });
  }
  const unmatched = [...hardRecipients].filter((e) => !matched.some((m) => m.email === e));

  console.log(`\n── Hard-Bounce-Unterdrückung ${WRITE_SUPPRESSION ? "(SCHREIBEND)" : "(Vorschau — mit --write-suppression anwenden)"} ──`);
  console.log(`Hart gebouncte Adressen : ${hardRecipients.size}`);
  console.log(`Im CRM zugeordnet       : ${matched.length} Lead(s)`);
  console.log(`Ohne CRM-Treffer        : ${unmatched.length}${unmatched.length ? " → " + unmatched.slice(0, 10).join(", ") : ""}`);
  for (const m of matched.slice(0, 40)) console.log(`  ✗ ${m.id.padEnd(9)} ${m.email.padEnd(38)} ${m.company.slice(0, 40)}`);

  if (!WRITE_SUPPRESSION) {
    console.log("\nℹ Vorschau — es wurde nichts geschrieben.");
    return;
  }
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("\n⚠ TEDOS_STORAGE_PATH nicht gesetzt — der In-Memory-Store würde sofort verfallen. Abbruch.");
    process.exitCode = 1;
    return;
  }
  const storage = createStorage();
  const changed = markBounced(storage, matched.map((m) => m.id), new Date().toISOString());
  console.log(`\n✅ ${changed} Lead(s) auf "bounced" gesetzt — ab sofort vom Versand ausgeschlossen.`);

  // Opt-outs are suppressions too. Until now they were only printed, so a
  // recipient who replied "Abmelden" stayed contactable — the exact outcome an
  // opt-out must never have. Written under the same --write-suppression gate.
  // `from` is already the bare, lower-cased envelope address.
  const optOutSenders = new Set(by["opt-out"].map((o) => o.from).filter(Boolean));
  const optOutMatched: { id: string; email: string; company: string }[] = [];
  for (const a of accounts) {
    const email = (a.email ?? "").trim().toLowerCase();
    if (email && optOutSenders.has(email)) {
      optOutMatched.push({ id: a.id, email, company: a.company ?? a.id });
    }
  }
  const optOutUnmatched = [...optOutSenders].filter((e) => !optOutMatched.some((m) => m.email === e));

  console.log(`\n── Opt-out-Unterdrückung ──`);
  console.log(`Opt-out-Absender        : ${optOutSenders.size}`);
  console.log(`Im CRM zugeordnet       : ${optOutMatched.length} Lead(s)`);
  if (optOutUnmatched.length) {
    // An opt-out we cannot map to a lead is one we owe someone and cannot
    // honour automatically — it must be visible, never silently dropped.
    console.log(`⚠ OHNE CRM-Treffer      : ${optOutUnmatched.length} → ${optOutUnmatched.slice(0, 10).join(", ")}`);
    console.log(`  Diese Adressen manuell sperren — sie sind sonst weiterhin versendbar.`);
  }
  let optOutWritten = 0;
  for (const m of optOutMatched) {
    if (unsubscribeLead(storage, m.id, "Opt-out (Reply)", () => new Date().toISOString(), true)) {
      optOutWritten += 1;
      console.log(`  ⊘ ${m.id.padEnd(9)} ${m.email.padEnd(38)} ${m.company.slice(0, 40)}`);
    }
  }
  console.log(`\n✅ ${optOutWritten} Lead(s) auf "unsubscribed" gesetzt — dauerhaft gesperrt.`);

  // Lauf festhalten: der Follow-up-Versand verweigert den Dienst, solange kein
  // frischer Scan vorliegt — sonst stünden Antwortende noch auf "sent".
  recordInboxScan(storage, {
    at: new Date().toISOString(),
    bounces: changed,
    optOuts: optOutWritten,
    replies: by.reply.length,
  });
  console.log(`📌 Scan-Zeitpunkt festgehalten — Nachfassen ist damit für 72 h freigegeben.`);
}

main().catch((e) => { console.error("inbox-scan failed:", (e as Error).message); process.exitCode = 1; });
