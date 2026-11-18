// Outcome-aware prioritization — Phase 6 (Business Outcome Learning → Revenue
// Prioritization). This is what turns TedOS from a rule-based prioritizer into a
// continuously self-learning one.
//
// It is a SECOND ImpactScorer decorator, plugged into the same seam the
// FeedbackEngine already uses (impact.ts `ImpactScorer`). FeedbackEngine adjusts
// a goal by its own EXECUTION history (done/failed/rejected); this engine
// adjusts a candidate by the BUSINESS OUTCOMES that real, measured goals in the
// SAME business areas produced — realized per-area movement, ROI, and (when the
// proposing watchdog is known) that watchdog's historical accuracy.
//
// It reuses the existing outcome stores (via the read-only AttributionHistory /
// LearningHistory views already defined for the Dashboard) and the existing
// area inference (goal-attribution.ts). It adds no store and no kernel seam.
// Deterministic; bounded; a pass-through when no live-measured evidence exists,
// so prioritization never degrades on assumptions.

import type { GoalCandidate } from "./types.js";
import type { ImpactScorer, ScoredGoal } from "./impact.js";
import type { BusinessArea } from "./business-impact.js";
import { inferProductAreas } from "./goal-attribution.js";
import type { AttributionHistory, LearningHistory } from "./business-dashboard.js";

/** Weights (deterministic). Tuned so evidence nudges, never dominates, the base score. */
export const AREA_IMPACT_WEIGHT = 0.2; // impact points per 1% realized business movement
export const ROI_WEIGHT = 1.0; // impact points per 1.0 of ROI above/below expectation
export const WATCHDOG_WEIGHT = 2.0; // impact points scaling a known watchdog's accuracy (centered at 0.5)
/** Cap so a long history nudges, never dominates, the underlying impact score. */
export const MAX_OUTCOME_ADJUSTMENT = 4;

const clamp = (n: number): number =>
  Math.max(-MAX_OUTCOME_ADJUSTMENT, Math.min(MAX_OUTCOME_ADJUSTMENT, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** What the measured outcome history says about a candidate, and the delta. */
export interface OutcomeSignal {
  /** Business areas inferred from the candidate's title. */
  areas: BusinessArea[];
  /** Measured (live-data) goals that touched any of those areas. */
  measuredGoals: number;
  /** Mean realized business-positive %Δ across the candidate's areas (0 if none). */
  avgAreaImpact: number;
  /** Mean realized ROI across measured goals in those areas (0 if none). */
  avgRoi: number;
  /** The proposing watchdog's historical accuracy (0..1), or null when unknown. */
  watchdogAccuracy: number | null;
  /** Bounded change applied to the candidate's impact score. */
  adjustment: number;
}

/** Optional inputs: how to find the watchdog that proposed a candidate. */
export interface OutcomePrioritizationOptions {
  /** Maps a candidate to the watchdog/source that proposed it, if known. */
  sourceOf?: (candidate: GoalCandidate) => string | undefined;
}

/**
 * OutcomeFeedbackEngine adjusts Impact using realized BUSINESS outcomes.
 *
 * Wrap it around the existing scorer (typically the FeedbackEngine):
 *   new OutcomeFeedbackEngine(new FeedbackEngine(base, outcomes), { attributions, learnings })
 * Candidates whose areas have no measured history pass through unchanged.
 */
export class OutcomeFeedbackEngine implements ImpactScorer {
  readonly name: string;
  private readonly sourceOf: ((candidate: GoalCandidate) => string | undefined) | undefined;

  constructor(
    private readonly inner: ImpactScorer,
    private readonly stores: { attributions: AttributionHistory; learnings: LearningHistory },
    options: OutcomePrioritizationOptions = {},
  ) {
    this.name = `outcome(${inner.name})`;
    this.sourceOf = options.sourceOf;
  }

  score(candidate: GoalCandidate): ScoredGoal {
    const base = this.inner.score(candidate);
    const signal = this.signal(candidate);
    if (signal.adjustment === 0) return base;
    return {
      ...base,
      overall: base.overall + signal.adjustment,
      reasoning: `${base.reasoning} ${this.explain(signal)}`,
    };
  }

  /**
   * Summarise realized outcomes for a candidate into a bounded impact delta.
   * Exposed so callers and tests can inspect the reasoning behind an adjustment.
   */
  signal(candidate: GoalCandidate): OutcomeSignal {
    const areas = inferProductAreas(candidate.title, []);
    const measured = this.stores.attributions.all().filter((a) => a.confidence === "high");

    // Per-area realized movement, across measured goals that touched the area.
    const areaImpacts: number[] = [];
    const inAreas = measured.filter((a) => a.productAreas.some((p) => areas.includes(p)));
    for (const area of areas) {
      const vals = measured.map((a) => a.areaImpacts?.[area]).filter((v): v is number => v !== undefined);
      if (vals.length) areaImpacts.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    const avgAreaImpact = areaImpacts.length ? round2(areaImpacts.reduce((s, v) => s + v, 0) / areaImpacts.length) : 0;
    const avgRoi = inAreas.length ? round2(inAreas.reduce((s, a) => s + a.roi, 0) / inAreas.length) : 0;

    // Optional: the proposing watchdog's historical accuracy (decided learnings only).
    const watchdogAccuracy = this.accuracyFor(candidate);

    let adjustment = avgAreaImpact * AREA_IMPACT_WEIGHT;
    if (inAreas.length) adjustment += (avgRoi - 1) * ROI_WEIGHT;
    if (watchdogAccuracy !== null) adjustment += (watchdogAccuracy - 0.5) * WATCHDOG_WEIGHT;

    return {
      areas,
      measuredGoals: inAreas.length,
      avgAreaImpact,
      avgRoi,
      watchdogAccuracy,
      adjustment: round2(clamp(adjustment)),
    };
  }

  /** The proposing watchdog's accuracy (successes ÷ decided), or null when unknown. */
  private accuracyFor(candidate: GoalCandidate): number | null {
    const source = this.sourceOf?.(candidate);
    if (!source) return null;
    const decided = this.stores.learnings
      .all()
      .filter((l) => l.source === source && l.watchdogAccurate !== null);
    if (decided.length === 0) return null;
    const successes = decided.filter((l) => l.watchdogAccurate === true).length;
    return round2(successes / decided.length);
  }

  private explain(s: OutcomeSignal): string {
    const wd = s.watchdogAccuracy !== null ? `, watchdog acc ${Math.round(s.watchdogAccuracy * 100)}%` : "";
    const sign = s.adjustment > 0 ? "+" : "";
    return (
      `outcome: ${s.measuredGoals} measured goal(s) in ${s.areas.join("/") || "no area"} ` +
      `(avg Δ ${s.avgAreaImpact}%, ROI ${s.avgRoi}${wd}) -> impact ${sign}${s.adjustment}.`
    );
  }
}
