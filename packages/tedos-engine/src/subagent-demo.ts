// Sub-agent routing demo.
//
// Takes one goal's plan, routes each task to a specialised role worker
// (Research / Developer / QA / Reviewer) with deterministic rules, then runs
// each task on its routed worker — sequentially, no parallelism. Offline by
// default. Reuses the existing Worker interface and WorkerFactory; no kernel
// code is modified.

import type { Plan, ProjectContext, Task } from "./types.js";
import { SubAgentRouter } from "./subagent-router.js";

const CONTEXT: ProjectContext = {
  name: "TedOS",
  repository: "tedos/tedos",
  path: process.cwd(),
  connectors: ["github"],
  defaultWorker: "local",
};

const PLAN: Plan = {
  goalId: "ship-search",
  tasks: [
    { id: "t1", description: "Research search libraries and compare options", kind: "general" },
    { id: "t2", description: "Implement the search endpoint", kind: "coding" },
    { id: "t3", description: "Write tests for the search endpoint", kind: "coding" },
    { id: "t4", description: "Verify search latency under load", kind: "general" },
    { id: "t5", description: "Review the change before submit", kind: "general" },
  ],
};

async function main(): Promise<void> {
  const router = new SubAgentRouter();

  console.log(`Routing ${PLAN.tasks.length} task(s) for goal "${PLAN.goalId}":\n`);

  for (const routed of router.routePlan(PLAN)) {
    const t: Task = routed.task;
    console.log(`  ${t.id}  ${routed.role.toUpperCase().padEnd(9)} <- "${t.description}"`);
    console.log(`        reason: ${routed.reason}`);

    // Execute on the routed specialised worker (sequential).
    const result = await routed.worker.execute({ goalId: PLAN.goalId, tasks: [t] }, CONTEXT);
    const r = result.results[0];
    console.log(`        result: ${r?.success ? "ok" : "failed"} — ${r?.output}\n`);
  }
}

void main();
