// Sprint 6 — Learning tests. Deterministic, offline, no AI.
//
// Force offline so the real-Runtime integration test never hits a model.
delete process.env.ANTHROPIC_API_KEY;

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { Project } from "./types.js";
import type { GoalExecution } from "./trace.js";
import { ActiveProject } from "./project.js";
import { Runtime } from "./runtime.js";
import { RuleBasedPolicyEngine } from "./policy.js";
import { ApprovalGate } from "./approval-gate.js";
import { InMemoryStorage } from "./storage.js";
import { OutcomeStore, OutcomeLearningStore, type OutcomeLearning } from "./learning.js";

const FIXED_NOW = "2026-06-24T00:00:00.000Z";
const clock = (): string => FIXED_NOW;

/** Build a minimal GoalExecution (the shape Runtime emits). */
const execution = (overrides: Partial<GoalExecution> = {}): GoalExecution => ({
  id: "g1",
  title: "Test goal",
  priority: 5,
  status: "done",
  attempts: 1,
  tasks: [],
  verification: { passed: true, skipped: false, steps: [] },
  policy: { level: "SAFE", reason: "low-risk" },
  review: { approved: true, reason: "All tasks completed and checks passed." },
  ...overrides,
});

describe("Sprint 6: OutcomeStore", () => {
  test("records and reads back an outcome (round-trip via Storage)", () => {
    const store = new OutcomeStore(new InMemoryStorage(), clock);
    store.record({
      goalId: "g1",
      status: "done",
      runtimeMs: 100,
      attempts: 1,
      verification: { passed: true, skipped: false },
      review: { approved: true, reason: "ok" },
      timestamp: FIXED_NOW,
    });
    assert.equal(store.all().length, 1);
    assert.equal(store.all()[0]?.goalId, "g1");
  });

  test("recordRun maps every required field from a GoalExecution", () => {
    const store = new OutcomeStore(new InMemoryStorage(), clock);
    const outcomes = store.recordRun([execution({ id: "carbo-1", attempts: 2 })], 4321);

    assert.equal(outcomes.length, 1);
    const o = outcomes[0];
    assert.ok(o);
    assert.equal(o.goalId, "carbo-1");
    assert.equal(o.status, "done");
    assert.equal(o.runtimeMs, 4321);
    assert.equal(o.attempts, 2);
    assert.deepEqual(o.verification, { passed: true, skipped: false });
    assert.equal(o.review.approved, true);
    assert.equal(o.timestamp, FIXED_NOW, "uses the injected clock deterministically");
  });

  test("accumulates across runs (only collects, never overwrites)", () => {
    const store = new OutcomeStore(new InMemoryStorage(), clock);
    store.recordRun([execution({ id: "a" })], 10);
    store.recordRun([execution({ id: "b" }), execution({ id: "c" })], 20);
    assert.deepEqual(
      store.all().map((o) => o.goalId),
      ["a", "b", "c"],
    );
  });

  test("integration: stores the real outcomes of a Runtime pass", async () => {
    const project: Project = {
      name: "T",
      repository: "tedos/t",
      path: process.cwd(),
      defaultWorker: "local",
      connectors: [],
      goals: [
        { id: "docs-1", title: "Document the readme", priority: 4 }, // SAFE -> done
        { id: "deploy-1", title: "Deploy to production", priority: 9 }, // FORBIDDEN -> blocked
      ],
    };
    const storage = new InMemoryStorage();
    const active = new ActiveProject(project);
    const state = await new Runtime(active, new RuleBasedPolicyEngine(), new ApprovalGate(storage)).run();

    const store = new OutcomeStore(storage, clock);
    const recorded = store.recordRun(state.executions, 0);

    // One outcome per execution, all persisted.
    assert.equal(recorded.length, state.executions.length);
    assert.equal(store.all().length, state.executions.length);

    const byId = new Map(store.all().map((o) => [o.goalId, o]));
    assert.equal(byId.get("docs-1")?.status, "done", "SAFE goal executed");
    assert.equal(byId.get("deploy-1")?.status, "failed", "FORBIDDEN goal blocked");
    assert.ok(byId.get("docs-1")?.review.approved, "executed goal review recorded");
  });
});

describe("Outcome Learning: OutcomeLearningStore", () => {
  const learning = (over: Partial<OutcomeLearning> = {}): OutcomeLearning => ({
    goalId: "g1",
    verdict: "successful",
    classification: "successful",
    roi: 1.5,
    confidence: "high",
    reason: "worked",
    source: "revenue",
    watchdogAccurate: true,
    timestamp: FIXED_NOW,
    ...over,
  });

  test("records and reads back (round-trip via Storage)", () => {
    const store = new OutcomeLearningStore(new InMemoryStorage());
    store.record(learning());
    store.recordMany([learning({ goalId: "g2" }), learning({ goalId: "g3", classification: "negative" })]);
    assert.deepEqual(store.all().map((l) => l.goalId), ["g1", "g2", "g3"]);
    assert.equal(store.all()[2]?.classification, "negative");
  });

  test("recordMany([]) is a no-op", () => {
    const store = new OutcomeLearningStore(new InMemoryStorage());
    store.recordMany([]);
    assert.equal(store.all().length, 0);
  });
});
