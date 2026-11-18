// Evidence Layer demo — prints data-source availability + the missing-data checklist.

import { dataSourceStatus, missingDataChecklist, hasAnyLiveData } from "./evidence.js";

console.log(`Live data available: ${hasAnyLiveData()}\n`);
console.log("Data sources:");
for (const s of dataSourceStatus()) {
  console.log(`  ${s.available ? "✓" : "·"} ${s.source.padEnd(24)} confidence=${s.confidence}${s.missing.length ? "  (missing: " + s.missing.join(", ") + ")" : ""}`);
}
const checklist = missingDataChecklist();
if (checklist.length) {
  console.log("\nMissing-data checklist:");
  for (const c of checklist) console.log(`  - ${c}`);
}
