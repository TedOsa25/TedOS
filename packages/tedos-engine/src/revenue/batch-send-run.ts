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

import { createStorage } from "./../storage.js";
import { loadAccounts } from "./accounts.js";
import { selectedProviderName, getProvider } from "./sending.js";
import { sendApprovedBatch, loadLeadStatus, formatBatchReport } from "./batch-send.js";

const BATCH_SIZE = Number(process.env.REVENUE_BATCH_SIZE ?? 20);

async function preflightSmtp(): Promise<boolean> {
  if (selectedProviderName() !== "smtp" || process.env.REVENUE_SEND_ENABLED !== "1") return true;
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]);
  if (missing.length) { console.log(`⚠ SMTP-Konfig unvollständig: ${missing.join(", ")} fehlt.`); return false; }
  try {
    const mod = "nodemailer";
    const nodemailer = (await import(mod).catch(() => null)) as any;
    if (!nodemailer) { console.log("⚠ nodemailer nicht installiert."); return false; }
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "1",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.verify(); t.close();
    console.log(`✅ SMTP-Verbindung OK (${process.env.SMTP_HOST}:${process.env.SMTP_PORT}).`);
    return true;
  } catch (e) {
    console.log(`⛔ SMTP-Verbindung/Login FEHLGESCHLAGEN: ${(e as Error).message}`);
    console.log("   → Passwort korrekt? SMTP_USER = volle Adresse? Bei 465-Problemen: SMTP_PORT=587 ohne SMTP_SECURE.");
    return false;
  }
}

async function main(): Promise<void> {
  const storage = createStorage();
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt — In-Memory-Store hat KEINE Approvals aus der UI. Abbruch.");
    console.log("  Starte UI und Versand mit demselben TEDOS_STORAGE_PATH.");
    return;
  }

  const approved = Object.values(loadLeadStatus(storage)).filter((r) => r.status === "approved").length;
  console.log(`Store: ${process.env.TEDOS_STORAGE_PATH} · approved Leads: ${approved} · Provider: ${selectedProviderName()} · Master-Switch: ${process.env.REVENUE_SEND_ENABLED === "1" ? "ARMED" : "OFF (dry-run)"}\n`);
  if (approved === 0) { console.log("Keine approveten Leads — in der Revenue-Center-UI zuerst freigeben. (Nichts gesendet.)"); return; }

  if (!(await preflightSmtp())) { console.log("\nAbbruch vor Versand (SMTP-Preflight)."); return; }

  const report = await sendApprovedBatch({
    storage,
    accounts: loadAccounts(), // real CRM
    batchSize: BATCH_SIZE,
    batchNumber: 1, // batch 1 → BCC ted@heycarbo.com
    provider: getProvider(),
    clock: () => new Date().toISOString(),
  });
  console.log("\n" + formatBatchReport(report));
  console.log(report.sent > 0 ? `\n✅ ${report.sent} gesendet. BCC ging blind an ${report.bccAddress}.` : "\nℹ Nichts gesendet (Master-Switch aus oder Provider nicht konfiguriert).");
}

main().catch((e) => { console.error("batch-send-run failed:", (e as Error).message); process.exitCode = 1; });
