// Intelligence Layer — shared contracts.
//
// These types sit ON TOP OF the execution kernel, never replacing it. A
// ResearchCandidate is just a GoalCandidate carrying research metadata, so
// every research provider still satisfies the kernel's GoalProvider
// interface and flows through the existing GoalDiscoveryEngine unchanged.

import type { GoalCandidate, GoalProvider } from "../types.js";

/** The research domain a signal belongs to. One per provider. */
export type ResearchCategory =
  | "competitor"
  | "ai-model"
  | "framework"
  | "dependency"
  | "documentation"
  | "security";

/**
 * Metadata attached to every discovered research goal.
 *
 * This is the contract the sprint requires: source, category, confidence,
 * detectedAt and tags. It is additive — the kernel's GoalCandidate is left
 * exactly as it is, and this metadata travels alongside it.
 */
export interface GoalMetadata {
  /** Where the signal came from, e.g. "GitHub Releases", "NPM Registry". */
  source: string;
  /** The research domain (mirrors the provider's category). */
  category: ResearchCategory;
  /** How sure the provider is this is worth acting on, 0..1. */
  confidence: number;
  /** ISO 8601 timestamp of when the signal was observed. */
  detectedAt: string;
  /** Free-form labels for filtering and routing. */
  tags: string[];
}

/**
 * A GoalCandidate enriched with research metadata.
 *
 * Structurally it IS a GoalCandidate (id, title, kind) plus metadata, so an
 * array of these is assignable to GoalCandidate[] — which is why research
 * providers drop straight into the existing discovery pipeline.
 */
export interface ResearchCandidate extends GoalCandidate {
  /** Human-readable summary of the work, richer than the title. */
  description: string;
  metadata: GoalMetadata;
}

/**
 * A research source.
 *
 * Extends the kernel's GoalProvider (so the GoalDiscoveryEngine accepts it)
 * and narrows discover() to emit ResearchCandidates. The `category` is fixed
 * per provider and used to stamp/verify candidate metadata.
 */
export interface ResearchProvider extends GoalProvider {
  readonly category: ResearchCategory;
  discover(): ResearchCandidate[];
}
