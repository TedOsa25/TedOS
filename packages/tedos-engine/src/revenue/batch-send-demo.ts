// Runner for sendApprovedBatch(). Two modes:
//
//   (default)  DRY RUN  — builds the batch, dispatches NOTHING, prints the report.
//                          Safe to run anytime; ignores the master switch.
//
//   --real     ONE test lead — a real run limited to EXACTLY ONE synthetic lead
//              whose recipient is hard-forced to the operator's own inbox (never
//              a customer). Still only sends if REVENUE_SEND_ENABLED=1 AND the
//              selected provider is configured; otherwise it reports "skipped".
//              Batch number 1 → the BCC (ted@heycarbo.com) is exercised too.
//
// Usage:
//   npm run batch:dry              # dry run, sends nothing
//   REVENUE_SEND_ENABLED=1 REVENUE_EMAIL_PROVIDER=smtp SMTP_HOST=… SMTP_PORT=… \
//     SMTP_USER=… SMTP_PASS=… npm run batch:test    # real, one lead → own inbox

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { getProvider, selectedProviderName } from "./sending.js";
import { sendApprovedBatch, approveLeads, formatBatchReport } from "./batch-send.js";

/** The ONLY recipient a --real run may target — the operator's own inbox. */
const TEST_RECIPIENT = process.env.REVENUE_TEST_RECIPIENT ?? "tedosammor@googlemail.com";

/** One synthetic, representative account — NOT from the CRM. */
function testLead(email: string): Account {
  return normalize(
    { id: "batch-testlead", name: "HeyCarbo Testlauf GmbH", industry: "Automotive", email, prio: "A", score: 82, catena_x_relevance: "high", heycarbo_pain_points: ["Scope-3-Daten für OEM-Kunden"] },
    0,
  );
}

async function main(): Promise<void> {
  const real = process.argv.includes("--real");
  const storage = new InMemoryStorage();
  const clock = () => new Date().toISOString();

  if (!real) {
    // DRY RUN — a couple of synthetic approved leads, nothing dispatched.
    const leads = [testLead("lead1@example.com"), { ...testLead("lead2@example.com"), id: "batch-testlead-2" }];
    approveLeads(storage, leads.map((l) => l.id));
    console.log("MODE: DRY RUN — es wird NICHTS gesendet.\n");
    const report = await sendApprovedBatch({ storage, accounts: leads, dryRun: true, batchNumber: 1, clock });
    console.log(formatBatchReport(report));
    console.log("\n(Trockenlauf — kein Provider-Call, keine E-Mail.)");
    return;
  }

  // REAL — exactly one lead, recipient hard-forced to the operator inbox.
  const lead = testLead(TEST_RECIPIENT);
  approveLeads(storage, [lead.id]);
  console.log(`MODE: REAL (ein Testlead) → ${TEST_RECIPIENT}`);
  console.log(`Provider: ${selectedProviderName()} · Master-Switch: ${process.env.REVENUE_SEND_ENABLED === "1" ? "ARMED" : "OFF (→ skipped)"}\n`);
  const report = await sendApprovedBatch({
    storage,
    accounts: [lead],
    batchSize: 1,
    batchNumber: 1, // exercises the batch-1 BCC
    provider: getProvider(),
    clock,
  });
  console.log(formatBatchReport(report));
  if (report.sent > 0) console.log(`\n✅ Gesendet. Postfach ${TEST_RECIPIENT} prüfen (BCC ging an ${report.bccAddress}).`);
  else console.log("\nℹ Nichts gesendet (Master-Switch aus oder Provider nicht konfiguriert) — nur Trockenlauf-Ergebnis.");
}

main().catch((e) => { console.error("batch-send-demo failed:", (e as Error).message); process.exitCode = 1; });
