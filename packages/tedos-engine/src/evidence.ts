// Evidence Layer — make TedOS data-driven, not guess-driven.
//
// Before any analysis, a watchdog asks: "are live data available?" This module
// answers it from the SAME env-based connector convention the connectors use
// (no duplicate integrations — it only detects availability and points to
// docs/connectors-setup.md). Every KPI/analysis can then be tagged with its
// source, freshness and confidence, and missing data becomes an explicit
// checklist instead of a silent assumption. Deterministic.

export type Confidence = "high" | "low";

/** A data source TedOS can draw evidence from, and the env it needs. */
export interface DataSource {
  source: string;
  /** All env vars required for this source to be considered available. */
  envVars: string[];
}

/** The data sources, reusing existing connector env vars where they exist. */
export const DATA_SOURCES: DataSource[] = [
  { source: "Google Search Console", envVars: ["GSC_SERVICE_ACCOUNT_JSON", "GSC_SITE_URL"] },
  { source: "Google Analytics 4", envVars: ["GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON"] },
  { source: "Stripe", envVars: ["STRIPE_SECRET_KEY"] },
  { source: "CRM", envVars: ["CRM_API_KEY"] },
  { source: "Supabase", envVars: ["SUPABASE_URL", "SUPABASE_KEY"] },
  { source: "LinkedIn", envVars: ["LINKEDIN_TOKEN"] },
  { source: "Instagram", envVars: ["INSTAGRAM_TOKEN"] },
  { source: "Gmail", envVars: ["GMAIL_TOKEN"] },
];

export interface DataSourceStatus extends DataSource {
  available: boolean;
  /** Env vars still missing (empty when available). */
  missing: string[];
  confidence: Confidence;
}

/** True only when every required env var for the source is set. */
export function isAvailable(source: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const ds = DATA_SOURCES.find((d) => d.source === source);
  return ds ? ds.envVars.every((v) => Boolean(env[v])) : false;
}

/** Availability + confidence for every data source. */
export function dataSourceStatus(env: NodeJS.ProcessEnv = process.env): DataSourceStatus[] {
  return DATA_SOURCES.map((ds) => {
    const missing = ds.envVars.filter((v) => !env[v]);
    const available = missing.length === 0;
    return { ...ds, available, missing, confidence: available ? "high" : "low" };
  });
}

/** Concrete checklist of what's missing (sources + env vars) → connectors-setup.md. */
export function missingDataChecklist(env: NodeJS.ProcessEnv = process.env): string[] {
  return dataSourceStatus(env)
    .filter((s) => !s.available)
    .map((s) => `${s.source}: set ${s.missing.join(", ")} (see docs/connectors-setup.md)`);
}

/** Evidence tag for one KPI/analysis. */
export interface KpiEvidence {
  kpi: string;
  source: string;
  /** "live" when the source is available; otherwise "n/a (hypothesis)". */
  freshness: string;
  confidence: Confidence;
}

/**
 * Tag a KPI with its source + confidence. When the source isn't available the
 * KPI is explicitly marked low-confidence / hypothesis-based — never presented
 * as fact.
 */
export function tagKpi(kpi: string, source: string, env: NodeJS.ProcessEnv = process.env): KpiEvidence {
  const available = isAvailable(source, env);
  return {
    kpi,
    source: available ? source : "none",
    freshness: available ? "live" : "n/a (hypothesis)",
    confidence: available ? "high" : "low",
  };
}

/** Whether ANY live data source is available (else all analysis is hypothesis-based). */
export function hasAnyLiveData(env: NodeJS.ProcessEnv = process.env): boolean {
  return dataSourceStatus(env).some((s) => s.available);
}
