import type { ProjectContext } from "./types.js";
import { ProjectTools } from "./project-tools.js";

/** The gate steps, run in order: typecheck -> tests -> lint. */
const STEPS = [
  { name: "typecheck", command: "npm run typecheck" },
  { name: "tests", command: "npm test" },
  { name: "lint", command: "npm run lint" },
];

/** The outcome of one verification step. */
export interface VerificationStep {
  name: string;
  ok: boolean;
  output: string;
}

/** The outcome of the whole verification gate for a goal. */
export interface VerificationResult {
  passed: boolean;
  skipped: boolean;
  steps: VerificationStep[];
}

/**
 * Verifier runs the project's own checks on changed work.
 *
 * It is the gate between a worker's file changes and the Reviewer: a goal
 * is only "done" once typecheck, tests and lint pass. It uses the same
 * allowlisted commands as the worker, runs them in order, and stops at the
 * first failure. When nothing changed there is nothing to verify, so the
 * gate is skipped (this also keeps offline/simulated runs green).
 */
export function verify(
  context: ProjectContext,
  changedFiles: string[],
): VerificationResult {
  if (changedFiles.length === 0) {
    return { passed: true, skipped: true, steps: [] };
  }

  const tools = new ProjectTools(context.path);
  const steps: VerificationStep[] = [];

  for (const step of STEPS) {
    try {
      const result = tools.runCommand(step.command);
      steps.push({ name: step.name, ok: result.ok, output: result.output });
      if (!result.ok) {
        return { passed: false, skipped: false, steps };
      }
    } catch (err) {
      steps.push({ name: step.name, ok: false, output: String(err) });
      return { passed: false, skipped: false, steps };
    }
  }

  return { passed: true, skipped: false, steps };
}
