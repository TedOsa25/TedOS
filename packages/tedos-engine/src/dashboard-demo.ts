// Demo: the Business Impact Dashboard (Phase 5) + outcome-aware prioritization
// (Phase 6), driven entirely by the existing outcome stores. Offline,
// deterministic. Run: `npm run dashboard`.

import { InMemoryStorage } from "./storage.js";
import { AttributionStore, type GoalAttribution } from "./goal-attribution.js";
import { OutcomeLearningStore, type OutcomeLearning } from "./learning.js";
import { buildDashboard, renderDashboard } from "./business-dashboard.js";
import { OutcomeFeedbackEngine } from "./outcome-prioritization.js";
import { DeterministicImpactEngine } from "./impact.js";

const NOW = new Date("2026-06-26T00:00:00.000Z");
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

// Sample measured outcomes (as the Outcome Engine would have persisted them).
const attrs: GoalAttribution[] = [
  {
    goalId: "rev-1", title: "Improve checkout pricing", commit: "a1b2c3d", implementedAt: daysAgo(2),
    files: ["src/billing.ts"], productAreas: ["revenue"], expectedImpact: 6,
    actualImpact: 10, roi: 1.67, confidence: "high", verdict: "successful", areaImpacts: { revenue: 10 },
  },
  {
    goalId: "sales-1", title: "Add demo-booking CTA to pricing page", commit: "e4f5a6b", implementedAt: daysAgo(5),
    files: ["src/pricing.tsx"], productAreas: ["sales", "marketing"], expectedImpact: 5,
    actualImpact: 4, roi: 0.8, confidence: "high", verdict: "successful", areaImpacts: { sales: 6, marketing: 2 },
  },
  {
    goalId: "sup-1", title: "Supplier onboarding email automation", commit: "c7d8e9f", implementedAt: daysAgo(20),
    files: ["src/suppliers.ts"], productAreas: ["supplier"], expectedImpact: 5,
    actualImpact: -3, roi: -0.6, confidence: "high", verdict: "negative", areaImpacts: { supplier: -3 },
  },
];

const learnings: OutcomeLearning[] = [
  { goalId: "rev-1", verdict: "successful", classification: "successful", roi: 1.67, confidence: "high", reason: "held", source: "revenue", watchdogAccurate: true, timestamp: daysAgo(2) },
  { goalId: "sales-1", verdict: "successful", classification: "successful", roi: 0.8, confidence: "high", reason: "held", source: "growth", watchdogAccurate: true, timestamp: daysAgo(5) },
  { goalId: "sup-1", verdict: "negative", classification: "negative", roi: -0.6, confidence: "high", reason: "wrong", source: "supplier", watchdogAccurate: false, timestamp: daysAgo(20) },
];

const attributions = new AttributionStore(new InMemoryStorage());
attributions.recordMany(attrs);
const learningStore = new OutcomeLearningStore(new InMemoryStorage());
learningStore.recordMany(learnings);

console.log("=== Executive Report — Business Impact Dashboard ===\n");
console.log(renderDashboard(buildDashboard(attributions, learningStore, () => NOW)));

// Phase 6: the same realized outcomes now steer prioritization.
console.log("\n=== Outcome-aware prioritization (Phase 6) ===\n");
const scorer = new OutcomeFeedbackEngine(new DeterministicImpactEngine(), { attributions, learnings: learningStore });
for (const title of ["Improve checkout revenue flow", "Supplier activation push", "Refactor logging"]) {
  const base = new DeterministicImpactEngine().score({ id: title, title, kind: "feature" });
  const tuned = scorer.score({ id: title, title, kind: "feature" });
  const delta = Math.round((tuned.overall - base.overall) * 100) / 100;
  console.log(`• ${title}\n    base impact ${base.overall} → outcome-adjusted ${tuned.overall} (${delta >= 0 ? "+" : ""}${delta})`);
}
