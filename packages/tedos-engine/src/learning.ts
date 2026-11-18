// Learning — collect execution outcomes.
//
// This sprint ONLY collects data: it records what happened after each goal
// runs, so later sprints (Feedback Loop) can use it. No AI, no scoring, no
// analytics. It reuses the existing Storage layer (storage.ts) and reads the
// GoalExecution records the kernel's Runtime already produces — it never
// modifies the kernel.

import type { Storage } from "./storage.js";
import type { ExecutionStatus, GoalExecution } from "./trace.js";

/** Verification result, flattened for storage. */
export interface VerificationOutcome {
  passed: boolean;
  skipped: boolean;
}

/** Review result, flattened for storage. */
export interface ReviewOutcome {
  approved: boolean;
  reason: string;
}

/** One stored execution outcome. */
export interface ExecutionOutcome {
  goalId: string;
  status: ExecutionStatus;
  /** How long the run took, in milliseconds. */
  runtimeMs: number;
  attempts: number;
  verification: VerificationOutcome;
  review: ReviewOutcome;
  /** ISO 8601 timestamp of when the outcome was recorded. */
  timestamp: string;
}

/** Storage key under which outcomes accumulate. */
const KEY = "outcomes";

/**
 * OutcomeStore appends execution outcomes to the existing Storage.
 *
 * It is a thin collector: record what happened, read it back. Persistence is
 * whatever createStorage() provides (in-memory by default, JSON files when
 * TEDOS_STORAGE_PATH is set) — the same layer the ApprovalGate already uses.
 */
export class OutcomeStore {
  constructor(
    private readonly storage: Storage,
    /** Clock for the recorded timestamp; injected for deterministic tests. */
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /** All outcomes recorded so far (oldest first). */
  all(): ExecutionOutcome[] {
    return this.storage.load<ExecutionOutcome[]>(KEY) ?? [];
  }

  /** Append a single outcome. */
  record(outcome: ExecutionOutcome): void {
    this.storage.save(KEY, [...this.all(), outcome]);
  }

  /**
   * Record every goal execution from a Runtime pass.
   *
   * `runtimeMs` is the measured duration of the run; it is attached to each
   * outcome from that pass. Returns the outcomes it stored.
   */
  recordRun(executions: readonly GoalExecution[], runtimeMs: number): ExecutionOutcome[] {
    const timestamp = this.clock();
    const outcomes: ExecutionOutcome[] = executions.map((e) => ({
      goalId: e.id,
      status: e.status,
      runtimeMs,
      attempts: e.attempts,
      verification: { passed: e.verification.passed, skipped: e.verification.skipped },
      review: { approved: e.review.approved, reason: e.review.reason },
      timestamp,
    }));
    this.storage.save(KEY, [...this.all(), ...outcomes]);
    return outcomes;
  }
}

// ─── Outcome Learning ────────────────────────────────────────────────────────
// The Outcome Engine measures the BUSINESS impact of each implemented goal; the
// learning of that measurement is stored here, alongside the execution outcomes,
// so the Learning Engine stays the single home for "what we learned" (no
// parallel architecture). Later sprints feed this into prioritisation.

/** How an implemented goal's measured business impact is classified. */
export type OutcomeClassification = "successful" | "neutral" | "negative";

/** One learning derived from measuring a goal's business outcome. */
export interface OutcomeLearning {
  goalId: string;
  /** The full measurement verdict (incl. "no-measurable-impact"). */
  verdict: string;
  /** Collapsed bucket used for aggregation. */
  classification: OutcomeClassification;
  /** Realised ROI (actualImpact ÷ expectedImpact). */
  roi: number;
  /** Confidence of the measurement (high only with live data). */
  confidence: "high" | "low";
  /** Why it worked / was ineffective / which hypothesis was wrong. */
  reason: string;
  /** The watchdog/source that proposed the goal, or "unknown". */
  source: string;
  /** Was that source's recommendation borne out? null when unknown. */
  watchdogAccurate: boolean | null;
  /** ISO 8601 timestamp of when the learning was recorded. */
  timestamp: string;
}

/** Storage key under which outcome learnings accumulate. */
const LEARNINGS_KEY = "outcome-learnings";

/**
 * OutcomeLearningStore appends OutcomeLearning records to the existing Storage.
 *
 * The same thin-collector shape as OutcomeStore — append, read back. Records
 * carry their own timestamp (set by the Outcome Engine's clock).
 */
export class OutcomeLearningStore {
  constructor(private readonly storage: Storage) {}

  /** All learnings recorded so far (oldest first). */
  all(): OutcomeLearning[] {
    return this.storage.load<OutcomeLearning[]>(LEARNINGS_KEY) ?? [];
  }

  /** Append a single learning. */
  record(learning: OutcomeLearning): void {
    this.storage.save(LEARNINGS_KEY, [...this.all(), learning]);
  }

  /** Append many learnings in one write. */
  recordMany(learnings: OutcomeLearning[]): void {
    if (learnings.length === 0) return;
    this.storage.save(LEARNINGS_KEY, [...this.all(), ...learnings]);
  }
}
