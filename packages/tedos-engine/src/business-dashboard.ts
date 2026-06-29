// Business Impact Dashboard — Phase 5 (Executive Intelligence).
//
// The primary decision surface for TedOS: it aggregates the EXISTING outcome
// stores — AttributionStore (goal-attribution.ts) and OutcomeLearningStore
// (learning.ts) — into the dashboard the sprint enumerates: Top Goals (7d/30d),
// Highest/Lowest ROI, Most/Least Successful Watchdog, and the per-area business
// KPIs (revenue, leads, supplier, organic/traffic, conversion, customer
// success). Every KPI carries Source · Timestamp · Confidence · Trend · Delta.
//
// It computes nothing new from raw data and adds no store: it reads what the
// Outcome Engine already persisted. Deterministic; the clock is injected. When
// no goal has live-measured impact, the honest answer is "no measurable impact
// yet" (null leaders, low confidence) — never a fabricated number.

import type { Confidence } from "./evidence.js";
import {
  type BusinessArea,
  primarySourceForArea,
} from "./business-impact.js";
import type { GoalAttribution } from "./goal-attribution.js";
import type { OutcomeLearning } from "./learning.js";

/** Read-only view of attribution history (AttributionStore satisfies it). */
export interface AttributionHistory {
  all(): readonly GoalAttribution[];
}

/** Read-only view of learning history (OutcomeLearningStore satisfies it). */
export interface LearningHistory {
  all(): readonly OutcomeLearning[];
}

/** One goal as it appears in a Top-Goals / ROI leader list. */
export interface GoalLine {
  goalId: string;
  title: string;
  actualImpact: number;
  roi: number;
  verdict: string;
  confidence: Confidence;
  timestamp: string;
}

/** One business KPI row — the spec's Source · Timestamp · Confidence · Trend · Delta. */
export interface KpiLine {
  label: string;
  area: BusinessArea;
  source: string;
  timestamp: string;
  confidence: Confidence;
  trend: "up" | "down" | "flat";
  /** The measured business-positive %Δ (0 when no live data for the area). */
  delta: number;
}

/** One watchdog's realized track record. */
export interface WatchdogLine {
  watchdog: string;
  /** How many of its goals were measured with live data (decided). */
  decided: number;
  successes: number;
  negatives: number;
  /** successes ÷ decided (0..1). */
  accuracy: number;
  avgRoi: number;
}

/** The full Business Impact Dashboard. */
export interface BusinessImpactDashboard {
  generatedAt: string;
  topGoals7d: GoalLine[];
  topGoals30d: GoalLine[];
  highestRoi: GoalLine | null;
  lowestRoi: GoalLine | null;
  mostSuccessfulWatchdog: WatchdogLine | null;
  leastSuccessfulWatchdog: WatchdogLine | null;
  kpis: KpiLine[];
  /** High when any KPI is backed by live data, else low (all hypothesis-based). */
  confidence: Confidence;
  hasLiveData: boolean;
}

/** The dashboard's per-area KPI rows, mapped to the spec's business questions. */
const DASHBOARD_KPIS: { label: string; area: BusinessArea }[] = [
  { label: "Revenue Generated", area: "revenue" },
  { label: "Leads Generated", area: "sales" },
  { label: "Conversion Improvement", area: "product" },
  { label: "Supplier Activation", area: "supplier" },
  { label: "Organic / Traffic Improvement", area: "marketing" },
  { label: "Customer Success", area: "customerSuccess" },
];

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A goal "has measurable impact" when its outcome was read from live data. */
function isMeasured(a: GoalAttribution): boolean {
  return a.confidence === "high";
}

function toGoalLine(a: GoalAttribution): GoalLine {
  return {
    goalId: a.goalId,
    title: a.title,
    actualImpact: a.actualImpact,
    roi: a.roi,
    verdict: a.verdict,
    confidence: a.confidence,
    timestamp: a.implementedAt,
  };
}

/** Sort key for "top": measured first, then by business movement, then ROI. */
function byImpact(a: GoalAttribution, b: GoalAttribution): number {
  const m = Number(isMeasured(b)) - Number(isMeasured(a));
  if (m !== 0) return m;
  return b.actualImpact - a.actualImpact || b.roi - a.roi;
}

/** Goals implemented within `days` of `nowMs` (bad timestamps are excluded). */
function withinWindow(attrs: readonly GoalAttribution[], nowMs: number, days: number): GoalAttribution[] {
  return attrs.filter((a) => {
    const t = Date.parse(a.implementedAt);
    return !Number.isNaN(t) && nowMs - t <= days * DAY_MS && nowMs - t >= 0;
  });
}

/** Top N goals in a window, by business impact. */
function topGoals(attrs: readonly GoalAttribution[], nowMs: number, days: number, n = 5): GoalLine[] {
  return [...withinWindow(attrs, nowMs, days)].sort(byImpact).slice(0, n).map(toGoalLine);
}

/** Aggregate one area's business-positive %Δ across all attributions that measured it. */
function kpiForArea(label: string, area: BusinessArea, attrs: readonly GoalAttribution[]): KpiLine {
  const samples: { delta: number; timestamp: string }[] = [];
  for (const a of attrs) {
    const v = a.areaImpacts?.[area];
    if (v !== undefined) samples.push({ delta: v, timestamp: a.implementedAt });
  }
  const source = primarySourceForArea(area);
  if (samples.length === 0) {
    return { label, area, source, timestamp: "n/a", confidence: "low", trend: "flat", delta: 0 };
  }
  const delta = round2(samples.reduce((s, x) => s + x.delta, 0) / samples.length);
  const timestamp = samples.map((x) => x.timestamp).sort().at(-1) as string;
  const trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { label, area, source, timestamp, confidence: "high", trend, delta };
}

