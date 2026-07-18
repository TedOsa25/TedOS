import type { GoalStatus, TaskKind } from "./types.js";
import type { VerificationResult } from "./verifier.js";
import type { PolicyDecision } from "./policy.js";

/** A goal's status in the trace, including the policy "paused" state. */
export type ExecutionStatus = GoalStatus | "awaiting_approval";

/** One task's execution as recorded for the trace. */
export interface TaskTrace {
  title: string;
  kind: TaskKind;
  worker: string;
  status: "ok" | "failed";
  output: string;
  changedFiles: string[];
  commands: string[];
}

/** The Reviewer's verdict, recorded for the trace. */
export interface ReviewTrace {
  approved: boolean;
  reason: string;
}

/** One goal's execution detail, produced by the Runtime. */
export interface GoalExecution {
  id: string;
  title: string;
  priority: number;
  status: ExecutionStatus;
  attempts: number;
  tasks: TaskTrace[];
  verification: VerificationResult;
  policy: PolicyDecision;
  review: ReviewTrace;
}

/** A goal in the trace: its execution plus where it came from. */
export interface GoalTrace extends GoalExecution {
  source: string;
  project: string;
}

/** Everything observed during one tick/run. */
export interface RunTrace {
  tick: number;
  discovered: number;
  submitted: number;
  rejected: number;
  executed: number;
  goals: GoalTrace[];
}

/**
 * ExecutionTrace is an in-memory record of what the loop did.
 *
 * It stores one RunTrace per tick and can print a readable summary. It is
 * purely observational — it holds no behavior the loop depends on.
 */
export class ExecutionTrace {
  readonly runs: RunTrace[] = [];

  record(run: RunTrace): void {
    this.runs.push(run);
  }

  print(): void {
    for (const run of this.runs) {
      console.log(
        `\nTick ${run.tick} — discovered ${run.discovered}, submitted ${run.submitted}, ` +
          `rejected ${run.rejected}, executed ${run.executed}`,
      );

      for (const goal of run.goals) {
        console.log(
          `  [${goal.status}] ${goal.title} (p${goal.priority}, ${goal.attempts} attempt(s)) ` +
            `source=${goal.source} project=${goal.project}`,
        );
        console.log(`      policy: ${goal.policy.level} — ${goal.policy.reason}`);
        for (const task of goal.tasks) {
          const mark = task.status === "ok" ? "ok " : "err";
          console.log(
            `      ${mark} ${task.kind.padEnd(8)} ${task.worker.padEnd(7)} ${task.title} -> ${task.output}`,
          );
          if (task.changedFiles.length > 0) {
            console.log(`          changed: ${task.changedFiles.join(", ")}`);
          }
          if (task.commands.length > 0) {
            console.log(`          ran: ${task.commands.join(", ")}`);
          }
        }
        if (goal.verification.skipped) {
          console.log(`      verify: skipped (no changes)`);
        } else {
          const summary = goal.verification.steps
            .map((step) => `${step.name}:${step.ok ? "ok" : "fail"}`)
            .join(" ");
          console.log(
            `      verify: ${goal.verification.passed ? "passed" : "failed"} (${summary})`,
          );
        }
        console.log(
          `      review: ${goal.review.approved ? "approved" : "rejected"} — ${goal.review.reason}`,
        );
      }
    }
  }
}
