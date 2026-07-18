import type { ExecutionResult, Plan, ProjectContext, TaskResult } from "./types.js";
import type { TaskDispatcher } from "./dispatcher.js";
import type { TaskTrace } from "./trace.js";

/** The Runner's output: the execution result plus a per-task trace. */
export interface RunReport {
  result: ExecutionResult;
  tasks: TaskTrace[];
}

/**
 * Runner is the execution boundary.
 *
 * For each task it asks the Dispatcher which Worker should run it,
 * executes that task, and assembles both the result (for the Reviewer)
 * and a per-task trace (for observability). It depends on the Dispatcher
 * abstraction — never on a concrete worker.
 */
export async function run(
  plan: Plan,
  dispatcher: TaskDispatcher,
  context: ProjectContext,
): Promise<RunReport> {
  const tasks: TaskTrace[] = [];
  const results: TaskResult[] = [];

  for (const task of plan.tasks) {
    const worker = dispatcher.dispatch(task, context);
    const single: Plan = { goalId: plan.goalId, tasks: [task] };
    const executed = await worker.execute(single, context);

    for (const result of executed.results) {
      tasks.push({
        title: task.description,
        kind: task.kind,
        worker: worker.name,
        status: result.success ? "ok" : "failed",
        output: result.output,
        changedFiles: result.changedFiles,
        commands: result.commands,
      });
      results.push(result);
    }
  }

  return { result: { goalId: plan.goalId, results }, tasks };
}
