// Demo: the full Autonomous Distribution pipeline, offline + deterministic.
// Enqueue (from existing drafts) → Approval → Distribution Queue → Connector
// (credential+transport gated) → Publish → Analytics → Learning → Executive
// Report. Run: `npm run distribution`.
//
// Real publishing stays gated: here a MOCK transport + MOCK metrics stand in for
// a live connector so the whole flow is visible. With neither (production
// default), every job is recorded `skipped` with concrete setup instructions.

import { InMemoryStorage } from "./storage.js";
import { ApprovalGate } from "./approval-gate.js";
import { DistributionQueue, type DistributionJobInput } from "./distribution-queue.js";
import { PublisherRegistry, type Transport } from "./distribution-connectors.js";
import {
  DistributionAnalyticsStore,
  DistributionLearningStore,
  buildDistributionSection,
  renderDistributionSection,
  learnFromMetrics,
  type MetricsProvider,
} from "./distribution-analytics.js";
import { DistributionEngine } from "./distribution-engine.js";

const NOW = new Date("2026-06-26T14:00:00.000Z");
const clock = (): string => NOW.toISOString();

const storage = new InMemoryStorage();
const gate = new ApprovalGate(storage);
const queue = new DistributionQueue(storage, gate, clock);

// Drafts the existing watchdogs already produce (content/, marketing/outreach/).
const drafts: DistributionJobInput[] = [
  { id: "mkt-li-1", source: "marketing", channel: "linkedin", campaign: "scope3-thought-leadership",
    title: "Scope 3 in Minuten", body: "Automotive-Kunden fragen nach CO₂-Daten. HeyCarbo verkürzt Wochen auf Minuten. CTA: Demo buchen", cta: "Demo buchen" },
  { id: "sales-em-1", source: "sales", channel: "email", campaign: "grafe-tier-a",
    title: "GRAFE outreach", subject: "Scope-3-Daten für Ihre Automotive-Kunden", recipient: "kontakt@grafe.example",
    body: "Hallo, HeyCarbo macht aus wochenlanger Excel-Arbeit Minuten. CTA: Demo buchen", cta: "Demo buchen" },
  { id: "cs-em-1", source: "customer-success", channel: "email", campaign: "supplier-reminders",
    title: "Supplier reminder", subject: "Erinnerung: Scope-3-Daten hochladen", recipient: "supplier@example.com",
    body: "Kurze Erinnerung, Ihre CO₂-Daten hochzuladen. CTA: CO₂-Daten hochladen", cta: "CO₂-Daten hochladen" },
];

for (const d of drafts) queue.enqueue(d);
console.log("=== 1. Enqueued (pending approval) ===");
console.log(queue.stats());

// Human approves two; one stays pending (never distributed).
queue.approve("mkt-li-1");
queue.approve("sales-em-1");
console.log("\n=== 2. After approval (2 approved, 1 still pending) ===");
console.log(queue.stats());

// MOCK live transport + metrics (in production these are absent → skipped).
const transport: Transport = (job) => ({ ok: true, externalId: `ext-${job.id}`, detail: "delivered (mock)" });
const metrics: MetricsProvider = (job) =>
  job.channel === "email"
    ? { opens: 120, replies: 8, clicks: 22, conversions: 3, leads: 3, demoBookings: 2, revenue: 1800 }
    : { impressions: 5400, engagements: 210, clicks: 95, newFollowers: 31, conversions: 4, leads: 4, trialSignups: 2, revenue: 2400 };

const publishers = new PublisherRegistry({ linkedin: transport, email: transport });
const analytics = new DistributionAnalyticsStore(storage);
const learnings = new DistributionLearningStore(storage);
// MOCK credentials so the gated publish runs in the demo (production: unset → skipped).
const demoEnv: NodeJS.ProcessEnv = { LINKEDIN_TOKEN: "demo", GMAIL_TOKEN: "demo" };
const engine = new DistributionEngine(queue, publishers, analytics, { env: demoEnv, clock, metrics, learnings });

console.log("\n=== 3. Distribute approved jobs (Brand Guardian → gated publish) ===");
console.log(engine.run());

console.log("\n=== 4. Health check (no creds = inert + setup hint) ===");
for (const { channel, health } of publishers.healthReport({})) console.log(`  ${channel}: ${health.ok ? "OK" : "—"} ${health.detail}`);

console.log("\n=== 5. Learning (which content wins) ===");
for (const l of learnFromMetrics(analytics.all(), queue.all()).slice(0, 6)) {
  console.log(`  [${l.dimension}] ${l.key}: ${l.posts} post(s), conv ${l.conversions}, rev ${l.revenue}, eng ${l.avgEngagement} (${l.confidence})`);
}

console.log("\n=== 6. Executive Report — Distribution section ===\n");
console.log(renderDistributionSection(buildDistributionSection(queue.all(), analytics.all())));
