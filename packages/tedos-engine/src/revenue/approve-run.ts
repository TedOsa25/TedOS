// Approval runner — auto-approves the next N leads with the hardened filter.
// This is the "new approval run" every batch requires. It only sets status to
// "approved"; it NEVER sends. Preview by default; pass --apply to persist.
//
//   TEDOS_STORAGE_PATH=./.revenue-state REVENUE_APPROVE_N=50 \
//   npm run approve            # preview only
//   npm run approve -- --apply # actually set the 50 to "approved"

import { readFileSync } from "node:fs";

import { createStorage } from "./../storage.js";
import { loadAccounts } from "./accounts.js";
import { loadLeadStatus, approveLeads } from "./batch-send.js";
import { selectForApproval, isPersonalized } from "./approve-select.js";

const N = Number(process.env.REVENUE_APPROVE_N ?? 20);
const APPLY = process.argv.includes("--apply") || process.env.REVENUE_APPROVE_APPLY === "1";
/**
 * Optional whitelist: a CSV whose FIRST column holds lead ids (header skipped).
 * Without it the runner ranks the whole CRM by fit — which surfaces machine
 * builders and consumer brands. With it, a batch can be restricted to a
 * qualified segment (e.g. the ICP export) while keeping the hardened filter.
 */
const IDS_FILE = process.env.REVENUE_APPROVE_IDS_FILE;

function main(): void {
  if (!process.env.TEDOS_STORAGE_PATH) {
    console.log("⚠ TEDOS_STORAGE_PATH nicht gesetzt — Abbruch (Approvals müssen im geteilten Store landen).");
    return;
  }
  const storage = createStorage();
  let accounts = loadAccounts();
  if (IDS_FILE) {
    const ids = new Set(
      readFileSync(IDS_FILE, "utf8").split("\n").slice(1)
        .map((l) => l.split(";")[0]?.trim()).filter(Boolean),
    );
    const before = accounts.length;
    accounts = accounts.filter((a) => ids.has(a.id));
    console.log(`Whitelist: ${IDS_FILE} → ${ids.size} IDs · CRM ${before} → ${accounts.length} Kandidaten`);
  }
  const sel = selectForApproval(accounts, loadLeadStatus(storage), N);

  console.log(`Approval-Lauf (gehärteter Filter) · Ziel: ${N} · Modus: ${APPLY ? "APPLY" : "Vorschau"}`);
  console.log(`Eligible: ${sel.eligible} · personalisiert im Pick: ${sel.personalizedInPick}/${sel.pick.length}`);
  console.log(`Abgelehnt: ${sel.rejected.status} kontaktiert/entschieden · ${sel.rejected.noEmail} ohne Adresse · ${sel.rejected.dataQuality} Datenqualität · ${sel.rejected.duplicate} Dubletten · ${sel.rejected.domainMismatch} Domain-Mismatch`);
  console.log("\n── Auswahl ─────────────────────────────────────────────────");
  sel.pick.forEach((a, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${a.company} · ${a.industry} · fit=${a.fitScore} · ${a.email}${isPersonalized(a.email as string) ? "  [pers]" : ""}`);
  });

  if (!APPLY) {
    console.log("\n(Vorschau — nichts geändert. Mit --apply approven.)");
    return;
  }
  approveLeads(storage, sel.pick.map((a) => a.id));
  const after = loadLeadStatus(storage);
  const cnt: Record<string, number> = {};
  for (const r of Object.values(after)) cnt[r.status] = (cnt[r.status] ?? 0) + 1;
  console.log(`\n→ ${sel.pick.length} Leads auf "approved" gesetzt. Store: ${JSON.stringify(cnt)}`);
}

main();
