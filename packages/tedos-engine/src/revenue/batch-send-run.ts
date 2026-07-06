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
import { selectedProviderName, getProvider } from "./sending.js";
import { sendApprovedBatch, loadLeadStatus, formatBatchReport } from "./batch-send.js";

const BATCH_SIZE = Number(process.env.REVENUE_BATCH_SIZE ?? 20);
// BCC monitoring copy: default ted@heycarbo.com; REVENUE_BCC=off disables.
const BCC = (process.env.REVENUE_BCC ?? "ted@heycarbo.com").toLowerCase() === "off" ? "" : (process.env.REVENUE_BCC ?? "ted@heycarbo.com");

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

async function preflightSmtp(): Promise<boolean> {
  if (selectedProviderName() !== "smtp" || process.env.REVENUE_SEND_ENABLED !== "1") return true;
  echoSmtpEnv();
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].filter((k) => !process.env[k]);
  if (missing.length) { console.log(`⚠ SMTP-Konfig unvollständig: ${missing.join(", ")} fehlt.`); return false; }
  try {
    const mod = "nodemailer";
    const nodemailer = (await import(mod).catch(() => null)) as any;
    if (!nodemailer) { console.log("⚠ nodemailer nicht installiert."); return false; }
    // Mirror the proven send:test transport exactly (removes any transport doubt).
    const secure = process.env.SMTP_SECURE === "1";
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? (secure ? 465 : 587)),
      secure,
      requireTLS: !secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: false, maxConnections: 1, maxMessages: 1,
      connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
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
  console.log(`Store: ${process.env.TEDOS_STORAGE_PATH} · approved Leads: ${approved} · batchSize: ${BATCH_SIZE} · BCC: ${BCC || "aus"} · Provider: ${selectedProviderName()} · Master-Switch: ${process.env.REVENUE_SEND_ENABLED === "1" ? "ARMED" : "OFF (dry-run)"}\n`);
  if (approved === 0) { console.log("Keine approveten Leads — in der Revenue-Center-UI zuerst freigeben. (Nichts gesendet.)"); return; }

  if (!(await preflightSmtp())) { console.log("\nAbbruch vor Versand (SMTP-Preflight)."); return; }

  const campaignLabel = process.env.REVENUE_CAMPAIGN;
  const report = await sendApprovedBatch({
    storage,
    accounts: loadAccounts(), // real CRM
    batchSize: BATCH_SIZE,
    bcc: BCC, // explicit → BCC applies at any batch size ("" disables)
    ...(campaignLabel ? { campaignLabel } : {}),
    provider: getProvider(),
    clock: () => new Date().toISOString(),
  });
  console.log("\n" + formatBatchReport(report));
  console.log(report.sent > 0 ? `\n✅ ${report.sent} gesendet. BCC ging blind an ${report.bccAddress}.` : "\nℹ Nichts gesendet (Master-Switch aus oder Provider nicht konfiguriert).");
}

main().catch((e) => { console.error("batch-send-run failed:", (e as Error).message); process.exitCode = 1; });
