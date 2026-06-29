// Outcome-aware prioritization tests. Deterministic, offline.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { GoalCandidate } from "./types.js";
import type { GoalAttribution } from "./goal-attribution.js";
import type { OutcomeLearning } from "./learning.js";
import type { ImpactScorer, ScoredGoal } from "./impact.js";
import { DeterministicImpactEngine } from "./impact.js";
import type { AttributionHistory, LearningHistory } from "./business-dashboard.js";
import { OutcomeFeedbackEngine, MAX_OUTCOME_ADJUSTMENT } from "./outcome-prioritization.js";

const attr = (over: Partial<GoalAttribution>): GoalAttribution => ({
  goalId: "g", title: "t", commit: "c", implementedAt: "2026-06-25T00:00:00.000Z",
  files: [], productAreas: ["revenue"], expectedImpact: 6,
  actualImpact: 0, roi: 0, confidence: "low", verdict: "no-measurable-impact", ...over,
});
const learn = (over: Partial<OutcomeLearning>): OutcomeLearning => ({
  goalId: "g", verdict: "successful", classification: "successful", roi: 1, confidence: "high",
  reason: "x", source: "revenue", watchdogAccurate: true, timestamp: "2026-06-25T00:00:00.000Z", ...over,
});
const history = (attrs: GoalAttribution[]): AttributionHistory => ({ all: () => attrs });
const lhistory = (ls: OutcomeLearning[]): LearningHistory => ({ all: () => ls });
const cand = (title: string): GoalCandidate => ({ id: title, title, kind: "feature" });
const base = new DeterministicImpactEngine();

describe("OutcomeFeedbackEngine: pass-through when no evidence", () => {
  test("no measured history → score unchanged", () => {
    const e = new OutcomeFeedbackEngine(base, { attributions: history([]), learnings: lhistory([]) });
    const c = cand("Improve checkout pricing");
    assert.equal(e.score(c).overall, base.score(c).overall);
    assert.equal(e.signal(c).adjustment, 0);
  });

  test("low-confidence (hypothesis) attributions are ignored", () => {
    const e = new OutcomeFeedbackEngine(
      base,
      { attributions: history([attr({ productAreas: ["revenue"], areaImpacts: { revenue: 50 }, confidence: "low" })]), learnings: lhistory([]) },
    );
    assert.equal(e.signal(cand("Improve checkout pricing")).adjustment, 0);
  });
});

describe("OutcomeFeedbackEngine: learns from realized outcomes", () => {
  test("positive realized revenue impact raises a revenue candidate", () => {
    const attrs = [attr({ goalId: "r1", productAreas: ["revenue"], actualImpact: 10, roi: 1.67, confidence: "high", areaImpacts: { revenue: 10 } })];
    const e = new OutcomeFeedbackEngine(base, { attributions: history(attrs), learnings: lhistory([]) });
    const c = cand("Improve checkout pricing"); // infers revenue area
    const s = e.signal(c);
    assert.ok(s.measuredGoals >= 1);
    assert.ok(s.adjustment > 0, "good outcomes raise impact");
    assert.equal(e.score(c).overall, base.score(c).overall + s.adjustment);
  });

  test("negative realized impact lowers a candidate in that area", () => {
    const attrs = [attr({ goalId: "s1", productAreas: ["supplier"], actualImpact: -8, roi: -1, confidence: "high", areaImpacts: { supplier: -8 } })];
    const e = new OutcomeFeedbackEngine(base, { attributions: history(attrs), learnings: lhistory([]) });
    assert.ok(e.signal(cand("Supplier onboarding automation")).adjustment < 0);
  });

  test("adjustment is bounded", () => {
    const attrs = [attr({ productAreas: ["revenue"], actualImpact: 999, roi: 999, confidence: "high", areaImpacts: { revenue: 999 } })];
    const e = new OutcomeFeedbackEngine(base, { attributions: history(attrs), learnings: lhistory([]) });
    assert.ok(Math.abs(e.signal(cand("Improve checkout pricing")).adjustment) <= MAX_OUTCOME_ADJUSTMENT);
  });
});

describe("OutcomeFeedbackEngine: watchdog accuracy via sourceOf", () => {
  test("an accurate watchdog adds, an inaccurate one subtracts", () => {
    const ls = [
      learn({ source: "growth", watchdogAccurate: true }),
      learn({ source: "growth", watchdogAccurate: true }),
      learn({ source: "hype", watchdogAccurate: false }),
      learn({ source: "hype", watchdogAccurate: false }),
    ];
    const stores = { attributions: history([]), learnings: lhistory(ls) };
    const good = new OutcomeFeedbackEngine(base, stores, { sourceOf: () => "growth" });
    const bad = new OutcomeFeedbackEngine(base, stores, { sourceOf: () => "hype" });
    const c = cand("totally unrelated thing"); // no area → isolates the watchdog term
    assert.equal(good.signal(c).watchdogAccuracy, 1);
    assert.ok(good.signal(c).adjustment > 0);
    assert.equal(bad.signal(c).watchdogAccuracy, 0);
    assert.ok(bad.signal(c).adjustment < 0);
  });
});

describe("OutcomeFeedbackEngine: ImpactScorer contract", () => {
  test("is a drop-in scorer with a descriptive name", () => {
    const e: ImpactScorer = new OutcomeFeedbackEngine(base, { attributions: history([]), learnings: lhistory([]) });
    assert.equal(e.name, "outcome(deterministic)");
    const s: ScoredGoal = e.score(cand("x"));
    assert.ok(typeof s.overall === "number");
  });
});
