// Goal Attribution — connect an implemented goal to its commit, files, the
// product areas it touched, its EXPECTED business value, and (after the Outcome
// Engine measures it) its ACTUAL impact + ROI + verdict.
//
// The static half (commit, files, areas, expected impact) is derived purely
// from the GoalExecution the kernel's Runtime already produces (trace.ts) and
// the goal's impact score (impact.ts) — no kernel change. The dynamic half is
// filled by the Outcome Engine. Persistence reuses the same append-store
// pattern as learning.ts (OutcomeStore). Deterministic.

import type { Storage } from "./storage.js";
import type { GoalExecution } from "./trace.js";
import type { ScoredGoal } from "./impact.js";
import type { Confidence } from "./evidence.js";
import { type BusinessArea, BUSINESS_AREAS, type Verdict } from "./business-impact.js";

/** The static attribution facts, known the moment a goal is implemented. */
export interface AttributionBase {
  goalId: string;
  title: string;
  /** Git SHA if the run committed, else "uncommitted". */
  commit: string;
  /** ISO 8601 timestamp the goal was implemented. */
  implementedAt: string;
  /** Project-relative files the goal changed. */
  files: string[];
  /** Business areas the goal plausibly affects (inferred from title + files). */
  productAreas: BusinessArea[];
  /** Expected business value on a 0–10 scale (from the impact score). */
  expectedImpact: number;
}

/** A full attribution: the static facts plus the measured outcome. */
export interface GoalAttribution extends AttributionBase {
  /** Measured business movement (avg business-positive %Δ); 0 when none. */
  actualImpact: number;
  /** actualImpact ÷ expectedImpact. */
  roi: number;
  confidence: Confidence;
  verdict: Verdict;
  /**
   * Per-area business-positive %Δ from the live readings (only areas with live
   * data). Optional so historical/older records remain valid. Feeds both the
   * Business Impact Dashboard and outcome-aware prioritization.
   */
  areaImpacts?: Partial<Record<BusinessArea, number>>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Keyword → business area, scanned over the goal's title and changed files. */
const AREA_KEYWORDS: { area: BusinessArea; re: RegExp }[] = [
  { area: "revenue", re: /revenue|pricing|price|payment|billing|checkout|mrr|arr|invoice|subscription|enterprise|upsell/i },
  { area: "marketing", re: /seo|content|blog|landing|traffic|keyword|social|linkedin|instagram|newsletter|campaign|brand/i },
  { area: "sales", re: /\blead|demo|sales|crm|pipeline|deal|opportunit|outreach|prospect/i },
  { area: "product", re: /onboard|activation|trial|signup|sign-up|retention|churn|feature|dashboard|ux|usability|product/i },
  { area: "supplier", re: /supplier|scope.?3|scope 3|pcf|catena|primary.?data|emission|carbon/i },
  { area: "customerSuccess", re: /support|ticket|\bnps\b|faq|help.?center|satisfaction|customer.?success|feedback/i },
];

/** Infer which business areas a goal touches from its title + changed files. */
export function inferProductAreas(title: string, files: string[]): BusinessArea[] {
  const haystack = [title, ...files].join(" ");
  const areas = AREA_KEYWORDS.filter((k) => k.re.test(haystack)).map((k) => k.area);
  // De-duplicate while preserving the canonical area order.
  return BUSINESS_AREAS.filter((a) => areas.includes(a));
}

/** Pull a commit reference from the commands the run executed, else "uncommitted". */
export function extractCommit(commands: string[]): string {
  for (const cmd of commands) {
    const sha = cmd.match(/\b[0-9a-f]{7,40}\b/i);
    if (sha) return sha[0];
  }
  return commands.some((c) => /\bgit\s+commit\b/i.test(c)) ? "committed" : "uncommitted";
}

/** Expected business value (0–10) = average of the value dimensions of the score. */
export function expectedImpactOf(scored: ScoredGoal): number {
  const d = scored.dimensions;
  return round2((d.businessImpact + d.userImpact + d.revenuePotential) / 3);
}

/**
 * Build the static attribution for a completed GoalExecution. `files` and the
 * commit come from the recorded task traces; `expectedImpact` from the score.
 */
export function attributeExecution(
  exec: GoalExecution,
  scored: ScoredGoal,
  clock: () => string,
): AttributionBase {
  const files = [...new Set(exec.tasks.flatMap((t) => t.changedFiles))];
  const commands = exec.tasks.flatMap((t) => t.commands);
  return {
    goalId: exec.id,
    title: exec.title,
    commit: extractCommit(commands),
    implementedAt: clock(),
    files,
    productAreas: inferProductAreas(exec.title, files),
    expectedImpact: expectedImpactOf(scored),
  };
}

/** Storage key under which attributions accumulate. */
const KEY = "goal-attributions";

/**
 * AttributionStore appends GoalAttribution records to the existing Storage.
 *
 * Same thin-collector shape as OutcomeStore: append, read back. Persistence is
 * whatever createStorage() provides (in-memory by default, JSON files when
 * TEDOS_STORAGE_PATH is set).
 */
export class AttributionStore {
  constructor(private readonly storage: Storage) {}

  /** All attributions recorded so far (oldest first). */
  all(): GoalAttribution[] {
    return this.storage.load<GoalAttribution[]>(KEY) ?? [];
  }

  /** Append a single attribution. */
  record(attribution: GoalAttribution): void {
    this.storage.save(KEY, [...this.all(), attribution]);
  }

  /** Append many attributions in one write. */
  recordMany(attributions: GoalAttribution[]): void {
    if (attributions.length === 0) return;
    this.storage.save(KEY, [...this.all(), ...attributions]);
  }
}