/** Build the watchdog leaderboard from decided (live-measured) learnings only. */
function watchdogLeaders(learnings: readonly OutcomeLearning[]): {
  most: WatchdogLine | null;
  least: WatchdogLine | null;
} {
  const byWatchdog = new Map<string, OutcomeLearning[]>();
  for (const l of learnings) {
    if (l.source === "unknown") continue;
    // "Decided" = the source's recommendation could be credited or blamed.
    if (l.watchdogAccurate === null) continue;
    const arr = byWatchdog.get(l.source) ?? [];
    arr.push(l);
    byWatchdog.set(l.source, arr);
  }
  const lines: WatchdogLine[] = [...byWatchdog.entries()].map(([watchdog, ls]) => {
    const successes = ls.filter((l) => l.classification === "successful").length;
    const negatives = ls.filter((l) => l.classification === "negative").length;
    const decided = successes + negatives;
    const avgRoi = round2(ls.reduce((s, l) => s + l.roi, 0) / ls.length);
    return { watchdog, decided, successes, negatives, accuracy: decided ? round2(successes / decided) : 0, avgRoi };
  });
  if (lines.length === 0) return { most: null, least: null };
  const rank = (l: WatchdogLine): number => l.accuracy * 1000 + l.avgRoi + l.successes * 0.001;
  const sorted = [...lines].sort((a, b) => rank(b) - rank(a));
  return { most: sorted[0] ?? null, least: sorted.at(-1) ?? null };
}

/**
 * Build the Business Impact Dashboard from the outcome stores.
 *
 * `now` is injected (defaults to the wall clock) so the 7d/30d windows are
 * deterministic in tests and the demo.
 */
export function buildDashboard(
  attributions: AttributionHistory,
  learnings: LearningHistory,
  now: () => Date = () => new Date(),
): BusinessImpactDashboard {
  const attrs = attributions.all();
  const ls = learnings.all();
  const nowDate = now();
  const nowMs = nowDate.getTime();

  const measured = attrs.filter(isMeasured);
  const highestRoi = measured.length
    ? toGoalLine([...measured].sort((a, b) => b.roi - a.roi)[0] as GoalAttribution)
    : null;
  const lowestRoi = measured.length
    ? toGoalLine([...measured].sort((a, b) => a.roi - b.roi)[0] as GoalAttribution)
    : null;

  const { most, least } = watchdogLeaders(ls);
  const kpis = DASHBOARD_KPIS.map((k) => kpiForArea(k.label, k.area, attrs));
  const hasLiveData = kpis.some((k) => k.confidence === "high");

  return {
    generatedAt: nowDate.toISOString(),
    topGoals7d: topGoals(attrs, nowMs, 7),
    topGoals30d: topGoals(attrs, nowMs, 30),
    highestRoi,
    lowestRoi,
    mostSuccessfulWatchdog: most,
    leastSuccessfulWatchdog: least,
    kpis,
    confidence: hasLiveData ? "high" : "low",
    hasLiveData,
  };
}

const TREND_ARROW: Record<KpiLine["trend"], string> = { up: "↑", down: "↓", flat: "→" };
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** Render the dashboard as a text block for the Executive Report. */
export function renderDashboard(d: BusinessImpactDashboard): string {
  const lines: string[] = [];
  lines.push("## Business Impact Dashboard");
  lines.push(`Generated: ${d.generatedAt} · Confidence: ${cap(d.confidence)}`);
  if (!d.hasLiveData) {
    lines.push("(No live data source configured — all figures hypothesis-based. See docs/connectors-setup.md.)");
  }

  const goal = (g: GoalLine | null): string =>
    g ? `${g.title} (${g.goalId}) — Δ ${sign(g.actualImpact)}% · ROI ${g.roi} · ${g.verdict} · ${cap(g.confidence)}` : "—";
  const goalList = (gs: GoalLine[]): string => (gs.length ? gs.map((g) => `  • ${goal(g)}`).join("\n") : "  • none");

  lines.push("", "### Top Goals (7 days)", goalList(d.topGoals7d));
  lines.push("", "### Top Goals (30 days)", goalList(d.topGoals30d));
  lines.push("", `Highest ROI: ${goal(d.highestRoi)}`);
  lines.push(`Lowest ROI:  ${goal(d.lowestRoi)}`);

  const wd = (w: WatchdogLine | null): string =>
    w ? `${w.watchdog} — accuracy ${Math.round(w.accuracy * 100)}% · avg ROI ${w.avgRoi} (${w.successes}✓/${w.negatives}✗ of ${w.decided})` : "—";
  lines.push("", `Most successful watchdog:  ${wd(d.mostSuccessfulWatchdog)}`);
  lines.push(`Least successful watchdog: ${wd(d.leastSuccessfulWatchdog)}`);

  lines.push("", "### Business KPIs (Source · Stand · Confidence · Trend · Δ)");
  for (const k of d.kpis) {
    lines.push(
      `  • ${k.label} — Source: ${k.source} · Stand: ${k.timestamp} · ` +
        `Confidence: ${cap(k.confidence)} · Trend: ${TREND_ARROW[k.trend]} · Δ ${sign(k.delta)}%`,
    );
  }
  return lines.join("\n");
}
