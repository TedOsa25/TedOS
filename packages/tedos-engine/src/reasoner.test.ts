// Sprint 5 — Reasoner tests. Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { GoalEngine } from "./goal-engine.js";
import { DeterministicImpactEngine } from "./impact.js";
import { PriorityEngine } from "./priority.js";
import { ResearchEngine } from "./research-engine.js";
import { loadResearchProviders } from "./research/providers.js";
import { DeterministicReasoner } from "./reasoner.js";
import type { ResearchCandidate, ResearchCategory } from "./research/types.js";

const reasoner = new DeterministicReasoner();

/** Build a candidate with a given category + tags for rule testing. */
const candidate = (
  category: ResearchCategory,
  tags: string[],
  confidence = 0.6,
): ResearchCandidate => ({
  id: "c1",
  title: "test candidate",
  description: "test",
  kind: "improvement",
  metadata: { source: "test", category, confidence, detectedAt: "2026-06-20T00:00:00Z", tags },
});

describe("Sprint 5: DeterministicReasoner rules", () => {
  test("critical security advisory -> accept (high confidence)", () => {
    const d = reasoner.decide(candidate("security", ["security", "critical"], 0.98));
    assert.equal(d.verdict, "accept");
    assert.ok(d.confidence >= 0.9, "security accepted with high confidence");
  });

  test("breaking dependency -> accept", () => {
    const d = reasoner.decide(candidate("dependency", ["dependency", "breaking"]));
    assert.equal(d.verdict, "accept");
  });

  test("minor documentation update -> reject", () => {
    const d = reasoner.decide(candidate("documentation", ["documentation"]));
    assert.equal(d.verdict, "reject");
  });

  test("unknown release -> accept with lower confidence", () => {
    const d = reasoner.decide(candidate("framework", ["framework"]));
    assert.equal(d.verdict, "accept");
    assert.ok(d.confidence < 0.9, "lower confidence than a security accept");
  });

  test("decisions are deterministic across runs", () => {
    const c = candidate("security", ["security", "high"], 0.9);
    assert.deepEqual(reasoner.decide(c), reasoner.decide(c));
  });
});

describe("Sprint 5: ResearchEngine consults the Reasoner before submitting", () => {
  test("rejected findings never enter the Goal Engine", async () => {
    const providers = await loadResearchProviders();
    const engine = new GoalEngine();
    const run = new ResearchEngine(
      providers,
      engine,
      new DeterministicImpactEngine(),
      new PriorityEngine(),
    ).research();

    const rejected = run.decisions.filter((d) => d.decision.verdict === "reject");
    assert.ok(rejected.length >= 1, "at least one finding (documentation) is rejected");

    const submittedIds = new Set(engine.active().map((g) => g.id));
    for (const r of rejected) {
      assert.ok(!submittedIds.has(r.candidate.id), `rejected ${r.candidate.id} not in Goal Engine`);
    }

    // The documentation finding specifically is rejected and absent.
    assert.ok(
      rejected.some((r) => r.candidate.metadata.category === "documentation"),
      "documentation finding rejected",
    );
    assert.ok(![...submittedIds].some((id) => id.startsWith("doc-")), "no doc goal submitted");

    // Accepted security finding IS submitted.
    assert.ok([...submittedIds].some((id) => id.startsWith("sec-")), "security finding accepted");

    // Every submitted goal corresponds to an accepted decision.
    assert.equal(engine.active().length, run.goals.length);
    assert.ok(run.goals.every((g) => g.decision.verdict === "accept"));
  });
});
