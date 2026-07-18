import type { ProjectContext, Task, Worker, WorkerKind } from "./types.js";
import { WorkerFactory } from "./workers.js";

/** A DispatchStrategy decides which kind of worker should run a task. */
export interface DispatchStrategy {
  readonly name: string;
  decide(task: Task, context: ProjectContext): WorkerKind;
}

/**
 * DefaultDispatchStrategy routes tasks with simple rules:
 *   coding -> claude (ClaudeWorker)
 *   local  -> local  (LocalWorker)
 *   else   -> the project's default worker
 */
export class DefaultDispatchStrategy implements DispatchStrategy {
  readonly name = "default";

  decide(task: Task, context: ProjectContext): WorkerKind {
    switch (task.kind) {
      case "coding":
        return "claude";
      case "local":
        return "local";
      default:
        return context.defaultWorker;
    }
  }
}

/**
 * TaskDispatcher picks the Worker for a task.
 *
 * It applies a DispatchStrategy to choose a worker kind, then builds the
 * concrete Worker via the WorkerFactory. The Runner asks the dispatcher
 * for a worker per task instead of holding one itself — so where work
 * runs is decided here, not in the Runner.
 */
export class TaskDispatcher {
  constructor(private readonly strategy: DispatchStrategy) {}

  dispatch(task: Task, context: ProjectContext): Worker {
    const kind = this.strategy.decide(task, context);
    return WorkerFactory.create(kind);
  }
}
