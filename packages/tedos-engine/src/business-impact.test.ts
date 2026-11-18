// Business Impact tests. Deterministic, offline — injected env + clock.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DATA_SOURCES } from "./evidence.js";
import {
  BUSINESS_AREAS,
  KPI_CATALOGUE,
  kpisForArea,
  readMetric,
  readMetrics,
  aggregateImpact,
  computeRoi,
  type KpiSpec,
  type MetricSample,
} from "./business-impact.js";

const clock = (): string => "2026-06-25T00:00:00.000Z";
const EMPTY: NodeJS.ProcessEnv = {};
const WITH_STRIPE: NodeJS.ProcessEnv = { STRIPE_SECRET_KEY: "sk_test" };

const spec = (over: Partial<KpiSpec> & Pick<KpiSpec, "kpi" | "source">): KpiSpec => ({
  area: "revenue",
  lowerIsBetter: false,
  ...over,
});

describe("Business Impact: catalogue", () => {
  test("covers all six areas and every KPI maps to a real data source", () => {
    const areas = new Set(KPI_CATALOGUE.map((k) => k.area));
    for (const a of BUSINESS_AREAS) assert.ok(areas.has(a), `area present: ${a}`);
    const sources = new Set(DATA_SOURCES.map((d) => d.source));
    for (const k of KPI_CATALOGUE) assert.ok(sources.has(k.source), `${k.kpi} → known source (${k.source})`);
  });

  test("includes the spec's headline KPIs", () => {
    const kpis = new Set(KPI_CATALOGUE.map((k) => k.kpi));
    for (const k of ["mrr", "arr", "qualifiedLeads", "demoBookings", "trialSignups", "scope3Coverage", "nps", "churn"]) {
      assert.ok(kpis.has(k), `KPI present: ${k}`);
    }
  });

  test("kpisForArea returns only that area", () => {
    assert.ok(kpisForArea("supplier").every((k) => k.area === "supplier"));
    assert.ok(kpisForArea("supplier").length > 0);
  });
});

describe("Business Impact: readMetric (Evidence-tagged)", () => {
  test("no live source → value null, confidence low, hypothesis freshness", () => {
    const r = readMetric(spec({ kpi: "mrr", source: "Stripe" }), { value: 100, previous: 90 }, EMPTY, clock);
    assert.equal(r.value, null, "no fabricated number without a live source");
    assert.equal(r.previous, null);
    assert.equal(r.deltaPct, null);
    assert.equal(r.confidence, "low");
    assert.equal(r.freshness, "n/a (hypothesis)");
    assert.equal(r.timestamp, "2026-06-25T00:00:00.000Z");
  });

  test("live source + sample → value set and deltaPct computed", () => {
    const r = readMetric(spec({ kpi: "mrr", source: "Stripe" }), { value: 110, previous: 100 }, WITH_STRIPE, clock);
    assert.equal(r.value, 110);
    assert.equal(r.previous, 100);
    assert.equal(r.deltaPct, 10);
    assert.equal(r.confidence, "high");
    assert.equal(r.source, "Stripe");
  });

  test("live source but no sample → still a flagged hypothesis (no guess)", () => {
    const r = readMetric(spec({ kpi: "mrr", source: "Stripe" }), undefined, WITH_STRIPE, clock);
    assert.equal(r.value, null);
    assert.equal(r.deltaPct, null);
  });

  test("readMetrics with empty area list reads every area", () => {
    const all = readMetrics([], undefined, EMPTY, clock);
    assert.equal(all.length, KPI_CATALOGUE.length);
  });
});

describe("Business Impact: aggregateImpact", () => {
  const live = (over: Partial<KpiSpec> & Pick<KpiSpec, "kpi" | "source">, sample: MetricSample) =>
    readMetric(spec(over), sample, WITH_STRIPE, clock);

  test("no live metric → 'kein nachweisbarer Business Impact'", () => {
    const agg = aggregateImpact(readMetrics(["revenue"], undefined, EMPTY, clock));
    assert.equal(agg.verdict, "no-measurable-impact");
    assert.equal(agg.liveCount, 0);
    assert.equal(agg.actualImpact, 0);
    assert.equal(agg.confidence, "low");
  });

  test("positive movement → successful (high confidence)", () => {
    const agg = aggregateImpact([live({ kpi: "mrr", source: "Stripe" }, { value: 110, previous: 100 })]);
    assert.equal(agg.verdict, "successful");
    assert.equal(agg.actualImpact, 10);
    assert.equal(agg.confidence, "high");
  });

  test("lower-is-better KPI flips sign: a churn drop is a gain", () => {
    const agg = aggregateImpact([live({ kpi: "churn", source: "Stripe", lowerIsBetter: true }, { value: 8, previous: 10 })]);
    assert.equal(agg.verdict, "successful", "churn 10→8 is business-positive");
    assert.equal(agg.actualImpact, 20);
  });

  test("decline → negative", () => {
    const agg = aggregateImpact([live({ kpi: "mrr", source: "Stripe" }, { value: 90, previous: 100 })]);
    assert.equal(agg.verdict, "negative");
    assert.equal(agg.actualImpact, -10);
  });

  test("flat movement → neutral", () => {
    const agg = aggregateImpact([live({ kpi: "mrr", source: "Stripe" }, { value: 100, previous: 100 })]);
    assert.equal(agg.verdict, "neutral");
    assert.equal(agg.actualImpact, 0);
  });
});

describe("Business Impact: computeRoi", () => {
  test("ratio of actual to expected", () => {
    assert.equal(computeRoi(5, 10), 2);
    assert.equal(computeRoi(8, 4), 0.5);
  });
  test("no expectation → 0 (never divide by zero)", () => {
    assert.equal(computeRoi(0, 10), 0);
    assert.equal(computeRoi(-1, 10), 0);
  });
});
