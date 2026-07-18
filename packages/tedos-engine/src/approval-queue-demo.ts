// Approval Queue demo — shows MEDIUM/HIGH goals being deferred (never blocking)
// and surfaced as ONE collected report, plus the Learning stats.

import { InMemoryStorage } from "./storage.js";
import { ApprovalGate } from "./approval-gate.js";
import { ApprovalQueue, type ApprovalInput } from "./approval-queue.js";

const storage = new InMemoryStorage();
const queue = new ApprovalQueue(storage, new ApprovalGate(storage));

const deferred: ApprovalInput[] = [
  { goalId: "supplier-portal", title: "Supplier Portal self-serve invites", description: "...", businessImpact: 9, revenueImpact: 7, customerValue: 8, risk: "MEDIUM", priorityScore: 94, files: ["src/pages/SuppliersPage.tsx"], estimatedEffort: "M", recommendation: "approve" },
  { goalId: "pricing-change", title: "Raise Starter plan price", description: "...", businessImpact: 6, revenueImpact: 9, customerValue: 2, risk: "HIGH", priorityScore: 42, files: ["pricing"], estimatedEffort: "S", recommendation: "reject" },
  { goalId: "xlsx-replace", title: "Replace xlsx (security)", description: "...", businessImpact: 7, revenueImpact: 3, customerValue: 6, risk: "HIGH", priorityScore: 80, files: ["src/utils/csv-parser.ts"], estimatedEffort: "L", recommendation: "approve" },
];

console.log("Main Loop tick — MEDIUM/HIGH goals deferred (loop keeps working on LOW goals):");
for (const g of deferred) {
  queue.enqueue(g);
  console.log(`  deferred ${g.goalId} (${g.risk}, ROI ${g.priorityScore}) — iteration NOT stopped`);
}

console.log("\n=== Collected Approval Report ===\n" + queue.report());
console.log("\n=== Learning stats ===");
console.log(JSON.stringify(queue.stats(), null, 2));
