import type {
  DiscoverySummary,
  GoalCandidate,
  GoalInput,
  GoalProvider,
} from "./types.js";
import type { GoalEngine } from "./goal-engine.js";
import type { ImpactScorer } from "./impact.js";
import type { PriorityEngine, PrioritizedGoal } from "./priority.js";

/** The output of one discovery pass: counts plus the scored backlog. */
export interface DiscoveryRun {
  summary: DiscoverySummary;
  scored: PrioritizedGoal[];
}

/**
 * GoalDiscoveryEngine lets TedOS find new work on its own.
 *
 * It pulls candidates from any number of providers, normalizes them and
 * removes duplicates, then runs the pipeline:
 *   Providers -> Discovery -> Impact Engine -> Priority Engine -> Goal Engine.
 * The Impact and Priority engines are injected, so the discovery flow is
 * unchanged whether scoring is deterministic or AI-driven.
 */
export class GoalDiscoveryEngine {
  constructor(
    private readonly providers: GoalProvider[],
    private readonly engine: GoalEngine,
    private readonly impact: ImpactScorer,
    private readonly priority: PriorityEngine,
  ) {}

  /** Run one discovery pass, score it, and submit it to the Goal Engine. */
  run(): DiscoveryRun {
    const collected = this.collect();
    const unique = this.dedupe(collected.map((candidate) => this.normalize(candidate)));

    const scored = unique
      .map((candidate) => this.impact.score(candidate))
      .map((scoredGoal) => this.priority.prioritize(scoredGoal));

    let submitted = 0;
    let rejected = 0;
    for (const prioritized of scored) {
      const goal: GoalInput = {
        id: prioritized.scored.candidate.id,
        title: prioritized.scored.candidate.title,
        priority: prioritized.priority,
      };
      if (this.engine.submit(goal).accepted) submitted++;
      else rejected++;
    }

    return {
      summary: {
        collected: collected.length,
        unique: unique.length,
        submitted,
        rejected,
      },
      scored,
    };
  }

  /** Collect raw candidates from every provider. */
  private collect(): GoalCandidate[] {
    return this.providers.flatMap((provider) => provider.discover());
  }

  /** Trim text fields into a clean, canonical candidate. */
  private normalize(candidate: GoalCandidate): GoalCandidate {
    return {
      id: candidate.id.trim(),
      title: candidate.title.trim(),
      kind: candidate.kind,
    };
  }

  /**
   * Drop candidates whose id or normalized title was already seen.
   * Providers are consulted in order, so the first (higher-signal)
   * occurrence of a duplicate wins.
   */
  private dedupe(candidates: GoalCandidate[]): GoalCandidate[] {
    const seen = new Set<string>();
    const unique: GoalCandidate[] = [];
    for (const candidate of candidates) {
      const idKey = `id:${candidate.id}`;
      const titleKey = `title:${candidate.title.toLowerCase()}`;
      if (seen.has(idKey) || seen.has(titleKey)) continue;
      seen.add(idKey);
      seen.add(titleKey);
      unique.push(candidate);
    }
    return unique;
  }
}
