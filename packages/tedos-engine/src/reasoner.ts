// Reasoner — decides whether a research finding is worth acting on, BEFORE it
// becomes a goal. It sits between Research and Goal generation.
//
// Despite the "AI Reasoner" roadmap name, this sprint uses deterministic rules
// only: no AI, no embeddings, no network. The interface is the seam where an
// AI implementation can drop in later without changing the ResearchEngine or
// the kernel.

import type { ResearchCandidate } from "./research/types.js";

/** Whether a finding should become a goal. */
export type ReasonerVerdict = "accept" | "reject";

/** A reasoned decision about a single research candidate. */
export interface Decision {
  verdict: ReasonerVerdict;
  /** How sure the reasoner is about this verdict, 0..1. */
  confidence: number;
  /** Human-readable justification. */
  reason: string;
}

/**
 * Reasoner turns a ResearchCandidate into an accept/reject Decision.
 *
 * This is the seam: a deterministic engine runs now; an AI reasoner can
 * implement the same interface later without touching anything downstream.
 */
export interface Reasoner {
  readonly name: string;
  decide(candidate: ResearchCandidate): Decision;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * DeterministicReasoner applies fixed rules over a candidate's metadata.
 *
 * Rules (first match wins):
 *   1. Security advisory                  -> accept (high confidence)
 *   2. Breaking dependency change         -> accept
 *   3. Minor documentation update         -> reject (low value)
 *   4. Anything else (unknown release …)  -> accept with lower confidence
 */
export class DeterministicReasoner implements Reasoner {
  readonly name = "deterministic";

  decide(candidate: ResearchCandidate): Decision {
    const { category, confidence, tags } = candidate.metadata;

    if (category === "security") {
      return {
        verdict: "accept",
        confidence: clamp01(Math.max(confidence, 0.9)),
        reason: "security advisory — patch promptly",
      };
    }

    if (category === "dependency" && tags.includes("breaking")) {
      return { verdict: "accept", confidence: 0.8, reason: "breaking dependency change" };
    }

    if (category === "documentation") {
      return {
        verdict: "reject",
        confidence: 0.3,
        reason: "minor documentation update — low priority",
      };
    }

    return {
      verdict: "accept",
      confidence: 0.5,
      reason: "no strong signal — accept with lower confidence",
    };
  }
}
