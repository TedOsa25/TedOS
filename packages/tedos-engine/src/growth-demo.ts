// Demo: the Growth Engine preparing a day's business deliverables, offline +
// deterministic. Run: `npm run growth`.

import { InMemoryStorage } from "./storage.js";
import { DistributionQueue } from "./distribution-queue.js";
import { GrowthEngine } from "./growth-engine.js";

const clock = (): string => "2026-06-27T09:00:00.000Z";
const storage = new InMemoryStorage();
const queue = new DistributionQueue(storage, undefined, clock);
const engine = new GrowthEngine(queue, storage, { clock, perTickCap: 100 });

const r = engine.run();

console.log("=== Growth Engine — one day's prepared deliverables ===\n");
console.log(`BUSINESS IMPACT SCORE: ${r.businessImpactScore}`);
console.log(`Revenue opportunities:  ${r.revenueOpportunities}`);
console.log(`New campaigns:          ${r.newCampaigns}`);
console.log(`Sales emails prepared:  ${r.salesEmails}`);
console.log(`Marketing assets:       ${r.marketingAssets}`);
console.log(`Website improvements:   ${r.websiteImprovements}`);
console.log(`SEO opportunities:      ${r.seoOpportunities}`);
console.log(`Content opportunities:  ${r.contentOpportunities}`);
console.log(`Supplier opportunities: ${r.supplierOpportunities}`);
console.log(`Queued for approval:    ${r.queuedForApproval} (credential-gated, nothing sent)`);
console.log(`\nQueue status:`, queue.stats());

console.log("\n=== Sample prepared content (first of each kind) ===");
const seen = new Set<string>();
for (const o of r.opportunities) {
  if (seen.has(o.kind)) continue;
  seen.add(o.kind);
  console.log(`\n• [${o.kind} · ${o.category} · ${o.channel}] ${o.title}`);
  if (o.subject) console.log(`  Betreff: ${o.subject}`);
  console.log(`  ${o.body.split("\n")[0]}…`);
}
