// Business Impact — the six-area outcome metric model + ROI + verdict.
//
// This is the measurement vocabulary of the Outcome Engine: the spec's six
// business areas (Revenue, Marketing, Sales, Product, Supplier, Customer
// Success), each with the KPIs the sprint lists, mapped to the EXISTING data
// sources (evidence.ts / DATA_SOURCES). Every metric reading is tagged through
// the Evidence Layer (tagKpi), so a number is only ever reported when its
// source is live — otherwise it is explicitly a low-confidence hypothesis with
// value=null. No guesses, no estimates without a flag. Deterministic, offline
// by default.

import { type Confidence, tagKpi } from "./evidence.js";

/** The six business areas every implemented goal is assessed against. */
export type BusinessArea =
  | "revenue"
  | "marketing"
  | "sales"
  | "product"
  | "supplier"
  | "customerSuccess";

export const BUSINESS_AREAS: BusinessArea[] = [
  "revenue",
  "marketing",
  "sales",
  "product",
  "supplier",
  "customerSuccess",
];

/** A single KPI: which area it belongs to, which data source feeds it, polarity. */
export interface KpiSpec {
  area: BusinessArea;
  kpi: string;
  /** A source name from DATA_SOURCES (evidence.ts). */
  source: string;
  /** True when a DECREASE is the improvement (churn, tickets, sales cycle …). */
  lowerIsBetter: boolean;
}

/**
 * The KPI catalogue — exactly the metrics the sprint enumerates, each pointed
 * at an existing data source. Reusing the connector env-convention means no new
 * integrations: a KPI is "live" only when its source's env vars are set.
 */
export const KPI_CATALOGUE: KpiSpec[] = [
  // Revenue — Stripe (billing) + CRM (pipeline).
  { area: "revenue", kpi: "mrr", source: "Stripe", lowerIsBetter: false },
  { area: "revenue", kpi: "arr", source: "Stripe", lowerIsBetter: false },
  { area: "revenue", kpi: "newCustomers", source: "Stripe", lowerIsBetter: false },
  { area: "revenue", kpi: "pipelineValue", source: "CRM", lowerIsBetter: false },
  { area: "revenue", kpi: "enterpriseOpportunities", source: "CRM", lowerIsBetter: false },

  // Marketing — Search Console (SEO) + social connectors.
  { area: "marketing", kpi: "organicTraffic", source: "Google Search Console", lowerIsBetter: false },
  { area: "marketing", kpi: "impressions", source: "Google Search Console", lowerIsBetter: false },
  { area: "marketing", kpi: "clickThroughRate", source: "Google Search Console", lowerIsBetter: false },
  { area: "marketing", kpi: "rankingChanges", source: "Google Search Console", lowerIsBetter: false },
  { area: "marketing", kpi: "newKeywords", source: "Google Search Console", lowerIsBetter: false },
  { area: "marketing", kpi: "socialReach", source: "LinkedIn", lowerIsBetter: false },
  { area: "marketing", kpi: "newFollowers", source: "LinkedIn", lowerIsBetter: false },

  // Sales — CRM.
  { area: "sales", kpi: "qualifiedLeads", source: "CRM", lowerIsBetter: false },
  { area: "sales", kpi: "demoBookings", source: "CRM", lowerIsBetter: false },
  { area: "sales", kpi: "demoToOpportunityRate", source: "CRM", lowerIsBetter: false },
  { area: "sales", kpi: "winRate", source: "CRM", lowerIsBetter: false },
  { area: "sales", kpi: "salesCycleDays", source: "CRM", lowerIsBetter: true },

  // Product — GA4 (behaviour) + Supabase (app data).
  { area: "product", kpi: "trialSignups", source: "Google Analytics 4", lowerIsBetter: false },
  { area: "product", kpi: "activationRate", source: "Google Analytics 4", lowerIsBetter: false },
  { area: "product", kpi: "timeToFirstValueMin", source: "Google Analytics 4", lowerIsBetter: true },
  { area: "product", kpi: "featureAdoption", source: "Supabase", lowerIsBetter: false },
  { area: "product", kpi: "retention", source: "Supabase", lowerIsBetter: false },
  { area: "product", kpi: "churn", source: "Supabase", lowerIsBetter: true },

  // Supplier Network — Supabase (the supplier graph lives there).
  { area: "supplier", kpi: "supplierInvitations", source: "Supabase", lowerIsBetter: false },
  { area: "supplier", kpi: "supplierRegistrations", source: "Supabase", lowerIsBetter: false },
  { area: "supplier", kpi: "supplierActivations", source: "Supabase", lowerIsBetter: false },
  { area: "supplier", kpi: "responseRate", source: "Supabase", lowerIsBetter: false },
  { area: "supplier", kpi: "primaryDataPct", source: "Supabase", lowerIsBetter: false },
  { area: "supplier", kpi: "pcfRequests", source: "Supabase", lowerIsBetter: false },
  { area: "supplier", kpi: "scope3Coverage", source: "Supabase", lowerIsBetter: false },

  // Customer Success — Supabase (product) + Gmail (support inbox).
  { area: "customerSuccess", kpi: "nps", source: "Supabase", lowerIsBetter: false },
  { area: "customerSuccess", kpi: "supportTickets", source: "Gmail", lowerIsBetter: true },
  { area: "customerSuccess", kpi: "faqUsage", source: "Supabase", lowerIsBetter: false },
  { area: "customerSuccess", kpi: "helpCenterViews", source: "Supabase", lowerIsBetter: false },
  { area: "customerSuccess", kpi: "responseTimeMin", source: "Gmail", lowerIsBetter: true },
  { area: "customerSuccess", kpi: "satisfaction", source: "Supabase", lowerIsBetter: false },
];

