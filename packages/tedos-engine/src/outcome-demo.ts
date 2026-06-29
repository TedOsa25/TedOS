// Outcome & Business Impact demo — measures one implemented goal's business
// impact two ways: offline (no data source → honest "no measurable impact")
// and with a live source + samples (→ ROI + verdict). Deterministic.

import type { GoalExecution } from "./trace.js";
import type { ScoredGoal } from "./impact.js";
import type { MetricSample } from "./business-impact.js";
import { DeterministicImpactEngine } from "./impact.js";
import { OutcomeEngine, type OutcomeAssessment } from "./outcome-engine.js";

const clock = (): string => "2026-06-25T18:00:00.000Z";

// A goal TedOS "implemented" this tick (done + approved), as the Runtime emits it.
const exec: GoalExecution = {
  id: "carbo-checkout",
  title: "Improve trial→paid conversion in checkout pricing",
  priority: 8,
  status: "done",
  attempts: 1,
  tasks: [
    { title: "Update pricing page", kind: "coding", worker: "local", status: "ok", output: "ok", changedFiles: ["src/checkout.ts", "src/pricing.tsx"], commands: ["git commit -m 'pricing' → a1b2c3d4"] },
  ],
  verification: { passed: true, skipped: false, steps: [] },
  policy: { level: "SAFE", reason: "low-risk" },
  review: { approved: true, reason: "All checks passed." },
};

// Its expected business value (the same scorer the loop uses).
const scored: ScoredGoal = new DeterministicImpactEngine().score({ id: exec.id, title: exec.title, kind: "feature" });

const engine = new OutcomeEngine(clock);

function show(label: string, a: OutcomeAssessment): void {
  const at = a.attribution;
  console.log(`\n── ${label} ──`);
  console.log(`Goal:          ${at.goalId} — ${at.title}`);
  console.log(`Commit:        ${at.commit}   Implemented: ${at.implementedAt}`);
  console.log(`Files:         ${at.files.join(", ")}`);
  console.log(`Product areas: ${at.productAreas.join(", ") || "(all)"}`);
  console.log(`Expected:      ${at.expectedImpact}/10   Actual: ${at.actualImpact}%   ROI: ${at.roi}   (${at.confidence})`);
  console.log(`Verdict:       ${at.verdict.toUpperCase()}`);
  console.log(`Learning:      [${a.learning.classification}] ${a.learning.reason}`);
  console.log(`Watchdog "${a.learning.source}" accurate: ${a.learning.watchdogAccurate}`);
  const live = a.readings.filter((r) => r.value !== null);
  console.log(`Live metrics:  ${live.length}/${a.readings.length}${live.length ? " → " + live.map((r) => `${r.kpi} ${r.deltaPct! > 0 ? "+" : ""}${r.deltaPct}%`).join(", ") : ""}`);
}

// 1) Offline: no data source configured → no fabricated numbers.
show("Offline (no data source)", engine.analyze(exec, scored, { env: {}, source: "growth" }));

// 2) Live: Stripe + GA4 configured, with sample readings → measurable impact + ROI.
const env: NodeJS.ProcessEnv = { STRIPE_SECRET_KEY: "sk", GA4_PROPERTY_ID: "123", GA4_SERVICE_ACCOUNT_JSON: "{}" };
const samples: Record<string, MetricSample> = {
  mrr: { value: 11800, previous: 11000 },
  newCustomers: { value: 27, previous: 22 },
  trialSignups: { value: 140, previous: 120 },
  activationRate: { value: 0.41, previous: 0.38 },
};
show("Live (Stripe + GA4 configured)", engine.analyze(exec, scored, { env, samples: (k) => samples[k], source: "growth" }));
