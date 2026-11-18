import type { Goal } from "./types.js";
import type { ActiveProject } from "./project.js";
import type { GoalExecution } from "./trace.js";
import type { PolicyDecision, PolicyEngine } from "./policy.js";
import type { ApprovalGate } from "./approval-gate.js";
import type { ReviewResult } from "./types.js";
import { DefaultDispatchStrategy, TaskDispatcher } from "./dispatcher.js";
import { loop } from "./loop-engine.js";

/** Running totals plus the per-goal execution detail for the trace. */
export interface RuntimeState {
  processed: number;
  succeeded: number;
  failed: number;
  rejected: number;
  awaiting: number;
  executions: GoalExecution[];
}

/**
 * Runtime is the autonomous execution loop.
 *
 * It executes against a single ActiveProject. Before any goal runs, the
 * Policy Engine classifies it: FORBIDDEN goals are rejected, approval-gated
 * goals pause until approved, and SAFE (or approved) goals go through the
 * Loop Engine as usual. The policy gate sits here — before the Worker.
 */
export class Runtime {
  readonly state: RuntimeState = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    rejected: 0,
    awaiting: 0,
    executions: [],
  };
  private readonly dispatcher = new TaskDispatcher(new DefaultDispatchStrategy());

  constructor(
    private readonly project: ActiveProject,
    private readonly policy: PolicyEngine,
    private readonly approvals: ApprovalGate,
  ) {}

  /** Process every pending goal until the project has no work left. */
  async run(): Promise<RuntimeState> {
    while (!this.project.engine.isEmpty()) {
      const goal = this.project.engine.next();
      if (!goal) break;
      await this.process(goal);
    }
    return this.state;
  }

  /** Gate a goal by policy, then take SAFE/approved goals through the Loop. */
  private async process(goal: Goal): Promise<void> {
    this.project.engine.markInProgress(goal.id);
    this.state.processed += 1;

    const decision = this.policy.classify(goal);

    if (decision.level === "FORBIDDEN") {
      this.project.engine.finish(goal.id, "failed");
      this.state.rejected += 1;
      this.recordGated(goal, "failed", decision, decision.reason);
      return;
    }

    if (decision.level === "APPROVAL_REQUIRED" && !this.approvals.isApproved(goal.id)) {
      this.approvals.requestApproval(goal.id, `${goal.title}: ${decision.reason}`);
      // Left in progress (not terminal) — it resumes once approved.
      this.state.awaiting += 1;
      this.recordGated(goal, "awaiting_approval", decision, `awaiting approval — ${decision.reason}`);
      return;
    }

    // SAFE, or APPROVAL_REQUIRED already approved -> execute.
    const outcome = await loop(goal, this.dispatcher, this.project.context);
    const status = outcome.approved ? "done" : "failed";
    this.project.engine.finish(goal.id, status);
    if (outcome.approved) this.state.succeeded += 1;
    else this.state.failed += 1;

    this.state.executions.push({
      id: goal.id,
      title: goal.title,
      priority: goal.priority,
      status,
      attempts: outcome.attempts,
      tasks: outcome.tasks,
      verification: outcome.verification,
      policy: decision,
      review: { approved: outcome.review.approved, reason: outcome.review.reason },
    });
  }

  /** Record a goal that the policy gate handled without running it. */
  private recordGated(
    goal: Goal,
    status: GoalExecution["status"],
    policy: PolicyDecision,
    reason: string,
  ): void {
    const review: ReviewResult = { approved: false, reason };
    this.state.executions.push({
      id: goal.id,
      title: goal.title,
      priority: goal.priority,
      status,
      attempts: 0,
      tasks: [],
      verification: { passed: true, skipped: true, steps: [] },
      policy,
      review,
    });
  }
}
