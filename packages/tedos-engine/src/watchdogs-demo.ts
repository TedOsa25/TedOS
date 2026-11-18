// Watchdog schedule demo — prints the full autonomous daily timeline and the
// Executive Report's sources. Read-only; reflects the harness cron jobs.

import { WATCHDOGS, MAIN_LOOP, EXECUTIVE_REPORT, validateSchedule } from "./watchdogs.js";

const { ok, errors } = validateSchedule();
console.log(`Watchdog schedule: ${ok ? "valid" : "INVALID — " + errors.join("; ")}\n`);

console.log(`  ${MAIN_LOOP.time.padEnd(12)} ${MAIN_LOOP.name}`);
for (const w of WATCHDOGS) {
  console.log(`  ${w.time.padEnd(12)} ${w.name.padEnd(28)} -> ${w.feed}`);
}
console.log(`  ${EXECUTIVE_REPORT.time.padEnd(12)} ${EXECUTIVE_REPORT.name.padEnd(28)} -> ${EXECUTIVE_REPORT.feed}`);
console.log(`\nExecutive Report aggregates ${EXECUTIVE_REPORT.sources.length} sources: ${EXECUTIVE_REPORT.sources.join(", ")}`);
