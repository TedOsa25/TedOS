// ONE-SHOT production-simulation send — EXACTLY ONE test email, IONOS SMTP.
//
// HARD LIMITS (by construction, not by convention):
//   • Recipient is hard-coded to ONE address. It cannot be overridden by env.
//   • Sends exactly one message. No batch, no loop, no lead data touched.
//   • Refuses to run unless the master switch is armed AND SMTP is configured.
//
// Run it yourself (creds stay in your shell, never in code):
//   REVENUE_SEND_ENABLED=1 REVENUE_EMAIL_PROVIDER=smtp \
//   SMTP_HOST=smtp.ionos.de SMTP_PORT=587 \
//   SMTP_USER=ted@heycarbo.com SMTP_PASS='••••' \
//   [SMTP_FROM=ted@heycarbo.com] [SMTP_SECURE=1 for port 465] \
//   npx tsx src/revenue/send-test.ts

import { normalize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";
import { buildCopy } from "./email-copy.js";
import { EMAIL_ASSETS } from "./email-template.js";
import { dispatch, getProvider, isSendArmed } from "./sending.js";

/** The ONLY address this script may ever send to. Not overridable. */
const RECIPIENT = "tedosammor@googlemail.com";

// A representative real-shaped account so the mail looks exactly like production.
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

// Plain-text alternative (multipart) — for clients/preview that use it + deliverability.
const text = [
  copy.greeting, "", copy.intro, "", copy.value, "", copy.closing, "",
  `14 Tage kostenlos testen: ${o.ctaUrl}`,
  `Oder direkt eine 15-Minuten-Demo vereinbaren: ${EMAIL_ASSETS.calendlyUrl}`,
  "",
  "Ted Osammor · Co-Founder | HeyCarbo · Carbon.Made.Simple.",
  "ted@heycarbo.com · +49 221 95934702 · www.heycarbo.com",
].join("\n");

async function main() {
  console.log("── HeyCarbo · One-shot send test ─────────────────────────────");
  console.log(`recipient : ${RECIPIENT}   (hard-coded, single)`);
  console.log(`from      : ${from}`);
  console.log(`subject   : ${subject}`);
  console.log(`provider  : ${process.env.REVENUE_EMAIL_PROVIDER ?? "(default)"}`);
  console.log(`armed     : ${isSendArmed()}`);
  console.log(`smtp      : ${process.env.SMTP_HOST ?? "?"}:${process.env.SMTP_PORT ?? "?"} secure=${process.env.SMTP_SECURE === "1"}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (!isSendArmed()) {
    console.log("SKIPPED — master switch off. Set REVENUE_SEND_ENABLED=1 to actually send.");
    return;
  }

  const result = await dispatch(
    {
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
    },
    getProvider("smtp"),
  );

  console.log("RESULT:", JSON.stringify(result, null, 2));
  if (result.status === "sent") {
    console.log(`\n✅ SMTP OK — message-id: ${result.messageId ?? "(none returned)"}`);
    console.log(`Prüfe jetzt das Postfach ${RECIPIENT} (Gmail Desktop + App).`);
  } else {
    console.log(`\n⚠️  Nicht gesendet — Status: ${result.status}. Detail: ${result.detail ?? ""}`);
  }
}

main().catch((e) => {
  console.error("FEHLER beim Sendeversuch:", e?.message ?? e);
  process.exitCode = 1;
});
