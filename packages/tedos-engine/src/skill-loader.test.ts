// Phase 3 — Skill Loader tests. Deterministic, offline, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ExecutionResult, Plan, ProjectContext, Worker } from "./types.js";
import { LocalWorker } from "./workers.js";
import { SkillAwareWorker, SkillLoader } from "./skill-loader.js";

const noopLog = (): void => {};

const CONTEXT: ProjectContext = {
  name: "Test",
  repository: "tedos/test",
  path: process.cwd(),
  connectors: [],
  defaultWorker: "local",
};

const planFor = (description: string): Plan => ({
  goalId: "g1",
  tasks: [{ id: "g1-t1", description, kind: "coding" }],
});

/** A stub worker that records the plan it received and returns a sentinel. */
class RecordingWorker implements Worker {
  readonly name = "recording";
  lastPlan: Plan | null = null;
  calls = 0;

  async execute(plan: Plan): Promise<ExecutionResult> {
    this.lastPlan = plan;
    this.calls += 1;
    return {
      goalId: plan.goalId,
      results: plan.tasks.map((t) => ({
        taskId: t.id,
        success: true,
        output: "sentinel",
        changedFiles: [],
        commands: [],
      })),
    };
  }
}

describe("Phase 3: Skill Loader", () => {
  const loader = new SkillLoader();

  test("selects the correct skill file by deterministic rules", () => {
    assert.equal(loader.select("Build a React component"), "react.md");
    assert.equal(loader.select("Improve carbon emission accuracy"), "carbon.md");
    assert.equal(loader.select("Tidy up the sales pipeline"), "sales.md");
    assert.equal(loader.select("Plan a marketing launch"), "marketing.md");
    assert.equal(loader.select("Migrate the supabase database"), "supabase.md");
  });

  test("loads real skill content for a matching task", () => {
    const skill = loader.forText("Refactor a React hook");
    assert.ok(skill, "a skill was loaded");
    assert.equal(skill.name, "react.md");
    assert.match(skill.content, /REACT SKILL/, "real file content is returned");
  });

  test("unknown task loads no skill; a missing skill file yields null too", () => {
    // No rule matches at all.
    assert.equal(loader.select("Rename an internal variable"), null);
    assert.equal(loader.forText("Rename an internal variable"), null);

    // A rule matches, but security.md does not exist -> graceful null.
    assert.equal(loader.select("Fix a security vulnerability"), "security.md");
    assert.equal(loader.forText("Fix a security vulnerability"), null, "missing file -> no skill");
  });

  test("multiple runs stay deterministic", () => {
    const a = loader.forText("Build a React dashboard");
    const b = loader.forText("Build a React dashboard");
    assert.deepEqual(a, b);
    assert.equal(loader.select("carbon emission report"), loader.select("carbon emission report"));
  });

  test("Worker still executes unchanged — transparent result, skill injected on match", async () => {
    const inner = new RecordingWorker();
    const worker = new SkillAwareWorker(inner, loader, noopLog);
    const plan = planFor("Build a React table");

    const result = await worker.execute(plan, CONTEXT);

    // Result flows straight through from the inner worker.
    assert.equal(inner.calls, 1);
    assert.equal(result.results[0]?.output, "sentinel");
    assert.equal(result.results.length, 1, "task count unchanged");

    // The inner worker received the skill content injected into the task.
    const received = inner.lastPlan?.tasks[0]?.description ?? "";
    assert.match(received, /REACT SKILL/, "skill content passed into the worker");
    assert.match(received, /Build a React table/, "original task text preserved");
  });

  test("Worker still executes unchanged — no match passes the original plan through", async () => {
    const inner = new RecordingWorker();
    const worker = new SkillAwareWorker(inner, loader, noopLog);
    const plan = planFor("Rename an internal variable");

    const result = await worker.execute(plan, CONTEXT);

    assert.equal(inner.calls, 1);
    assert.equal(inner.lastPlan, plan, "the exact original plan is forwarded unchanged");
    assert.equal(result.results[0]?.output, "sentinel");
  });

  test("wraps the real LocalWorker without changing its behaviour", async () => {
    const worker = new SkillAwareWorker(new LocalWorker(), loader, noopLog);

    const matched = await worker.execute(planFor("Build a React widget"), CONTEXT);
    assert.equal(matched.results[0]?.success, true);

    const unmatched = await worker.execute(planFor("Rename a variable"), CONTEXT);
    assert.equal(unmatched.results[0]?.success, true);
    assert.match(unmatched.results[0]?.output ?? "", /local/, "LocalWorker output unchanged");
  });
});
