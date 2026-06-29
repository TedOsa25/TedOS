// Goal Attribution tests. Deterministic, offline — injected clock.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { GoalExecution } from "./trace.js";
import type { ScoredGoal } from "./impact.js";
import { InMemoryStorage } from "./storage.js";
import {
  inferProductAreas,
  extractCommit,
  expectedImpactOf,
  attributeExecution,
  AttributionStore,
  type GoalAttribution,
} from "./goal-attribution.js";

const clock = (): string => "2026-06-25T12:00:00.000Z";

const scored = (over: Partial<ScoredGoal["dimensions"]> = {}): ScoredGoal => ({
  candidate: { id: "g1", title: "t", kind: "feature" },
  dimensions: {
    businessImpact: 8,
    userImpact: 6,
    revenuePotential: 7,
    technicalRisk: 4,
    implementationEffort: 5,
    ...over,
  },
  overall: 12,
  reasoning: "x",
});

const exec = (over: Partial<GoalExecution> = {}): GoalExecution => ({
  id: "g1",
  title: "Improve trial→paid conversion checkout",
  priority: 7,
  status: "done",
  attempts: 1,
  tasks: [
    { title: "edit", kind: "coding", worker: "local", status: "ok", output: "", changedFiles: ["src/checkout.ts"], commands: [] },
  ],
  verification: { passed: true, skipped: false, steps: [] },
  policy: { level: "SAFE", reason: "ok" },
  review: { approved: true, reason: "done" },
  ...over,
});

describe("Goal Attribution: inference helpers", () => {
  test("inferProductAreas maps keywords to areas, in canonical order", () => {
    assert.deepEqual(inferProductAreas("Improve checkout pricing", ["src/billing.ts"]), ["revenue"]);
    assert.deepEqual(inferProductAreas("Supplier Scope 3 onboarding", []), ["product", "supplier"]);
    assert.deepEqual(inferProductAreas("totally unrelated thing", []), []);
  });

  test("extractCommit prefers a git sha, else detects a commit, else uncommitted", () => {
    assert.equal(extractCommit(["git commit -m x", "git rev-parse → a1b2c3d"]), "a1b2c3d");
    assert.equal(extractCommit(["git commit -m 'msg'"]), "committed");
    assert.equal(extractCommit(["npm test"]), "uncommitted");
    assert.equal(extractCommit([]), "uncommitted");
  });

  test("expectedImpactOf averages the three value dimensions (0–10)", () => {
    assert.equal(expectedImpactOf(scored()), 7); // (8+6+7)/3 = 7
    assert.equal(expectedImpactOf(scored({ businessImpact: 1, userImpact: 1, revenuePotential: 1 })), 1);
  });
});

describe("Goal Attribution: attributeExecution", () => {
  test("derives commit, files, areas, expected impact and timestamp", () => {
    const a = attributeExecution(exec(), scored(), clock);
    assert.equal(a.goalId, "g1");
    assert.equal(a.commit, "uncommitted");
    assert.deepEqual(a.files, ["src/checkout.ts"]);
    assert.deepEqual(a.productAreas, ["revenue", "product"]); // "conversion checkout" + "trial"
    assert.equal(a.expectedImpact, 7);
    assert.equal(a.implementedAt, "2026-06-25T12:00:00.000Z");
  });

  test("de-duplicates changed files across tasks", () => {
    const e = exec({
      tasks: [
        { title: "a", kind: "coding", worker: "local", status: "ok", output: "", changedFiles: ["x.ts", "y.ts"], commands: ["git commit -m a"] },
        { title: "b", kind: "coding", worker: "local", status: "ok", output: "", changedFiles: ["x.ts"], commands: [] },
      ],
    });
    const a = attributeExecution(e, scored(), clock);
    assert.deepEqual(a.files, ["x.ts", "y.ts"]);
    assert.equal(a.commit, "committed");
  });
});

describe("Goal Attribution: AttributionStore", () => {
  const full = (id: string): GoalAttribution => ({
    goalId: id,
    title: "t",
    commit: "uncommitted",
    implementedAt: clock(),
    files: [],
    productAreas: ["revenue"],
    expectedImpact: 7,
    actualImpact: 0,
    roi: 0,
    confidence: "low",
    verdict: "no-measurable-impact",
  });

  test("records and reads back (round-trip via Storage)", () => {
    const store = new AttributionStore(new InMemoryStorage());
    store.record(full("a"));
    store.recordMany([full("b"), full("c")]);
    assert.deepEqual(store.all().map((x) => x.goalId), ["a", "b", "c"]);
  });

  test("recordMany([]) is a no-op", () => {
    const store = new AttributionStore(new InMemoryStorage());
    store.recordMany([]);
    assert.equal(store.all().length, 0);
  });
});
