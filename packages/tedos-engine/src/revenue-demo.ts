// Demo: the Revenue Engine preparing real-account outreach. Reads the REAL
// HeyCarbo accounts from Sales/crm-heycarbo/leads.js (or REVENUE_ACCOUNTS_PATH).
// Offline; nothing is sent. Run: `npm run revenue`.

import { InMemoryStorage } from "./storage.js";
import { DistributionQueue } from "./distribution-queue.js";
import { loadAccounts } from "./revenue/accounts.js";
import { RevenueEngine, buildOpportunity } from "./revenue/revenue-engine.js";
import { prioritize } from "./revenue/accounts.js";

const clock = (): string => new Date().toISOString();
const storage = new InMemoryStorage();
const queue = new DistributionQueue(storage, undefined, clock);

const accounts = loadAccounts();
console.log(`Loaded ${accounts.length} REAL accounts from the Sales CRM.\n`);

const engine = new RevenueEngine(queue, storage, { clock, dailyTarget: 40, perTickCap: 40 });
const center = engine.run();

console.log("=== Revenue Center (morning view) ===\n");
console.log(JSON.stringify(center, null, 2));

if (accounts.length > 0) {
  const top = prioritize(accounts)[0];
  if (top) {
    const o = buildOpportunity(top, clock);
    console.log(`\n=== Sample prepared opportunity: ${o.company} (${o.industry}) ===`);
    console.log(`Campaign: ${o.campaign} · Fit ${o.fitScore} · Revenue ${o.revenueScore} · Intent ${o.buyingIntent}`);
    console.log(`Quality: ${o.quality.passed ? "PASS" : "FAIL"} (${o.quality.qualityScore}/100)`);
    console.log(`Subjects:\n  - ${o.subjects.join("\n  - ")}`);
    console.log(`Preview: ${o.previewText}`);
    console.log(`LinkedIn: ${o.linkedin}`);
    console.log(`Banner: ${o.banner.asset}`);
    console.log(`Summary: ${o.summary}`);
  }
}
console.log(`\nQueue:`, queue.stats(), "— all pending approval, nothing sent.");
