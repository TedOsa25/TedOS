// Business Impact Dashboard tests. Deterministic, offline — injected clock.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { GoalAttribution } from "./goal-attribution.js";
import type { OutcomeLearning } from "./learning.js";
import { buildDashboard, renderDashboard, type AttributionHistory, type LearningHistory } from "./business-dashboard.js";

const NOW = new Date("2026-06-26T00:00:00.000Z");
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const now = (): Date => NOW;

const attr = (over: Partial<GoalAttribution>): GoalAttribution => ({
  goalId: "g", title: "t", commit: "uncommitted", implementedAt: daysAgo(1),
  files: [], productAreas: ["revenue"], expectedImpact: 6,
  actualImpact: 0, roi: 0, confidence: "low", verdict: "no-measurable-impact",
  ...over,
});

const learn = (over: Partial<OutcomeLearning>): OutcomeLearning => ({
  goalId: "g", verdict: "successful", classification: "successful", roi: 1, confidence: "high",
  reason: "x", source: "revenue", watchdogAccurate: true, timestamp: daysAgo(1), ...over,
});

const history = (attrs: GoalAttribution[]): AttributionHistory => ({ all: () => attrs });
const lhistory = (ls: OutcomeLearning[]): LearningHistory => ({ all: () => ls });

describe("Business Dashboard: empty / no live data", () => {
  test("no records → low confidence, null leaders, KPIs all flat", () => {
    const d = buildDashboard(history([]), lhistory([]), now);
    assert.equal(d.confidence, "low");
    assert.equal(d.hasLiveData, false);
    assert.equal(d.highestRoi, null);
    assert.equal(d.mostSuccessfulWatchdog, null);
    assert.equal(d.kpis.length, 6);
    assert.ok(d.kpis.every((k) => k.confidence === "low" && k.delta === 0));
  });

  test("hypothesis-only attributions (confidence low) don't fabricate impact", () => {
    const d = buildDashboard(history([attr({ goalId: "h1" })]), lhistory([]), now);
    assert.equal(d.hasLiveData, false);
    assert.equal(d.highestRoi, null, "no measured goal ⇒ no ROI leader");
  });
});

describe("Business Dashboard: with measured outcomes", () => {
  const attrs = [
    attr({ goalId: "rev-1", actualImpact: 10, roi: 1.67, confidence: "high", verdict: "successful", areaImpacts: { revenue: 10 }, implementedAt: daysAgo(2) }),
    attr({ goalId: "sup-1", productAreas: ["supplier"], actualImpact: -3, roi: -0.6, confidence: "high", verdict: "negative", areaImpacts: { supplier: -3 }, implementedAt: daysAgo(20) }),
  ];

  test("ROI leaders pick the measured high and low", () => {
    const d = buildDashboard(history(attrs), lhistory([]), now);
    assert.equal(d.highestRoi?.goalId, "rev-1");
    assert.equal(d.lowestRoi?.goalId, "sup-1");
    assert.equal(d.confidence, "high");
    assert.equal(d.hasLiveData, true);
  });

  test("7d window excludes the 20-day-old goal; 30d includes it", () => {
    const d = buildDashboard(history(attrs), lhistory([]), now);
    assert.deepEqual(d.topGoals7d.map((g) => g.goalId), ["rev-1"]);
    assert.deepEqual(new Set(d.topGoals30d.map((g) => g.goalId)), new Set(["rev-1", "sup-1"]));
  });

  test("per-area KPI carries source, trend and delta", () => {
    const d = buildDashboard(history(attrs), lhistory([]), now);
    const revenue = d.kpis.find((k) => k.area === "revenue");
    assert.equal(revenue?.confidence, "high");
    assert.equal(revenue?.delta, 10);
    assert.equal(revenue?.trend, "up");
    assert.equal(revenue?.source, "Stripe");
    const supplier = d.kpis.find((k) => k.area === "supplier");
    assert.equal(supplier?.trend, "down");
    assert.equal(supplier?.delta, -3);
  });
});

describe("Business Dashboard: watchdog leaderboard", () => {
  test("ranks watchdogs by accuracy; only decided learnings count", () => {
    const ls = [
      learn({ source: "revenue", classification: "successful", watchdogAccurate: true, roi: 1.6 }),
      learn({ source: "supplier", classification: "negative", watchdogAccurate: false, roi: -0.5 }),
      learn({ source: "unknown", watchdogAccurate: null }), // ignored
    ];
    const d = buildDashboard(history([]), lhistory(ls), now);
    assert.equal(d.mostSuccessfulWatchdog?.watchdog, "revenue");
    assert.equal(d.mostSuccessfulWatchdog?.accuracy, 1);
    assert.equal(d.leastSuccessfulWatchdog?.watchdog, "supplier");
    assert.equal(d.leastSuccessfulWatchdog?.accuracy, 0);
  });
});

describe("Business Dashboard: render", () => {
  test("renders the required sections", () => {
    const out = renderDashboard(buildDashboard(history([]), lhistory([]), now));
    for (const s of ["Business Impact Dashboard", "Top Goals (7 days)", "Top Goals (30 days)", "Highest ROI", "watchdog", "Business KPIs"]) {
      assert.ok(out.includes(s), `missing section: ${s}`);
    }
  });
});