/** Every KPI spec for one area. */
export function kpisForArea(area: BusinessArea): KpiSpec[] {
  return KPI_CATALOGUE.filter((k) => k.area === area);
}

/** A live measurement pair for one KPI (current vs the prior period). */
export interface MetricSample {
  value: number;
  previous: number;
}

/** Provides a live sample for a KPI, or undefined when none is available. */
export type SampleProvider = (kpi: string) => MetricSample | undefined;

/**
 * One KPI reading with its full evidence tag. `value`/`previous`/`deltaPct` are
 * non-null ONLY when the source is live AND a sample exists — otherwise the KPI
 * is an explicit hypothesis (value null, confidence low).
 */
export interface MetricReading {
  area: BusinessArea;
  kpi: string;
  source: string;
  timestamp: string;
  confidence: Confidence;
  freshness: string;
  /** True when a decrease is the improvement (carried from the spec). */
  lowerIsBetter: boolean;
  value: number | null;
  previous: number | null;
  /** Percent change vs the prior period (business-agnostic sign). */
  deltaPct: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Read one KPI: Evidence-tag it, attach a live sample only when the source is live. */
export function readMetric(
  spec: KpiSpec,
  sample: MetricSample | undefined,
  env: NodeJS.ProcessEnv,
  clock: () => string,
): MetricReading {
  const ev = tagKpi(spec.kpi, spec.source, env);
  const live = ev.confidence === "high";
  const value = live && sample ? sample.value : null;
  const previous = live && sample ? sample.previous : null;
  const deltaPct =
    value !== null && previous !== null && previous !== 0
      ? round2(((value - previous) / previous) * 100)
      : null;
  return {
    area: spec.area,
    kpi: spec.kpi,
    source: ev.source,
    timestamp: clock(),
    confidence: ev.confidence,
    freshness: ev.freshness,
    lowerIsBetter: spec.lowerIsBetter,
    value,
    previous,
    deltaPct,
  };
}

/** Read every KPI for the given areas (all six when areas is empty). */
export function readMetrics(
  areas: BusinessArea[],
  samples: SampleProvider | undefined,
  env: NodeJS.ProcessEnv,
  clock: () => string,
): MetricReading[] {
  const want = areas.length > 0 ? areas : BUSINESS_AREAS;
  return KPI_CATALOGUE.filter((k) => want.includes(k.area)).map((spec) =>
    readMetric(spec, samples?.(spec.kpi), env, clock),
  );
}

/** A goal's verdict after measurement. */
export type Verdict = "successful" | "neutral" | "negative" | "no-measurable-impact";

/** ≥ this avg business-positive %Δ across live metrics ⇒ successful. */
export const SUCCESS_THRESHOLD_PCT = 1;
/** ≤ -this ⇒ negative. */
export const NEGATIVE_THRESHOLD_PCT = -1;

/** The measured business movement aggregated across an area set. */
export interface ImpactAggregate {
  /** How many readings had live, comparable data. */
  liveCount: number;
  /** Avg business-positive %Δ across live metrics (0 when none are live). */
  actualImpact: number;
  verdict: Verdict;
  confidence: Confidence;
}

/**
 * Aggregate readings into one business movement. "Business-positive" flips the
 * sign for lower-is-better KPIs (a churn drop is a gain). With no live metric,
 * the result is the explicit "no-measurable-impact" verdict — the spec's
 * "kein nachweisbarer Business Impact".
 */
export function aggregateImpact(readings: MetricReading[]): ImpactAggregate {
  const live = readings.filter((r) => r.value !== null && r.deltaPct !== null);
  if (live.length === 0) {
    return { liveCount: 0, actualImpact: 0, verdict: "no-measurable-impact", confidence: "low" };
  }
  const positive = live.map((r) => (r.lowerIsBetter ? -(r.deltaPct as number) : (r.deltaPct as number)));
  const net = round2(positive.reduce((a, b) => a + b, 0) / positive.length);
  const verdict: Verdict =
    net >= SUCCESS_THRESHOLD_PCT ? "successful" : net <= NEGATIVE_THRESHOLD_PCT ? "negative" : "neutral";
  return { liveCount: live.length, actualImpact: net, verdict, confidence: "high" };
}

/**
 * ROI ratio = realized business movement ÷ expected business value.
 * 1.0 means the change met its expectation; >1 exceeded it; 0 when there was
 * no expectation to measure against.
 */
export function computeRoi(expectedImpact: number, actualImpact: number): number {
  if (expectedImpact <= 0) return 0;
  return round2(actualImpact / expectedImpact);
}

/** A representative DATA_SOURCE for an area (its first catalogued KPI's source). */
export function primarySourceForArea(area: BusinessArea): string {
  return KPI_CATALOGUE.find((k) => k.area === area)?.source ?? "none";
}

/**
 * Business-positive avg %Δ per area across the LIVE readings (only areas that
 * had at least one live, comparable metric). "Business-positive" flips the sign
 * for lower-is-better KPIs, exactly like aggregateImpact. Areas with no live
 * data are absent from the result — never a fabricated zero.
 */
export function impactByArea(readings: MetricReading[]): Partial<Record<BusinessArea, number>> {
  const byArea = new Map<BusinessArea, number[]>();
  for (const r of readings) {
    if (r.value === null || r.deltaPct === null) continue;
    const positive = r.lowerIsBetter ? -(r.deltaPct) : r.deltaPct;
    const arr = byArea.get(r.area) ?? [];
    arr.push(positive);
    byArea.set(r.area, arr);
  }
  const out: Partial<Record<BusinessArea, number>> = {};
  for (const [area, vals] of byArea) {
    out[area] = round2(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return out;
}
