import type { GoalCandidate, GoalProvider } from "./types.js";

/**
 * In-memory goal providers.
 *
 * Each provider is a source of potential work. For now they return
 * hardcoded candidates, but they all implement the same GoalProvider
 * interface — so a real source (GitHub, Slack, Supabase, ...) can be
 * dropped in later without the Discovery Engine knowing the difference.
 */

/** Baseline goals that should always exist. */
export class StaticGoalProvider implements GoalProvider {
  readonly name = "static";

  discover(): GoalCandidate[] {
    return [
      { id: "static-readme", title: "Write project README", kind: "static" },
      // Intentionally overlaps with BugProvider to show de-duplication.
      { id: "static-login", title: "Fix login bug", kind: "static" },
    ];
  }
}

/** Suggests improvements to the system itself. */
export class ImprovementProvider implements GoalProvider {
  readonly name = "improvement";

  discover(): GoalCandidate[] {
    return [
      { id: "imp-trace", title: "Add execution trace", kind: "improvement" },
    ];
  }
}

/** Suggests bugs that need fixing. */
export class BugProvider implements GoalProvider {
  readonly name = "bug";

  discover(): GoalCandidate[] {
    return [{ id: "bug-login", title: "Fix login bug", kind: "bug" }];
  }
}

/** Suggests new features to build. */
export class FeatureProvider implements GoalProvider {
  readonly name = "feature";

  discover(): GoalCandidate[] {
    return [{ id: "feat-tweet", title: "Draft launch tweet", kind: "feature" }];
  }
}
