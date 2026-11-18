import type { ScoredGoal } from "./impact.js";

/** Priority level a goal lands in, P1 (highest) to P4 (lowest). */
export type PriorityLevel = "P1" | "P2" | "P3" | "P4";

/** A scored goal with its queue priority and level. */
export interface PrioritizedGoal {
  scored: ScoredGoal;
  priority: number;
  level: PriorityLevel;
}

/**
 * PriorityEngine turns an impact score into a queue priority and a level.
 *
 * Deterministic bands: higher impact -> higher priority and a stronger
 * level. The numeric priority is the impact score itself, so the Goal
 * Engine orders the backlog by business value.
 */
export class PriorityEngine {
  prioritize(scored: ScoredGoal): PrioritizedGoal {
    return { scored, priority: scored.overall, level: this.level(scored.overall) };
  }

  private level(overall: number): PriorityLevel {
    if (overall >= 18) return "P1";
    if (overall >= 12) return "P2";
    if (overall >= 6) return "P3";
    return "P4";
  }
}
