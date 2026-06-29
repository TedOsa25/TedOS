// Sub-agent routing for the Intelligence Layer.
//
// Goal: route each task to a specialised worker for one of four roles —
// Research, Developer, QA, Reviewer — using deterministic, first-match-wins
// rules (no AI). Each role is a RoleWorker that REUSES the existing Worker
// interface and is built from the existing WorkerFactory, so the kernel
// (Dispatcher, Worker, Runner, ...) is untouched. Routing is per-task and
// sequential: no parallel execution, no worktrees, no orchestration redesign.

import type {
  ExecutionResult,
  Plan,
  ProjectContext,
  Task,
  Worker,
  WorkerKind,
} from "./types.js";
import { WorkerFactory } from "./workers.js";

/** The four specialised sub-agent roles. */
export type Role = "research" | "developer" | "qa" | "reviewer";

/** The roles, in lifecycle order. */
export const ROLES: readonly Role[] = ["research", "developer", "qa", "reviewer"];

/**
 * RoleWorker is a specialised worker for one role.
 *
 * It reuses the Worker interface and delegates execution to a backing worker
 * (built from the existing WorkerFactory). Its `name` is the role, so traces
 * show which sub-agent handled the task; behaviour is exactly the backing
 * worker's. No new execution path — composition over the existing seam.
 */
export class RoleWorker implements Worker {
  readonly name: Role;

  constructor(
    readonly role: Role,
    private readonly backing: Worker,
  ) {
    this.name = role;
  }

  execute(plan: Plan, context: ProjectContext): Promise<ExecutionResult> {
    return this.backing.execute(plan, context);
  }
}

/** Which backing worker kind each role runs on. */
const ROLE_BACKING: Record<Role, WorkerKind> = {
  research: "local", // offline investigation / notes
  developer: "claude", // real code changes (simulated offline)
  qa: "local", // runs checks / verification
  reviewer: "local", // inspects, no code changes
};

/** Build the default RoleWorker for each role from the existing factory. */
export function defaultRoleWorkers(): Record<Role, RoleWorker> {
  return {
    research: new RoleWorker("research", WorkerFactory.create(ROLE_BACKING.research)),
    developer: new RoleWorker("developer", WorkerFactory.create(ROLE_BACKING.developer)),
    qa: new RoleWorker("qa", WorkerFactory.create(ROLE_BACKING.qa)),
    reviewer: new RoleWorker("reviewer", WorkerFactory.create(ROLE_BACKING.reviewer)),
  };
}

/** One deterministic rule: if the pattern matches the task, use this role. */
interface RoleRule {
  pattern: RegExp;
  role: Role;
}

/**
 * Ordered, first-match-wins rules mapping task text to a role.
 *
 * The order is fixed, so routing is fully deterministic. The terminal,
 * specialised roles are matched before the general "developer" doer: a task
 * like "write tests" routes to QA (the "test" signal wins over "write"), and
 * "review the change" routes to Reviewer. Anything that matches nothing falls
 * back to Developer — the default executor.
 */
const RULES: RoleRule[] = [
  { pattern: /\b(review|audit|approve|sign[- ]?off|inspect)\b/i, role: "reviewer" },
  { pattern: /\b(test|tests|qa|verify|validate|lint|regression|coverage)\b/i, role: "qa" },
  {
    pattern: /\b(research|investigate|explore|analyse|analyze|spike|evaluate|compare|study)\b/i,
    role: "research",
  },
  {
    pattern: /\b(implement|build|add|fix|refactor|create|write|update|migrate|develop)\b/i,
    role: "developer",
  },
];

/** A routing decision: the chosen role and a readable reason. */
export interface RouteDecision {
  role: Role;
  reason: string;
}

/**
 * Decide a task's role deterministically. Coding tasks default to Developer
 * unless a stronger (QA/Reviewer/Research) keyword applies; everything else
 * falls back to Developer too. Pure and side-effect free.
 */
export function routeRole(task: Task): RouteDecision {
  const text = task.description.toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { role: rule.role, reason: `matched /${rule.pattern.source}/ in task text` };
    }
  }
  if (task.kind === "coding") {
    return { role: "developer", reason: "coding task with no specialised signal" };
  }
  return { role: "developer", reason: "default doer (no rule matched)" };
}

/** The full routing result for a task: its decision and the chosen worker. */
export interface Routed {
  task: Task;
  role: Role;
  reason: string;
  worker: Worker;
}

/**
 * SubAgentRouter routes tasks to the four role workers.
 *
 * It is a read-only classifier plus a worker lookup: given a task it returns
 * the role and the specialised Worker to run it. Callers execute that worker
 * themselves, sequentially — the router neither runs nor parallelises work.
 */
export class SubAgentRouter {
  private readonly workers: Record<Role, Worker>;

  constructor(workers: Record<Role, Worker> = defaultRoleWorkers()) {
    this.workers = workers;
  }

  /** The specialised worker registered for a role. */
  workerFor(role: Role): Worker {
    return this.workers[role];
  }

  /** Route one task: decide its role and return the worker that handles it. */
  route(task: Task): Routed {
    const { role, reason } = routeRole(task);
    return { task, role, reason, worker: this.workers[role] };
  }

  /** Route a whole plan's tasks, in order. No parallelism. */
  routePlan(plan: Plan): Routed[] {
    return plan.tasks.map((task) => this.route(task));
  }
}
