// ONE-SHOT production-simulation send — EXACTLY ONE test email, IONOS SMTP,
// fully instrumented for QA (verify → send → SMTP response → auth/DNS → report).
//
// SAFETY (enforced by construction, aborts hard on any violation):
//   • Recipient is a hard-coded constant — not overridable by env or argv.
//   • transporter.verify() runs FIRST; on failure it aborts and sends nothing.
//   • Exactly ONE message — a counter refuses a second send. No batch, no loop,
//     no retry to other recipients (connections/retries are disabled).
//   • No real lead data is read (synthetic account).
//   • Sends only when REVENUE_SEND_ENABLED=1 AND SMTP is configured. The switch is
//     process-local (passed inline for one run) and is never persisted.
//
// Run it yourself (password stays in your shell):
//   REVENUE_SEND_ENABLED=1 REVENUE_EMAIL_PROVIDER=smtp \
//   SMTP_HOST=smtp.ionos.de SMTP_PORT=587 \
//   SMTP_USER=ted@heycarbo.com SMTP_PASS='••••' \
//   npx tsx src/revenue/send-test.ts

import nodemailer from "nodemailer";
import { resolveCname, resolveTxt } from "node:dns/promises";
import { normalize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";
import { buildCopy } from "./email-copy.js";
import { EMAIL_ASSETS } from "./email-template.js";
import { isSendArmed } from "./sending.js";

/** The ONE and ONLY address this script may ever send to. Not overridable. */
const RECIPIENT = "tedosammor@googlemail.com";

const now = (): number => Date.now();
function abort(reason: string): never {
  console.error(`\n⛔ ABBRUCH: ${reason}`);
  console.error("   Es wurde NICHTS gesendet.");
  process.exit(1);
}

// ── Guards on the recipient (constant + no env/argv injection) ─────────────────
if (RECIPIENT !== "tedosammor@googlemail.com") abort(`Empfänger nicht exakt erlaubt: "${RECIPIENT}"`);
for (const [k, v] of Object.entries(process.env)) {
  if (/^(SEND_TEST_TO|MAIL_TO|RECIPIENT|TO)$/i.test(k) && v && v !== RECIPIENT) abort(`Fremder Empfänger über Env "${k}" — nur ${RECIPIENT} erlaubt.`);
}
if (process.argv.slice(2).some((a) => a.includes("@") && a !== RECIPIENT)) abort("Fremde Empfänger-Adresse als Argument — abgelehnt.");

// ── Single-send guard: at most ONE sendMail, ever ──────────────────────────────
let sends = 0;

// A SYNTHETIC, representative account — NOT from the CRM (no real leads touched).
const account = normalize(
  { id: "SEND-TEST", name: "GRAFE GmbH", segment: "Automotive / Mobility", customers: ["BMW", "Bosch"], supplier_pressure: "BMW und Bosch fordern ISO-14067-PCF über Catena-X", catena_x_relevance: "high", email: RECIPIENT },
  0,
);
const o = buildOpportunity(account, () => new Date().toISOString(), "E");
const copy = buildCopy(account, "E");
const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "ted@heycarbo.com";
const replyTo = process.env.SMTP_REPLYTO ?? from;
const subject = o.subjects[0] ?? "HeyCarbo";
const text = [
  copy.greeting, "", copy.intro, "", copy.value, "", copy.closing, "",
  // Aus der Opportunity, nicht hartkodiert: der Testversand muss denselben CTA
  // zeigen wie der echte Batch, sonst prüft man etwas, das so nie rausgeht.
  `${o.ctaText}: ${o.ctaUrl}`,
  `Oder direkt eine 15-Minuten-Demo vereinbaren: ${EMAIL_ASSETS.calendlyUrl}`,
  "", "Ted Osammor · Co-Founder | HeyCarbo · Carbon.Made.Simple.",
  "ted@heycarbo.com · +49 221 95934702 · www.heycarbo.com",
].join("\n");

/** SPF/DKIM as visible from DNS (sender side). Actual pass/fail is in the received headers. */
async function authFromDns(domain: string): Promise<{ spf: string; dkim: string }> {
  let spf = "nicht ersichtlich";
  try {
    const rec = (await resolveTxt(domain)).map((t) => t.join("")).find((t) => /v=spf1/i.test(t));
    spf = rec ?? "kein SPF-Record";
  } catch { /* dns unavailable */ }
  let dkim = "nicht ersichtlich";
  try {
    const c = await resolveCname(`s42582890._domainkey.${domain}`);
    dkim = `Selektor s42582890 → ${c.join(", ")}`;
  } catch {
    try {
      if ((await resolveTxt(`s42582890._domainkey.${domain}`)).length) dkim = "DKIM-Record vorhanden (s42582890)";
    } catch { /* none */ }
  }
  return { spf, dkim };
}

async function main() {
  const secure = process.env.SMTP_SECURE === "1";
  const port = Number(process.env.SMTP_PORT ?? (secure ? 465 : 587));
  console.log("── HeyCarbo · One-shot send test ─────────────────────────────");
  console.log(`recipient : ${RECIPIENT}   (hard-coded, single, no override)`);
  console.log(`from      : ${from}`);
  console.log(`reply-to  : ${replyTo}`);
  console.log(`subject   : ${subject}`);
  console.log(`smtp      : ${process.env.SMTP_HOST ?? "?"}:${port} secure=${secure} (STARTTLS erzwungen: ${!secure})`);
  console.log(`armed     : ${isSendArmed()}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (!isSendArmed()) {
    console.log("SKIPPED — Master-Switch aus. Zum echten Versand REVENUE_SEND_ENABLED=1 setzen.\n(Es wurde NICHTS gesendet.)");
    return;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) abort("SMTP nicht konfiguriert — SMTP_HOST/USER/PASS fehlen.");

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure, // 465 → TLS from start
    requireTLS: !secure, // 587 → STARTTLS is mandatory (fail rather than send in clear)
    auth: { user: process.env.SMTP_USER as string, pass: process.env.SMTP_PASS as string },
    pool: false, // no connection pool
    maxConnections: 1,
    maxMessages: 1, // at most one message per connection
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  // 1) VERIFY connection + auth BEFORE sending. On failure → abort, no mail.
  const tVerify = now();
  try {
    await transporter.verify();
    console.log(`✅ transporter.verify() ok (${now() - tVerify} ms) — Verbindung + Authentifizierung erfolgreich.`);
  } catch (e) {
    transporter.close();
    abort(`SMTP verify() fehlgeschlagen: ${(e as Error).message}`);
  }

  // 2) SEND exactly one message.
  if (sends >= 1) abort("Es sollte mehr als eine Mail gesendet werden — verweigert.");
  sends += 1;
  const t0 = now();
  const info = await transporter.sendMail({
    envelope: { from, to: RECIPIENT }, // deterministic Envelope From / single RCPT
    from: `Ted Osammor | HeyCarbo <${from}>`,
    to: `Ted Osammor <${RECIPIENT}>`,
    replyTo,
    subject,
    html: o.emailHtml,
    text,
    headers: { "X-HeyCarbo-Test": "send-test-1" },
  }).catch((e) => { transporter.close(); abort(`sendMail fehlgeschlagen: ${(e as Error).message}`); }) as nodemailer.SentMessageInfo;
  const durationMs = now() - t0;

  // 3) Full SMTP response.
  console.log("\n── SMTP-Response ─────────────────────────────────────────────");
  console.log("accepted :", info.accepted);
  console.log("rejected :", info.rejected);
  console.log("response :", info.response);
  console.log("messageId:", info.messageId);
  console.log("envelope :", JSON.stringify(info.envelope));

  // 4) Auth/header facts.
  const fromDomain = from.split("@")[1] ?? "heycarbo.com";
  const { spf, dkim } = await authFromDns(fromDomain);
  console.log("\n── Authentifizierung / Header ────────────────────────────────");
  console.log("SPF (DNS)     :", spf);
  console.log("DKIM (DNS)    :", dkim);
  console.log("Envelope From :", info.envelope?.from);
  console.log("From          :", `Ted Osammor | HeyCarbo <${from}>`);
  console.log("Reply-To      :", replyTo);
  console.log("(SPF/DKIM-PASS final in den Empfänger-Headern: Gmail → 'Original anzeigen' → Authentication-Results)");

  // 5) QA report.
  const delivered = info.accepted?.includes(RECIPIENT) && (info.rejected?.length ?? 0) === 0;
  console.log("\n════════════════ QA-REPORT ════════════════");
  console.log("✅ SMTP-Verbindung erfolgreich");
  console.log("✅ Authentifizierung erfolgreich");
  console.log(`✅ TLS aktiv (${secure ? "SSL/465" : "STARTTLS/587"})`);
  console.log(`${delivered ? "✅" : "⚠️ "} Mail versendet (accepted: ${info.accepted?.length ?? 0}, rejected: ${info.rejected?.length ?? 0})`);
  console.log(`✅ Message-ID: ${info.messageId}`);
  console.log(`✅ Empfänger: ${RECIPIENT}`);
  console.log(`✅ Versanddauer: ${durationMs} ms`);
  console.log("════════════════════════════════════════════");
  console.log(`\nGesendete Mails in diesem Lauf: ${sends} (max. 1).`);
  console.log("Hinweis: REVENUE_SEND_ENABLED galt nur für diesen Prozess und ist mit Prozessende wieder 0.");

  // 6) Clean shutdown — no lingering connection, no further sends.
  transporter.close();
  process.exit(delivered ? 0 : 2);
}

main().catch((e) => abort(`Unerwarteter Fehler: ${e?.message ?? e}`));
