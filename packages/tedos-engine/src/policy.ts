import type { Goal } from "./types.js";

/** How TedOS may act on a goal. */
export type PolicyLevel = "SAFE" | "APPROVAL_REQUIRED" | "FORBIDDEN";

/** A policy verdict with an explanation. */
export interface PolicyDecision {
  level: PolicyLevel;
  reason: string;
}

/**
 * PolicyEngine classifies a goal before it executes.
 *
 * The interface is the swap seam: a rule-based engine runs now, an AI
 * reasoning model could implement the same contract later without
 * changing where the gate sits.
 */
export interface PolicyEngine {
  readonly name: string;
  classify(goal: Goal): PolicyDecision;
}

/** Reject outright — never executed. */
const FORBIDDEN =
  /\b(deploy|production|prod|billing|invoice|charge|payment|secret|credential|password|token|environment file)\b|\.env|delete .*(prod|data)/;

/** Changes the project or touches the outside world — needs a human. */
const APPROVAL =
  /\b(fix|implement|modify|refactor|migrat|migration|dependenc|upgrade|optimi|improve|onboarding|pull request|pr|comment|repository|release)\b/;

/** Read-only or low-risk — runs automatically. */
const SAFE =
  /\b(research|read|test|document|documentation|readme|report|analy|draft|tweet|investigate|review)\b/;

/**
 * RuleBasedPolicyEngine classifies by deterministic keyword rules.
 *
 * Order matters: forbidden wins over approval, which wins over safe.
 * Anything unrecognised defaults to APPROVAL_REQUIRED — the cautious
 * choice, so unknown work never runs unsupervised.
 */
export class RuleBasedPolicyEngine implements PolicyEngine {
  readonly name = "rule-based";

  classify(goal: Goal): PolicyDecision {
    const title = goal.title.toLowerCase();

    const forbidden = FORBIDDEN.exec(title);
    if (forbidden) {
      return { level: "FORBIDDEN", reason: `forbidden action ("${forbidden[0]}")` };
    }

    const approval = APPROVAL.exec(title);
    if (approval) {
      return { level: "APPROVAL_REQUIRED", reason: `changes the project ("${approval[0]}")` };
    }

    const safe = SAFE.exec(title);
    if (safe) {
      return { level: "SAFE", reason: `low-risk ("${safe[0]}")` };
    }

    return { level: "APPROVAL_REQUIRED", reason: "unclassified — cautious default" };
  }
}
