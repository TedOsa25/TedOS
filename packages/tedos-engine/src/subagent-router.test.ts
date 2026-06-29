// Sprint 8 — Sub-Agent Routing tests. Deterministic, offline, no AI.
//
// Force offline so the developer role's ClaudeWorker uses its simulated path.
delete process.env.ANTHROPIC_API_KEY;

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { Plan, ProjectContext, Task } from "./types.js";
import {
  ROLES,
  RoleWorker,
  SubAgentRouter,
  defaultRoleWorkers,
  routeRole,
  type Role,
} from "./subagent-router.js";

const task = (description: string, kind: Task["kind"] = "general", id = "t1"): Task => ({
  id,
  description,
  kind,
});

const CONTEXT: ProjectContext = {
  name: "T",
  repository: "tedos/t",
  path: process.cwd(),
  connectors: [],
  defaultWorker: "local",
};

describe("Sprint 8: routeRole (deterministic rules)", () => {
  const cases: Array<[string, Task, Role]> = [
    ["research keyword", task("Investigate the flaky deploy"), "research"],
    ["developer keyword", task("Implement the login form"), "developer"],
    ["qa keyword", task("Verify the checkout flow"), "qa"],
    ["reviewer keyword", task("Review the pull request"), "reviewer"],
    ["coding kind -> developer", task("Touch the module", "coding"), "developer"],
    ["qa wins over developer for 'write tests'", task("Write tests for auth"), "qa"],
    ["reviewer wins over qa for 'review test results'", task("Review the test results"), "reviewer"],
    ["fallback -> developer", task("Do the thing"), "developer"],
  ];

  for (const [name, t, expected] of cases) {
    test(name, () => {
      assert.equal(routeRole(t).role, expected);
    });
  }

  test("only the four roles are ever returned", () => {
    const seen = new Set(cases.map(([, t]) => routeRole(t).role));
    for (const role of seen) assert.ok(ROLES.includes(role));
  });

  test("routing is deterministic across repeated calls", () => {
    const t = task("Investigate and analyse the data");
    assert.equal(routeRole(t).role, routeRole(t).role);
    assert.equal(routeRole(t).role, "research");
  });
});

describe("Sprint 8: SubAgentRouter", () => {
  test("exposes exactly the four role workers, reusing the Worker interface", () => {
    const workers = defaultRoleWorkers();
    assert.deepEqual(Object.keys(workers).sort(), [...ROLES].sort());
    for (const role of ROLES) {
      const w = workers[role];
      assert.ok(w instanceof RoleWorker);
      assert.equal(w.name, role);
      assert.equal(typeof w.execute, "function", "satisfies Worker");
    }
  });

  test("route returns the role's worker", () => {
    const router = new SubAgentRouter();
    const routed = router.route(task("Review the diff"));
    assert.equal(routed.role, "reviewer");
    assert.equal(routed.worker, router.workerFor("reviewer"));
    assert.ok(routed.reason.length > 0);
  });

  test("routePlan keeps task order and routes each task", () => {
    const plan: Plan = {
      goalId: "g1",
      tasks: [
        task("Research the API", "general", "a"),
        task("Implement the client", "coding", "b"),
        task("Test the client", "general", "c"),
        task("Review the change", "general", "d"),
      ],
    };
    const routed = new SubAgentRouter().routePlan(plan);
    assert.deepEqual(
      routed.map((r) => [r.task.id, r.role]),
      [["a", "research"], ["b", "developer"], ["c", "qa"], ["d", "reviewer"]],
    );
  });

  test("a RoleWorker delegates execution to its backing worker", async () => {
    const router = new SubAgentRouter();
    const dev = router.workerFor("developer");
    const plan: Plan = { goalId: "g1", tasks: [task("Implement it", "coding", "x")] };
    const result = await dev.execute(plan, CONTEXT);
    assert.equal(result.goalId, "g1");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.success, true);
  });
});
