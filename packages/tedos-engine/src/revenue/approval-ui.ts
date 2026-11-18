// Launch the local Revenue Center approval UI. Localhost only; sets status only.
//
//   npm run approval:ui
//   TEDOS_STORAGE_PATH=./.revenue-state npm run approval:ui   # persist approvals
//
// Persist the store (TEDOS_STORAGE_PATH) so approvals survive and sendApprovedBatch
// (run with the SAME TEDOS_STORAGE_PATH) sends exactly the approved leads.

import { createApprovalServer } from "./approval-server.js";

const PORT = Number(process.env.APPROVAL_UI_PORT ?? 4599);
const LIMIT = Number(process.env.APPROVAL_UI_LIMIT ?? 50);

const server = createApprovalServer({ limit: LIMIT });
server.listen(PORT, "127.0.0.1", () => {
  const persist = process.env.TEDOS_STORAGE_PATH;
  console.log(`Revenue Center Approval UI → http://127.0.0.1:${PORT}  (Top ${LIMIT} Leads)`);
  console.log(persist ? `Approvals werden persistiert unter: ${persist}` : "⚠ In-Memory (nicht persistiert) — setze TEDOS_STORAGE_PATH, damit Approvals für sendApprovedBatch erhalten bleiben.");
  console.log("Es wird NICHTS versendet. Approve setzt nur Status; Versand ist separat & gated.");
});
