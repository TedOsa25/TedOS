import type { DiscoverySummary, GoalProvider } from "./types.js";
import type { GoalEngine } from "./goal-engine.js";
import type { ImpactScorer } from "./impact.js";
import type { PriorityEngine, PrioritizedGoal } from "./priority.js";
import { GoalDiscoveryEngine } from "./goal-discovery-engine.js";
import type { GoalMetadata, ResearchCandidate, ResearchProvider } from "./research/types.js";
import type { Decision, Reasoner } from "./reasoner.js";
import { DeterministicReasoner } from "./reasoner.js";

/** A scored goal paired with the metadata and reasoned decision behind it. */
export interface ResearchGoal {
  prioritized: PrioritizedGoal;
  metadata: GoalMetadata;
  decision: Decision;
}

/** A candidate together with the Reasoner's accept/reject decision. */
export interface ReasonedCandidate {
  candidate: ResearchCandidate;
  decision: Decision;
}

/** The output of one research pass: kernel counts, goals, and all decisions. */
export interface ResearchRun {
  summary: DiscoverySummary;
  goals: ResearchGoal[];
  /** Every candidate the reasoner saw, accepted or rejected. */
  decisions: ReasonedCandidate[];
}

/**
 * An optional reasoning step over a freshly enriched candidate.
 *
 * This re-weights/relabels metadata (it does not decide accept/reject — that
 * is the Reasoner's job). Identity by default, so behaviour is unchanged.
 */
export type ResearchReasoner = (
  metadata: GoalMetadata,
  candidate: { id: string; title: string },
) => GoalMetadata;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * ResearchEngine is the Intelligence Layer's coordinator.
 *
 * It collects provider results, enriches metadata, consults the Reasoner to
 * accept/reject each finding, and forwards only ACCEPTED findings into the
 * existing pipeline. It does NOT re-implement that pipeline — dedupe,
 * normalize, Impact scoring, Priority and submission to the Goal Engine all
 * run inside the kernel's GoalDiscoveryEngine, which this class drives by
 * handing it provider views filtered down to accepted candidates. Rejected
 * findings therefore never reach the Goal Engine.
 *
 * Architecture: Providers -> [enrich -> Reasoner: accept/reject] ->
 * GoalDiscoveryEngine -> Impact -> Priority -> Goal Engine -> Execution.
 */
export class ResearchEngine {
  constructor(
    private readonly providers: ResearchProvider[],
    private readonly engine: GoalEngine,
    private readonly impact: ImpactScorer,
    private readonly priority: PriorityEngine,
    /** Metadata reasoning hook; identity by default (deterministic, no AI). */
    private readonly reason: ResearchReasoner = (metadata) => metadata,
    /** Clock used to backfill a missing detectedAt. Injected for testability. */
    private readonly clock: () => string = () => new Date().toISOString(),
    /** Accept/reject reasoner; deterministic by default (no AI). */
    private readonly reasoner: Reasoner = new DeterministicReasoner(),
  ) {}

  /** Run one research pass: enrich -> reason -> drive the kernel pipeline. */
  research(): ResearchRun {
    // 1. Collect, enrich, and reason about each unique candidate. First
    //    provider to claim an id wins, matching GoalDiscoveryEngine's order.
    const metadataById = new Map<string, GoalMetadata>();
    const decisionsById = new Map<string, Decision>();
    const decisions: ReasonedCandidate[] = [];

    for (const provider of this.providers) {
      for (const candidate of provider.discover()) {
        const id = candidate.id.trim();
        if (metadataById.has(id)) continue;

        const enriched = this.reason(this.enrich(provider, candidate.metadata), {
          id,
          title: candidate.title.trim(),
        });
        metadataById.set(id, enriched);

        const reasoned: ResearchCandidate = { ...candidate, id, metadata: enriched };
        const decision = this.reasoner.decide(reasoned);
        decisionsById.set(id, decision);
        decisions.push({ candidate: reasoned, decision });
      }
    }

    const acceptedIds = new Set(
      [...decisionsById].filter(([, d]) => d.verdict === "accept").map(([id]) => id),
    );

    // 2. Forward ONLY accepted candidates into the kernel pipeline by handing
    //    GoalDiscoveryEngine filtered views of the providers. Rejected
    //    findings are never seen by it, so they never reach the Goal Engine.
    const filtered: GoalProvider[] = this.providers.map((provider) => ({
      name: provider.name,
      discover: () => provider.discover().filter((c) => acceptedIds.has(c.id.trim())),
    }));
    const run = new GoalDiscoveryEngine(filtered, this.engine, this.impact, this.priority).run();

    // 3. Join the scored backlog with its metadata and decision.
    const goals: ResearchGoal[] = run.scored.map((prioritized) => {
      const id = prioritized.scored.candidate.id;
      return {
        prioritized,
        metadata: metadataById.get(id) ?? this.fallback(),
        decision: decisionsById.get(id) ?? { verdict: "accept", confidence: 0, reason: "unknown" },
      };
    });

    return { summary: run.summary, goals, decisions };
  }

  /**
   * Normalize and complete a candidate's metadata.
   *
   * Providers already emit metadata; enrichment guarantees the full contract
   * (source, category, confidence, detectedAt, tags), backfilling anything
   * missing and folding the source + category into the tag set so downstream
   * consumers can filter on them.
   */
  private enrich(provider: ResearchProvider, metadata: GoalMetadata): GoalMetadata {
    const source = metadata.source.trim() || provider.name;
    const tags = new Set(metadata.tags.map((t) => t.trim()).filter(Boolean));
    tags.add(provider.category);
    return {
      source,
      category: metadata.category ?? provider.category,
      confidence: clamp01(metadata.confidence),
      detectedAt: metadata.detectedAt.trim() || this.clock(),
      tags: [...tags],
    };
  }

  /** Defensive default; in practice every scored id has enriched metadata. */
  private fallback(): GoalMetadata {
    return {
      source: "research",
      category: "documentation",
      confidence: 0,
      detectedAt: this.clock(),
      tags: ["research"],
    };
  }
}
