// Outcome Engine tests. Deterministic, offline — injected env, samples, clock.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { GoalExecution } from "./trace.js";
import type { ScoredGoal } from "./impact.js";
import type { MetricSample } from "./business-impact.js";
import { OutcomeEngine, isImplemented } from "./outcome-engine.js";

const clock = (): string => "2026-06-25T00:00:00.000Z";
const engine = new OutcomeEngine(clock);

const scored: ScoredGoal = {
  candidate: { id: "rev-1", title: "t", kind: "feature" },
  dimensions: { businessImpact: 6, userImpact: 6, revenuePotential: 6, technicalRisk: 4, implementationEffort: 5 },
  overall: 9,
  reasoning: "x",
};

const exec = (over: Partial<GoalExecution> = {}): GoalExecution => ({
  id: "rev-1",
  title: "Improve checkout pricing",
  priority: 8,
  status: "done",
  attempts: 1,
  tasks: [{ title: "edit", kind: "coding", worker: "local", status: "ok", output: "", changedFiles: ["src/billing.ts"], commands: [] }],
  verification: { passed: true, skipped: false, steps: [] },
  policy: { level: "SAFE", reason: "ok" },
  review: { approved: true, reason: "done" },
  ...over,
});

const STRIPE: NodeJS.ProcessEnv = { STRIPE_SECRET_KEY: "sk" };
const samples = (map: Record<string, MetricSample>) => (kpi: string): MetricSample | undefined => map[kpi];

describe("Outcome Engine: isImplemented", () => {
  test("true only for done + approved", () => {
    assert.equal(isImplemented(exec()), true);
    assert.equal(isImplemented(exec({ status: "failed" })), false);
    assert.equal(isImplemented(exec({ review: { approved: false, reason: "blocked" } })), false);
  });
});

describe("Outcome Engine: analyze", () => {
  test("no data source → 'kein nachweisbarer Business Impact'", () => {
    const a = engine.analyze(exec(), scored, { env: {} });
    assert.equal(a.attribution.verdict, "no-measurable-impact");
    assert.equal(a.attribution.actualImpact, 0);
    assert.equal(a.attribution.confidence, "low");
    assert.equal(a.learning.classification, "neutral");
    assert.match(a.learning.reason, /Kein nachweisbarer Business Impact/);
    assert.equal(a.attribution.expectedImpact, 6); // (6+6+6)/3
  });

  test("live data with positive movement → successful + ROI + watchdog credited", () => {
    const a = engine.analyze(exec(), scored, {
      env: STRIPE,
      samples: samples({ mrr: { value: 110, previous: 100 } }),
      source: "revenue",
    });
    assert.equal(a.attribution.verdict, "successful");
    assert.equal(a.attribution.actualImpact, 10);
    assert.equal(a.attribution.confidence, "high");
    assert.equal(a.attribution.roi, 1.67, "round2(actual 10 ÷ expected 6)");
    assert.ok(a.attribution.roi > 1, "actual exceeded expectation");
    assert.equal(a.learning.classification, "successful");
    assert.equal(a.learning.source, "revenue");
    assert.equal(a.learning.watchdogAccurate, true);
  });

  test("negative movement → negative + watchdog discredited", () => {
    const a = engine.analyze(exec(), scored, {
      env: STRIPE,
      samples: samples({ mrr: { value: 90, previous: 100 } }),
      source: "revenue",
    });
    assert.equal(a.attribution.verdict, "negative");
    assert.equal(a.learning.classification, "negative");
    assert.equal(a.learning.watchdogAccurate, false);
  });

  test("unknown source → watchdogAccurate is null", () => {
    const a = engine.analyze(exec(), scored, { env: STRIPE, samples: samples({ mrr: { value: 110, previous: 100 } }) });
    assert.equal(a.learning.source, "unknown");
    assert.equal(a.learning.watchdogAccurate, null);
  });
});

describe("Outcome Engine: analyzeRun", () => {
  test("measures only implemented goals that have a score", () => {
    const execs = [
      exec({ id: "rev-1" }),
      exec({ id: "fail-1", status: "failed" }),
      exec({ id: "no-score" }),
    ];
    const scoredById = new Map([["rev-1", scored]]); // no-score deliberately absent
    const out = engine.analyzeRun(execs, scoredById, { env: {} });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.attribution.goalId, "rev-1");
  });

  test("sourcesById attributes the proposing watchdog per goal", () => {
    const out = engine.analyzeRun([exec({ id: "rev-1" })], new Map([["rev-1", scored]]), {
      env: STRIPE,
      samples: samples({ mrr: { value: 120, previous: 100 } }),
      sourcesById: new Map([["rev-1", "revenue"]]),
    });
    assert.equal(out[0]?.learning.source, "revenue");
    assert.equal(out[0]?.learning.watchdogAccurate, true);
  });
});
