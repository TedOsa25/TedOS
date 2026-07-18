// ONE-SHOT production-simulation send — EXACTLY ONE test email, IONOS SMTP.
//
// SAFETY (enforced by construction, aborts hard on any violation):
//   • Recipient is a hard-coded constant. It CANNOT be overridden by env or argv.
//   • Exactly ONE message is sent — a counter refuses a second dispatch.
//   • No batch, no loop, no retry to other recipients, no real lead data is read.
//   • Sends only when the master switch is armed AND SMTP is configured.
//   • The master switch is process-local: it is passed inline for this one run and
//     is never persisted (nothing writes REVENUE_SEND_ENABLED anywhere).
//
// Run it yourself (password stays in your shell):
//   REVENUE_SEND_ENABLED=1 REVENUE_EMAIL_PROVIDER=smtp \
//   SMTP_HOST=smtp.ionos.de SMTP_PORT=587 \
//   SMTP_USER=ted@heycarbo.com SMTP_PASS='••••' \
//   npx tsx src/revenue/send-test.ts

import { normalize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";
import { buildCopy } from "./email-copy.js";
import { EMAIL_ASSETS } from "./email-template.js";
import { dispatch, getProvider, isSendArmed, type OutboundEmail } from "./sending.js";

/** The ONE and ONLY address this script may ever send to. Not overridable. */
const RECIPIENT = "tedosammor@googlemail.com";

/** Hard abort helper. */
function abort(reason: string): never {
  console.error(`\n⛔ ABBRUCH: ${reason}`);
  console.error("   Es wurde NICHTS gesendet.");
  process.exit(1);
}

// ── Guard 1: the recipient constant must be exactly the allowed address ────────
if (RECIPIENT !== "tedosammor@googlemail.com") abort(`Empfänger nicht exakt erlaubt: "${RECIPIENT}"`);

// ── Guard 2: refuse if anything tries to inject a different recipient ──────────
for (const [k, v] of Object.entries(process.env)) {
  if (/^(SEND_TEST_TO|MAIL_TO|RECIPIENT|TO)$/i.test(k) && v && v !== RECIPIENT) {
    abort(`Fremder Empfänger über Env "${k}=${v}" — nur ${RECIPIENT} ist erlaubt.`);
  }
}
if (process.argv.slice(2).some((a) => a.includes("@") && a !== RECIPIENT)) {
  abort("Fremde Empfänger-Adresse als Argument übergeben — abgelehnt.");
}

// ── Single-send guard: at most ONE dispatch, ever ─────────────────────────────
let sends = 0;
async function sendOnce(email: OutboundEmail) {
  if (sends >= 1) abort("Es sollte mehr als eine Mail gesendet werden — verweigert.");
  if (email.to !== RECIPIENT) abort(`Empfänger im Mail-Objekt weicht ab: "${email.to}"`);
  sends += 1;
  return dispatch(email, getProvider("smtp")); // SMTP only, no fallback provider
}

// A SYNTHETIC, representative account — NOT from the CRM (no real leads touched).
const account = normalize(
  {
    id: "SEND-TEST", name: "GRAFE GmbH", segment: "Automotive / Mobility",
    customers: ["BMW", "Bosch"], supplier_pressure: "BMW und Bosch fordern ISO-14067-PCF über Catena-X",
    catena_x_relevance: "high", email: RECIPIENT,
  },
  0,
);

const o = buildOpportunity(account, () => new Date().toISOString(), "E");
const copy = buildCopy(account, "E");
const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "ted@heycarbo.com";
const subject = o.subjects[0] ?? "HeyCarbo";

const text = [
  copy.greeting, "", copy.intro, "", copy.value, "", copy.closing, "",
  `14 Tage kostenlos testen: ${o.ctaUrl}`,
  `Oder direkt eine 15-Minuten-Demo vereinbaren: ${EMAIL_ASSETS.calendlyUrl}`,
  "", "Ted Osammor · Co-Founder | HeyCarbo · Carbon.Made.Simple.",
  "ted@heycarbo.com · +49 221 95934702 · www.heycarbo.com",
].join("\n");

async function main() {
  console.log("── HeyCarbo · One-shot send test ─────────────────────────────");
  console.log(`recipient : ${RECIPIENT}   (hard-coded, single, no override)`);
  console.log(`from      : ${from}`);
  console.log(`subject   : ${subject}`);
  console.log(`provider  : smtp (forced)`);
  console.log(`armed     : ${isSendArmed()}`);
  console.log(`smtp      : ${process.env.SMTP_HOST ?? "?"}:${process.env.SMTP_PORT ?? "?"} secure=${process.env.SMTP_SECURE === "1"}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (!isSendArmed()) {
    console.log("SKIPPED — Master-Switch aus. Zum echten Versand REVENUE_SEND_ENABLED=1 setzen.");
    console.log("(Es wurde NICHTS gesendet.)");
    return;
  }
  if (!getProvider("smtp").isConfigured()) {
    abort("SMTP nicht konfiguriert — SMTP_HOST/PORT/USER/PASS fehlen.");
  }

  const result = await sendOnce({
    to: RECIPIENT,
    toName: "Ted Osammor",
    from,
    fromName: "Ted Osammor | HeyCarbo",
    replyTo: from,
    subject,
    html: o.emailHtml,
    text,
    headers: { "X-HeyCarbo-Test": "send-test-1" },
    tags: ["send-test"],
  });

  console.log("\nSMTP-STATUS:", JSON.stringify(result, null, 2));
  console.log(`\nGesendete Mails in diesem Lauf: ${sends} (max. 1)`);
  if (result.status === "sent") {
    console.log(`✅ SMTP erfolgreich — message-id: ${result.messageId ?? "(keine zurückgegeben)"}`);
    console.log(`→ Jetzt Postfach ${RECIPIENT} prüfen (Gmail Desktop + App).`);
  } else {
    console.log(`⚠️  Status: ${result.status} — ${result.detail ?? ""}`);
  }
  console.log("\nHinweis: REVENUE_SEND_ENABLED galt nur für diesen Prozess (inline gesetzt),");
  console.log("wird nirgends gespeichert und ist mit Prozessende wieder wirkungslos (=0).");
}

main().catch((e) => abort(`Sendeversuch fehlgeschlagen: ${e?.message ?? e}`));
