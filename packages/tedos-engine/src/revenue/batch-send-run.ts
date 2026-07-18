// Production batch send — dispatches the leads Approved in the Revenue Center.
//
// Reads the SAME persistent store the approval UI writes to (TEDOS_STORAGE_PATH),
// loads the real CRM accounts, and sends the approved batch through the selected
// provider. Batch 1 → BCC ted@heycarbo.com; auto-disarms after; stops.
//
//   # 1) approve leads in the UI (same TEDOS_STORAGE_PATH), then:
//   TEDOS_STORAGE_PATH=./.revenue-state \
//   REVENUE_SEND_ENABLED=1 REVENUE_EMAIL_PROVIDER=smtp \
//   SMTP_HOST=smtp.ionos.de SMTP_PORT=465 SMTP_SECURE=1 \
//   SMTP_USER=ted@heycarbo.com SMTP_PASS=… \
//   npm run batch:send
//
// Without REVENUE_SEND_ENABLED=1 it is a dry run (reports, sends nothing).

import { createHash } from "node:crypto";
import { createStorage } from "./../storage.js";
import { loadAccounts } from "./accounts.js";
import { activeBrandProfile } from "./brand-profile.js";
import { selectedProviderName, getProvider } from "./sending.js";
import { sendApprovedBatch, formatBatchReport } from "./batch-send.js";
import { runPreflight, formatPreflight } from "./preflight.js";
import { writeReportFile } from "./report-file.js";

/** Sender identity used for the DNS/domain preflight (brand-profile driven, env-overridable). */
const SENDER_EMAIL = process.env.REVENUE_FROM_EMAIL ?? process.env.SMTP_USER ?? activeBrandProfile().identity.senderEmail;

const BATCH_SIZE = Number(process.env.REVENUE_BATCH_SIZE ?? 20);
// BCC monitoring copy: brand-profile default (profile.identity.bcc); REVENUE_BCC=off disables.
const BCC = (process.env.REVENUE_BCC ?? activeBrandProfile().identity.bcc).toLowerCase() === "off"
  ? ""
  : (process.env.REVENUE_BCC ?? activeBrandProfile().identity.bcc);

/** Masked fingerprint of a secret: length + sha256 prefix. Reveals nothing usable. */
function fingerprint(v: string | undefined): string {
  if (!v) return "<leer/ungesetzt>";
  return `len=${v.length} sha256=${createHash("sha256").update(v).digest("hex").slice(0, 8)}`;
}

/** Print the exact SMTP inputs (password masked) — for comparing send:test vs batch:send. */
function echoSmtpEnv(): void {
  console.log("── SMTP-Inputs (vor Login, Passwort maskiert) ──");
  console.log(`SMTP_HOST=${process.env.SMTP_HOST ?? "<ungesetzt>"}`);
  console.log(`SMTP_PORT=${process.env.SMTP_PORT ?? "<ungesetzt>"}`);
  console.log(`SMTP_SECURE=${process.env.SMTP_SECURE ?? "<ungesetzt>"}`);
  console.log(`SMTP_USER=${process.env.SMTP_USER ?? "<ungesetzt>"}`);
  console.log(`Provider=${selectedProviderName()}`);
  console.log(`SMTP_PASS(fingerprint)=${fingerprint(process.env.SMTP_PASS)}`);
  console.log("────────────────────────────────────────────────");
}

async function main(): Promise<void> {
  const storage = createStorage();
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt — In-Memory-Store hat KEINE Approvals aus der UI. Abbruch.");
    console.log("  Starte UI und Versand mit demselben TEDOS_STORAGE_PATH.");
    return;
  }

  const accounts = loadAccounts(); // real CRM
  const armed = process.env.REVENUE_SEND_ENABLED === "1";
  const campaignLabel = process.env.REVENUE_CAMPAIGN;
  console.log(`Store: ${process.env.TEDOS_STORAGE_PATH} · batchSize: ${BATCH_SIZE} · BCC: ${BCC || "aus"} · Provider: ${selectedProviderName()} · Master-Switch: ${armed ? "ARMED" : "OFF (dry-run)"}\n`);

  // Show the exact SMTP inputs (masked) before the connection verify runs.
  if (selectedProviderName() === "smtp" && armed) echoSmtpEnv();

  // === Pre-send preflight (hard gate) — all eight checks must pass ===========
  const pf = await runPreflight({
    storage,
    batchSize: BATCH_SIZE,
    senderEmail: SENDER_EMAIL,
    provider: selectedProviderName(),
    armed,
    accounts,
    ...(campaignLabel ? { campaignLabel } : {}),
    clock: () => new Date().toISOString(),
  });
  console.log(formatPreflight(pf));
  if (!pf.ok) {
    const errPath = writeReportFile(pf.reportStem, "error.txt", formatPreflight(pf) + "\n");
    console.log(`\n⛔ Abbruch: Preflight fehlgeschlagen — nichts gesendet.\n📄 Fehlerbericht: ${errPath}`);
    process.exitCode = 1;
    return;
  }

  // === Send ONLY the approved batch ==========================================
  const report = await sendApprovedBatch({
    storage,
    accounts,
    batchSize: BATCH_SIZE,
    bcc: BCC, // explicit → BCC applies at any batch size ("" disables)
    ...(campaignLabel ? { campaignLabel } : {}),
    provider: getProvider(),
    clock: () => new Date().toISOString(),
  });
  const text = formatBatchReport(report);
  console.log("\n" + text);

  // === Durable per-batch report files (JSON + text) ==========================
  try {
    const jsonPath = writeReportFile(pf.reportStem, "report.json", JSON.stringify({ preflight: pf, report }, null, 2));
    writeReportFile(pf.reportStem, "report.txt", formatPreflight(pf) + "\n\n" + text + "\n");
    console.log(`\n📄 Report: ${jsonPath}`);
  } catch (e) {
    console.log(`⚠ Report-Datei konnte nicht geschrieben werden: ${(e as Error).message}`);
  }
  console.log(report.sent > 0 ? `\n✅ ${report.sent} gesendet. BCC ging blind an ${report.bccAddress}.` : "\nℹ Nichts gesendet (Master-Switch aus oder Provider nicht konfiguriert).");
}

main().catch((e) => { console.error("batch-send-run failed:", (e as Error).message); process.exitCode = 1; });
