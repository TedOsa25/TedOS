// Sprint 7 — Feedback Engine tests. Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { GoalCandidate, GoalProvider } from "./types.js";
import type { ExecutionOutcome } from "./learning.js";
import { DeterministicImpactEngine } from "./impact.js";
import { PriorityEngine } from "./priority.js";
import { GoalEngine } from "./goal-engine.js";
import { GoalDiscoveryEngine } from "./goal-discovery-engine.js";
import { FeedbackEngine, type OutcomeHistory } from "./feedback.js";

/** Build an ExecutionOutcome (the shape the Learning sprint stores). */
const outcome = (overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome => ({
  goalId: "g1",
  status: "done",
  runtimeMs: 0,
  attempts: 1,
  verification: { passed: true, skipped: false },
  review: { approved: true, reason: "ok" },
  timestamp: "2026-06-24T00:00:00.000Z",
  ...overrides,
});

/** A fixed-list history stub (OutcomeStore satisfies the same interface). */
const history = (outcomes: ExecutionOutcome[]): OutcomeHistory => ({
  all: () => outcomes,
});

const candidate: GoalCandidate = { id: "g1", title: "Improve onboarding flow", kind: "improvement" };

describe("Sprint 7: FeedbackEngine", () => {
  const inner = new DeterministicImpactEngine();
  const baseline = inner.score(candidate).overall;

  test("no history -> impact passes through unchanged", () => {
    const fb = new FeedbackEngine(inner, history([]));
    const scored = fb.score(candidate);
    assert.equal(scored.overall, baseline);
    assert.equal(scored.reasoning, inner.score(candidate).reasoning, "reasoning untouched");
  });

  test("repeated successes -> increased confidence (higher impact)", () => {
    const fb = new FeedbackEngine(inner, history([outcome(), outcome(), outcome()]));
    const signal = fb.signal("g1");
    assert.deepEqual(
      { successes: signal.successes, failures: signal.failures, rejections: signal.rejections },
      { successes: 3, failures: 0, rejections: 0 },
    );
    assert.equal(signal.adjustment, 3);
    assert.equal(fb.score(candidate).overall, baseline + 3);
  });

  test("repeated failures -> reduced confidence (lower impact)", () => {
    const fb = new FeedbackEngine(inner, history([
      outcome({ status: "failed", review: { approved: false, reason: "checks failed" } }),
      outcome({ status: "failed", review: { approved: false, reason: "checks failed" } }),
    ]));
    const signal = fb.signal("g1");
    assert.equal(signal.failures, 2);
    assert.equal(signal.adjustment, -4); // 2 * FAILURE_PENALTY(2)
    assert.equal(fb.score(candidate).overall, baseline - 4);
  });

  test("rejected goals -> lowered priority (lower impact)", () => {
    const fb = new FeedbackEngine(inner, history([
      outcome({ status: "awaiting_approval", review: { approved: false, reason: "needs approval" } }),
    ]));
    const signal = fb.signal("g1");
    assert.equal(signal.rejections, 1);
    assert.equal(signal.adjustment, -3); // 1 * REJECTION_PENALTY(3)
    assert.ok(fb.score(candidate).overall < baseline);
  });

  test("adjustment is bounded so history nudges, never dominates", () => {
    const many = Array.from({ length: 50 }, () => outcome());
    const fb = new FeedbackEngine(inner, history(many));
    assert.equal(fb.signal("g1").adjustment, 6, "capped at MAX_ADJUSTMENT");
  });

  test("only the matching goal's history counts", () => {
    const fb = new FeedbackEngine(inner, history([
      outcome({ goalId: "other", status: "failed", review: { approved: false, reason: "x" } }),
      outcome({ goalId: "g1" }),
    ]));
    assert.equal(fb.signal("g1").adjustment, 1);
    assert.equal(fb.signal("other").adjustment, -2);
  });

  test("integration: feedback adjusts Impact inside the discovery pipeline", () => {
    const provider: GoalProvider = {
      name: "stub",
      discover: () => [candidate],
    };

    // Two failures in the goal's history should lower the priority that the
    // discovery pipeline submits, versus the unadjusted baseline.
    const failingHistory = history([
      outcome({ status: "failed", review: { approved: false, reason: "checks failed" } }),
      outcome({ status: "failed", review: { approved: false, reason: "checks failed" } }),
    ]);

    const engine = new GoalEngine();
    new GoalDiscoveryEngine(
      [provider],
      engine,
      new FeedbackEngine(inner, failingHistory),
      new PriorityEngine(),
    ).run();

    const submitted = engine.next();
    assert.ok(submitted, "a goal was submitted");
    assert.equal(submitted.id, "g1");
    assert.equal(submitted.priority, baseline - 4, "submitted priority reflects feedback penalty");
  });
});
