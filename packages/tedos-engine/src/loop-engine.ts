import type { Goal, ProjectContext, ReviewResult } from "./types.js";
import type { TaskDispatcher } from "./dispatcher.js";
import type { TaskTrace } from "./trace.js";
import type { VerificationResult } from "./verifier.js";
import { plan } from "./planner.js";
import { run } from "./runner.js";
import { review } from "./reviewer.js";
import { verify } from "./verifier.js";

/**
 * Maximum number of attempts for a single goal.
 *
 * A goal is tried once and, if the Reviewer rejects it, re-planned and
 * retried — up to this many attempts in total before it is given up on.
 */
const MAX_ATTEMPTS = 2;

/** The result of looping a single goal through plan -> verify -> review. */
export interface LoopOutcome {
  approved: boolean;
  attempts: number;
  review: ReviewResult;
  tasks: TaskTrace[];
  verification: VerificationResult;
}

/**
 * LoopEngine adds the Improve -> Repeat step to the execution flow.
 *
 * Each attempt: plan -> run (worker changes files) -> verify (typecheck,
 * tests, lint on changed work) -> review. On rejection it re-plans and
 * retries up to MAX_ATTEMPTS. It returns the final attempt's task trace,
 * verification and review so the Runtime can observe what happened.
 */
export async function loop(
  goal: Goal,
  dispatcher: TaskDispatcher,
  context: ProjectContext,
): Promise<LoopOutcome> {
  let lastReview: ReviewResult = { approved: false, reason: "Not attempted." };
  let lastTasks: TaskTrace[] = [];
  let lastVerification: VerificationResult = {
    passed: false,
    skipped: true,
    steps: [],
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Re-plan on every attempt so a retry is a fresh plan, not a replay.
    const executionPlan = plan(goal);
    const report = await run(executionPlan, dispatcher, context);
    lastTasks = report.tasks;

    const changedFiles = report.tasks.flatMap((task) => task.changedFiles);
    lastVerification = verify(context, changedFiles);
    lastReview = review(report.result, lastVerification);

    if (lastReview.approved) {
      return {
        approved: true,
        attempts: attempt,
        review: lastReview,
        tasks: lastTasks,
        verification: lastVerification,
      };
    }
  }

  return {
    approved: false,
    attempts: MAX_ATTEMPTS,
    review: lastReview,
    tasks: lastTasks,
    verification: lastVerification,
  };
}
