// Generate the Revenue Center data the Sales dashboard reads, from REAL accounts.
// Offline; nothing is sent. Run: `npm run revenue:export`.
// Output: Sales/crm-heycarbo/revenue-center.js (or REVENUE_EXPORT_PATH) — a
// `window.REVENUE = {...}` script, loaded by revenue-center.html via <script src>
// (same file://-friendly pattern as leads.js).

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { InMemoryStorage } from "./storage.js";
import { DistributionQueue } from "./distribution-queue.js";
import { RevenueEngine } from "./revenue/revenue-engine.js";
import { buildRevenueExport } from "./revenue/export.js";

const clock = (): string => new Date().toISOString();
const storage = new InMemoryStorage();
const queue = new DistributionQueue(storage, undefined, clock);
const engine = new RevenueEngine(queue, storage, { clock, dailyTarget: 40, perTickCap: 40 });

const summary = engine.run();
const exp = buildRevenueExport(summary, engine.opportunities(), clock());

const out = process.env.REVENUE_EXPORT_PATH ?? resolve(process.cwd(), "../../../Sales/crm-heycarbo/revenue-center.js");
const js = `// HeyCarbo Revenue Center — generated from the REAL Sales CRM. LOKAL. Do not edit by hand.\nwindow.REVENUE = ${JSON.stringify(exp)};\n`;
writeFileSync(out, js);
console.log(
  exp.summary.dataAvailable
    ? `Wrote ${exp.accounts.length} prepared opportunities (of ${exp.summary.accountsPrioritized} accounts) → ${out}`
    : `No real accounts found — wrote empty export with missing-data note → ${out}`,
);
