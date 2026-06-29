// Feedback — use Learning data to improve future prioritisation.
//
// The FeedbackEngine reads the execution outcomes collected by the Learning
// sprint (learning.ts) and adjusts a goal's Impact score, before goals are
// submitted, based on how the same goal fared in the past:
//
//   repeated successes  -> increase confidence (raise impact)
//   repeated failures   -> reduce confidence   (lower impact)
//   rejected goals      -> lower priority       (lower impact)
//
// It is deterministic — fixed rules, no AI, no learning model. It plugs into
// the EXISTING seam: GoalDiscoveryEngine already takes an injected ImpactScorer
// (impact.ts), so FeedbackEngine is just a decorator around that scorer. No
// kernel component, and no discovery/impact code, is modified.

import type { GoalCandidate } from "./types.js";
import type { ImpactScorer, ScoredGoal } from "./impact.js";
import type { ExecutionOutcome } from "./learning.js";

/** The minimal read view of Learning data the engine needs. OutcomeStore fits. */
export interface OutcomeHistory {
  all(): readonly ExecutionOutcome[];
}

/** What past outcomes say about one goal, and the resulting impact delta. */
export interface FeedbackSignal {
  /** Past runs that completed (status "done"). */
  successes: number;
  /** Past runs that failed (status "failed"). */
  failures: number;
  /** Past runs the Reviewer rejected without completing (e.g. blocked). */
  rejections: number;
  /** Net change applied to the goal's impact score (bounded). */
  adjustment: number;
}

/** Fixed weights — failures and rejections weigh more than a single success. */
const SUCCESS_BONUS = 1;
const FAILURE_PENALTY = 2;
const REJECTION_PENALTY = 3;
/** Cap so a long history nudges, never dominates, the underlying impact score. */
const MAX_ADJUSTMENT = 6;

const clamp = (n: number): number => Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, n));

/**
 * FeedbackEngine adjusts Impact using past execution outcomes.
 *
 * It wraps an inner ImpactScorer (the deterministic engine today, an AI one
 * later) and shifts the resulting impact score by a bounded amount derived
 * from the goal's own history. Goals with no history pass through unchanged.
 */
export class FeedbackEngine implements ImpactScorer {
  readonly name: string;

  constructor(
    private readonly inner: ImpactScorer,
    private readonly history: OutcomeHistory,
  ) {
    this.name = `feedback(${inner.name})`;
  }

  score(candidate: GoalCandidate): ScoredGoal {
    const base = this.inner.score(candidate);
    const signal = this.signal(candidate.id);
    if (signal.adjustment === 0) return base;
    return {
      ...base,
      overall: base.overall + signal.adjustment,
      reasoning: `${base.reasoning} ${this.explain(signal)}`,
    };
  }

  /**
   * Summarise the goal's past outcomes into a bounded impact delta.
   *
   * Each outcome falls in exactly one bucket: completed ("done"), failed, or
   * rejected (Reviewer said no without completing). Exposed so callers and
   * tests can inspect the reasoning behind an adjustment.
   */
  signal(goalId: string): FeedbackSignal {
    let successes = 0;
    let failures = 0;
    let rejections = 0;
    for (const o of this.history.all()) {
      if (o.goalId !== goalId) continue;
      if (o.status === "done") successes++;
      else if (o.status === "failed") failures++;
      else if (!o.review.approved) rejections++;
    }
    const adjustment = clamp(
      successes * SUCCESS_BONUS - failures * FAILURE_PENALTY - rejections * REJECTION_PENALTY,
    );
    return { successes, failures, rejections, adjustment };
  }

  private explain(s: FeedbackSignal): string {
    const sign = s.adjustment > 0 ? "+" : "";
    return (
      `feedback: ${s.successes} done, ${s.failures} failed, ${s.rejections} rejected ` +
      `-> impact ${sign}${s.adjustment}.`
    );
  }
}
