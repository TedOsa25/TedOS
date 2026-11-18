// Approval Queue tests — non-blocking deferral of MEDIUM/HIGH goals.
// Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./storage.js";
import { ApprovalGate } from "./approval-gate.js";
import { ApprovalQueue, type ApprovalInput } from "./approval-queue.js";

const input = (over: Partial<ApprovalInput> & Pick<ApprovalInput, "goalId">): ApprovalInput => ({
  title: over.goalId,
  description: "",
  businessImpact: 5,
  revenueImpact: 5,
  customerValue: 5,
  risk: "MEDIUM",
  priorityScore: 50,
  files: [],
  estimatedEffort: "S",
  ...over,
});

// A deterministic, monotonically increasing clock.
const clockFrom = (startMs: number, stepMs = 1000) => {
  let t = startMs;
  return () => {
    const iso = new Date(t).toISOString();
    t += stepMs;
    return iso;
  };
};

describe("ApprovalQueue: deferral", () => {
  test("enqueue adds a pending entry and is idempotent by goalId", () => {
    const q = new ApprovalQueue(new InMemoryStorage());
    q.enqueue(input({ goalId: "g1" }));
    q.enqueue(input({ goalId: "g1" })); // duplicate while pending → ignored
    assert.equal(q.pending().length, 1);
    assert.equal(q.pending()[0]?.status, "pending");
  });

  test("persists through the Storage layer (survives a new instance)", () => {
    const storage = new InMemoryStorage();
    new ApprovalQueue(storage).enqueue(input({ goalId: "g1" }));
    const reloaded = new ApprovalQueue(storage);
    assert.equal(reloaded.pending().length, 1);
  });

  test("syncs the kernel ApprovalGate (reuse, not duplicate)", () => {
    const storage = new InMemoryStorage();
    const gate = new ApprovalGate(storage);
    const q = new ApprovalQueue(storage, gate);
    q.enqueue(input({ goalId: "g1" }));
    assert.ok(gate.awaiting().some((r) => r.id === "g1"), "gate is aware of the pending goal");
    q.approve("g1");
    assert.equal(gate.isApproved("g1"), true, "gate marks it approved");
  });
});

describe("ApprovalQueue: status lifecycle", () => {
  test("approve / reject / expire / implement transition correctly", () => {
    const q = new ApprovalQueue(new InMemoryStorage(), undefined, clockFrom(0));
    for (const id of ["a", "b", "c", "d"]) q.enqueue(input({ goalId: id }));
    q.approve("a");
    q.reject("b");
    q.expire("c");
    q.markImplemented("a"); // approved → implemented
    assert.equal(q.byStatus("approved").length, 0);
    assert.equal(q.byStatus("implemented")[0]?.goalId, "a");
    assert.equal(q.byStatus("rejected")[0]?.goalId, "b");
    assert.equal(q.byStatus("expired")[0]?.goalId, "c");
    assert.equal(q.pending()[0]?.goalId, "d");
  });
});

describe("ApprovalQueue: collected report", () => {
  test("summarizes all pending approvals once, ordered by priority", () => {
    const q = new ApprovalQueue(new InMemoryStorage());
    q.enqueue(input({ goalId: "pricing", title: "Pricing", priorityScore: 42, risk: "HIGH", recommendation: "reject" }));
    q.enqueue(input({ goalId: "supplier", title: "Supplier Portal", priorityScore: 94, recommendation: "approve" }));
    const report = q.report();
    assert.match(report, /2 open approval/);
    // highest ROI (supplier 94) listed before pricing (42)
    assert.ok(report.indexOf("Supplier Portal") < report.indexOf("Pricing"));
  });
});

describe("ApprovalQueue: stats for Learning", () => {
  test("reports open count, avg pending business impact, and avg decision duration", () => {
    const q = new ApprovalQueue(new InMemoryStorage(), undefined, clockFrom(0, 5000));
    q.enqueue(input({ goalId: "a", businessImpact: 8 })); // createdAt t=0
    q.enqueue(input({ goalId: "b", businessImpact: 4 })); // createdAt t=5000
    q.approve("a"); // decidedAt t=10000 → duration 10000ms
    const s = q.stats();
    assert.equal(s.openApprovals, 1); // only b still pending
    assert.equal(s.avgBusinessImpactPending, 4); // b
    assert.equal(s.totalDecided, 1);
    assert.equal(s.avgApprovalDurationMs, 10000);
  });
});
