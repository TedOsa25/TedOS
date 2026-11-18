import type { ExecutionResult, ReviewResult } from "./types.js";
import type { VerificationResult } from "./verifier.js";

/**
 * Reviewer validates an execution result before a goal is accepted.
 *
 * A goal is approved only when every task succeeded AND the verification
 * gate (typecheck, tests, lint) passed. If nothing changed, there is
 * nothing to verify and the gate is treated as satisfied.
 */
export function review(
  result: ExecutionResult,
  verification: VerificationResult,
): ReviewResult {
  const failed = result.results.filter((r) => !r.success);
  if (failed.length > 0) {
    return { approved: false, reason: `${failed.length} task(s) failed.` };
  }

  if (!verification.passed) {
    const broken = verification.steps.find((step) => !step.ok);
    return {
      approved: false,
      reason: `Verification failed at ${broken?.name ?? "checks"}.`,
    };
  }

  if (verification.skipped) {
    return { approved: true, reason: "All tasks completed; no changes to verify." };
  }

  return { approved: true, reason: "All tasks completed and checks passed." };
}
