// Business Impact prioritization tests (V1.2). Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  WEIGHTS,
  CATEGORY_RANK,
  TEST_DOWNGRADE,
  businessScore,
  productFirstMode,
  prioritize,
  type PrioritizableGoal,
  type StabilitySignal,
} from "./goal-prioritization.js";

const STABLE: StabilitySignal = { typecheckGreen: true, buildGreen: true, noRegressions: true, healthScore: 75, coreTested: true };
const STABLE_PFM: StabilitySignal = { ...STABLE, healthScore: 95 };
const UNSTABLE: StabilitySignal = { ...STABLE, typecheckGreen: false };

const goal = (over: Partial<PrioritizableGoal> & Pick<PrioritizableGoal, "id" | "category">): PrioritizableGoal => ({
  title: over.id,
  dimensions: { revenueImpact: 0, customerValue: 0, growthPotential: 0, strategicValue: 0, engineeringHealth: 0, engineeringCost: 0, risk: 0 },
  ...over,
});

const revenue = goal({ id: "rev", category: "revenue", dimensions: { revenueImpact: 8, customerValue: 6, growthPotential: 5, strategicValue: 5, engineeringHealth: 3, engineeringCost: 4, risk: 3 } });
const testGoal = goal({ id: "test", category: "tests", isTest: true, dimensions: { revenueImpact: 0, customerValue: 0, growthPotential: 0, strategicValue: 2, engineeringHealth: 10, engineeringCost: 2, risk: 1 } });

const byId = (ranked: ReturnType<typeof prioritize>, id: string) => ranked.find((r) => r.goal.id === id)!;

describe("V1.2: weighting", () => {
  test("matches the configured V1.2 weights exactly", () => {
    assert.deepEqual(WEIGHTS, {
      revenueImpact: 0.3, customerValue: 0.25, growthPotential: 0.15,
      strategicValue: 0.15, engineeringHealth: 0.1, engineeringCost: -0.05, risk: -0.1,
    });
  });

  test("businessScore is the weighted sum (all-10 → 8.0)", () => {
    assert.equal(businessScore({ revenueImpact: 10, customerValue: 10, growthPotential: 10, strategicValue: 10, engineeringHealth: 10, engineeringCost: 10, risk: 10 }), 8);
  });
});

describe("V1.2: Product First Mode", () => {
  test("on only when typecheck+build green, no regressions, health ≥ 90, core tested", () => {
    assert.equal(productFirstMode(STABLE_PFM), true);
    assert.equal(productFirstMode(STABLE), false); // health 75 < 90
    assert.equal(productFirstMode(UNSTABLE), false);
  });
});

describe("V1.2: test-goal downgrade", () => {
  test("pure test goals are downgraded once stability is sufficient", () => {
    const ranked = prioritize([revenue, testGoal], STABLE);
    const t = byId(ranked, "test");
    assert.equal(t.score, t.baseScore * TEST_DOWNGRADE);
    assert.equal(ranked[0]?.goal.id, "rev", "revenue outranks a downgraded test goal");
  });

  test("test goals are NOT downgraded when unstable", () => {
    const ranked = prioritize([revenue, testGoal], UNSTABLE);
    const t = byId(ranked, "test");
    assert.equal(t.score, t.baseScore);
  });
});

describe("V1.2: engineering re-prioritization", () => {
  const dims = { revenueImpact: 2, customerValue: 8, growthPotential: 0, strategicValue: 3, engineeringHealth: 6, engineeringCost: 3, risk: 2 };
  test("non-critical engineering is pushed behind product goals in Product First Mode", () => {
    const eng = goal({ id: "eng", category: "engineering", dimensions: dims });
    const r = byId(prioritize([eng], STABLE_PFM), "eng");
    assert.ok(r.score < r.baseScore);
  });
  test("critical engineering keeps full priority even in Product First Mode", () => {
    const crit = goal({ id: "crit", category: "engineering", criticalEngineering: true, dimensions: dims });
    const r = byId(prioritize([crit], STABLE_PFM), "crit");
    assert.equal(r.score, r.baseScore);
  });
});

describe("V1.2: category order", () => {
  test("equal scores break ties by business-priority order (revenue before marketing)", () => {
    const d = { revenueImpact: 5, customerValue: 5, growthPotential: 5, strategicValue: 5, engineeringHealth: 5, engineeringCost: 5, risk: 5 };
    const ranked = prioritize([goal({ id: "mkt", category: "marketing", dimensions: d }), goal({ id: "rev2", category: "revenue", dimensions: d })], STABLE);
    assert.equal(ranked[0]?.goal.id, "rev2");
    assert.ok(CATEGORY_RANK.revenue < CATEGORY_RANK.tests);
  });
});
