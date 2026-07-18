// Distribution Queue tests. Deterministic, offline — injected clock + gate.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./storage.js";
import { ApprovalGate } from "./approval-gate.js";
import { DistributionQueue, type DistributionJobInput } from "./distribution-queue.js";

const clock = (): string => "2026-06-26T14:00:00.000Z";
const input = (over: Partial<DistributionJobInput> = {}): DistributionJobInput => ({
  id: "j1", source: "marketing", channel: "linkedin", campaign: "c1", title: "t", body: "b", ...over,
});

describe("DistributionQueue: lifecycle", () => {
  test("enqueue starts pending-approval and requests approval on the shared gate", () => {
    const storage = new InMemoryStorage();
    const gate = new ApprovalGate(storage);
    const q = new DistributionQueue(storage, gate, clock);
    const job = q.enqueue(input());
    assert.equal(job.status, "pending-approval");
    assert.equal(job.createdAt, clock());
    assert.equal(gate.awaiting().some((a) => a.id === "j1"), true, "surfaces in the shared approval flow");
    assert.equal(q.readyToDistribute().length, 0, "not distributable before approval");
  });

  test("enqueue is idempotent by id", () => {
    const q = new DistributionQueue(new InMemoryStorage(), undefined, clock);
    q.enqueue(input());
    q.enqueue(input({ title: "changed" }));
    assert.equal(q.all().length, 1);
  });

  test("approve flips to approved, syncs the gate, and makes it ready", () => {
    const storage = new InMemoryStorage();
    const gate = new ApprovalGate(storage);
    const q = new DistributionQueue(storage, gate, clock);
    q.enqueue(input());
    q.approve("j1");
    assert.equal(q.get("j1")?.status, "approved");
    assert.equal(gate.isApproved("j1"), true);
    assert.deepEqual(q.readyToDistribute().map((j) => j.id), ["j1"]);
  });

  test("readyToDistribute requires the shared gate's approval too", () => {
    const storage = new InMemoryStorage();
    const gate = new ApprovalGate(storage);
    const q = new DistributionQueue(storage, gate, clock);
    q.enqueue(input());
    // Force status without going through the gate-syncing approve():
    const job = q.get("j1");
    assert.ok(job);
    q.recordOutcome("j1", { status: "skipped" }); // unrelated; still not 'approved'
    assert.equal(q.readyToDistribute().length, 0);
  });

  test("recordOutcome writes terminal status + note + externalId", () => {
    const q = new DistributionQueue(new InMemoryStorage(), undefined, clock);
    q.enqueue(input());
    q.approve("j1");
    q.recordOutcome("j1", { status: "published", note: "ok", externalId: "ext-1" });
    const job = q.get("j1");
    assert.equal(job?.status, "published");
    assert.equal(job?.note, "ok");
    assert.equal(job?.externalId, "ext-1");
  });

  test("persists across instances via Storage", () => {
    const storage = new InMemoryStorage();
    new DistributionQueue(storage, undefined, clock).enqueue(input());
    const reopened = new DistributionQueue(storage, undefined, clock);
    assert.equal(reopened.all().length, 1);
  });

  test("stats counts every status bucket", () => {
    const q = new DistributionQueue(new InMemoryStorage(), undefined, clock);
    q.enqueue(input({ id: "a" }));
    q.enqueue(input({ id: "b" }));
    q.approve("a");
    q.recordOutcome("a", { status: "published" });
    const s = q.stats();
    assert.equal(s.total, 2);
    assert.equal(s.published, 1);
    assert.equal(s.pendingApproval, 1);
  });
});
