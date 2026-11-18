// Connector routing for the Intelligence Layer.
//
// Goal: given a task, deterministically decide which existing connector or
// tool should handle it. Rules only — no AI, no embeddings, no semantic
// search. This is a read-only classifier: it returns a ConnectorType and
// never executes anything, so the Worker interface and the kernel are
// untouched. A task that matches nothing returns "None" and execution
// continues normally.

import type { Task } from "./types.js";

/** The connectors/tools a task can be routed to. */
export type ConnectorType =
  | "GitHub"
  | "Supabase"
  | "Vercel"
  | "LinkedIn"
  | "Instagram"
  | "Filesystem"
  | "Claude"
  | "None";

/** One deterministic rule: if the pattern matches the task text, use it. */
interface ConnectorRule {
  pattern: RegExp;
  connector: ConnectorType;
}

/**
 * Ordered, first-match-wins rules mapping task text to a connector.
 *
 * Order is fixed, so routing is fully deterministic. More specific external
 * systems (GitHub, Supabase, Vercel, Filesystem) are matched before the
 * general-purpose coding worker (Claude), so e.g. "upgrade React" routes to
 * GitHub rather than Claude.
 */
const RULES: ConnectorRule[] = [
  {
    pattern: /\b(github|pull request|\bpr\b|issue|release|upgrade|version|bump|dependenc)/i,
    connector: "GitHub",
  },
  {
    pattern: /\b(supabase|database|migration|postgres|sql|schema|table|rls)/i,
    connector: "Supabase",
  },
  {
    pattern: /\b(vercel|deploy|deployment|hosting|rollback|preview)/i,
    connector: "Vercel",
  },
  {
    pattern: /\b(linkedin)/i,
    connector: "LinkedIn",
  },
  {
    pattern: /\b(instagram|insta)/i,
    connector: "Instagram",
  },
  {
    pattern: /\b(document|documentation|docs|readme|markdown|file|filesystem)/i,
    connector: "Filesystem",
  },
  {
    pattern: /\b(code|coding|implement|refactor|component|function|build|feature|fix)/i,
    connector: "Claude",
  },
];

/**
 * ConnectorRouter maps a task to the connector that should handle it.
 *
 * It is deterministic and side-effect free. Unknown tasks return "None".
 */
export class ConnectorRouter {
  /** Route a task to a connector based on its description. */
  route(task: Task): ConnectorType {
    return this.routeText(task.description);
  }

  /** Route raw text to a connector (first matching rule), or "None". */
  routeText(text: string): ConnectorType {
    for (const rule of RULES) {
      if (rule.pattern.test(text)) return rule.connector;
    }
    return "None";
  }
}
