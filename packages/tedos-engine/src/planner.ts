import type { Goal, Plan, Task, TaskKind } from "./types.js";

/**
 * Planner turns a goal into a concrete execution plan.
 *
 * Each task is tagged with a kind so the Task Dispatcher can route it to
 * the right worker. This first version uses a fixed breakdown
 * (analyze -> implement -> test); later versions can replace the body
 * with model-driven planning without changing the contract.
 */
export function plan(goal: Goal): Plan {
  const steps: { label: string; kind: TaskKind }[] = [
    { label: "Analyze", kind: "general" },
    { label: "Implement", kind: "coding" },
    { label: "Test locally", kind: "local" },
  ];

  const tasks: Task[] = steps.map((step, i) => ({
    id: `${goal.id}-t${i + 1}`,
    description: `${step.label}: ${goal.title}`,
    kind: step.kind,
  }));

  return { goalId: goal.id, tasks };
}
