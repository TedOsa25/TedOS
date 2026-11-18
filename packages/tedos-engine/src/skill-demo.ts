// Skill Loader demo.
//
// Shows the flow: Task -> SkillLoader -> load matching skill -> pass content
// into the Worker -> execute. Uses the real (offline) LocalWorker, so no
// network and no model are involved.

import type { Plan, ProjectContext } from "./types.js";
import { LocalWorker } from "./workers.js";
import { SkillAwareWorker, SkillLoader } from "./skill-loader.js";

const CONTEXT: ProjectContext = {
  name: "HeyCarbo",
  repository: "tedos/heycarbo",
  path: process.cwd(),
  connectors: ["github"],
  defaultWorker: "local",
};

async function demoTask(label: string, description: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const plan: Plan = { goalId: "demo", tasks: [{ id: "demo-t1", description, kind: "coding" }] };
  const worker = new SkillAwareWorker(new LocalWorker(), new SkillLoader());
  const result = await worker.execute(plan, CONTEXT);
  console.log(`Result: ${result.results[0]?.output ?? "(no output)"}`);
}

async function main(): Promise<void> {
  // Matches the react rule -> loads react.md, prints "Loaded skill: react.md".
  await demoTask("Task with a matching skill", "Build a React dashboard component");

  // Matches the carbon rule -> loads carbon.md.
  await demoTask("Another matching skill", "Improve carbon emission calculation accuracy");

  // No rule matches -> no skill loaded, execution continues normally.
  await demoTask("Task with no matching skill", "Rename an internal variable");
}

void main();
