import type { GoalCandidate, GoalKind } from "./types.js";

/** The five dimensions every goal is scored on (each 1-10). */
export interface ImpactDimensions {
  businessImpact: number;
  userImpact: number;
  revenuePotential: number;
  technicalRisk: number;
  implementationEffort: number;
}

/** A candidate scored across the five dimensions, with a verdict. */
export interface ScoredGoal {
  candidate: GoalCandidate;
  dimensions: ImpactDimensions;
  overall: number;
  reasoning: string;
}

/**
 * ImpactScorer scores a candidate's business value.
 *
 * This is the seam the sprint cares about: a deterministic engine runs
 * now, but an AI reasoning model can implement the same interface later
 * without changing the discovery pipeline.
 */
export interface ImpactScorer {
  readonly name: string;
  score(candidate: GoalCandidate): ScoredGoal;
}

/** Base dimension profile per kind of work (1-10). */
const PROFILES: Record<GoalKind, ImpactDimensions> = {
  bug: { businessImpact: 6, userImpact: 9, revenuePotential: 3, technicalRisk: 3, implementationEffort: 3 },
  feature: { businessImpact: 8, userImpact: 7, revenuePotential: 8, technicalRisk: 6, implementationEffort: 7 },
  improvement: { businessImpact: 5, userImpact: 5, revenuePotential: 3, technicalRisk: 4, implementationEffort: 4 },
  static: { businessImpact: 2, userImpact: 2, revenuePotential: 1, technicalRisk: 2, implementationEffort: 2 },
};

const clamp = (n: number): number => Math.max(1, Math.min(10, n));

/**
 * DeterministicImpactEngine scores goals with fixed rules — no AI.
 *
 * It starts from a per-kind dimension profile and nudges dimensions based
 * on keywords in the title. The dimensions feed one impact score
 * (value minus cost) plus a readable reasoning string.
 */
export class DeterministicImpactEngine implements ImpactScorer {
  readonly name = "deterministic";

  score(candidate: GoalCandidate): ScoredGoal {
    const dimensions = this.adjust(PROFILES[candidate.kind], candidate.title.toLowerCase());
    const value =
      dimensions.businessImpact + dimensions.userImpact + dimensions.revenuePotential;
    const cost = dimensions.technicalRisk + dimensions.implementationEffort;
    const overall = value - cost;
    return { candidate, dimensions, overall, reasoning: this.explain(candidate, dimensions, overall) };
  }

  /** Apply deterministic keyword adjustments on top of the base profile. */
  private adjust(base: ImpactDimensions, title: string): ImpactDimensions {
    const d = { ...base };
    if (/revenue|payment|pricing|checkout|billing/.test(title)) {
      d.revenuePotential = clamp(d.revenuePotential + 2);
    }
    if (/security|auth|login|compliance/.test(title)) {
      d.businessImpact = clamp(d.businessImpact + 1);
      d.technicalRisk = clamp(d.technicalRisk + 1);
    }
    if (/performance|optimi|speed|latency/.test(title)) {
      d.userImpact = clamp(d.userImpact + 1);
    }
    if (/onboarding|signup|activation/.test(title)) {
      d.userImpact = clamp(d.userImpact + 1);
    }
    return d;
  }

  private explain(candidate: GoalCandidate, d: ImpactDimensions, overall: number): string {
    return (
      `${candidate.kind}: business ${d.businessImpact}, user ${d.userImpact}, ` +
      `revenue ${d.revenuePotential}, risk ${d.technicalRisk}, effort ${d.implementationEffort} ` +
      `-> impact ${overall}.`
    );
  }
}
