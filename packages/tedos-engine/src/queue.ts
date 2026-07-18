import type { Goal, GoalStatus } from "./types.js";

/**
 * GoalQueue holds the goals TedOS still needs to accomplish.
 *
 * It is intentionally an in-memory store with no persistence yet —
 * just enough to feed the autonomous loop. Selection is by priority:
 * the highest-priority pending goal is always worked on first.
 */
export class GoalQueue {
  private readonly goals: Goal[] = [];

  /** Add a new goal. It always starts in the "pending" state. */
  add(goal: Omit<Goal, "status">): void {
    this.goals.push({ ...goal, status: "pending" });
  }

  /** True when no goals are waiting to be worked on. */
  isEmpty(): boolean {
    return !this.goals.some((g) => g.status === "pending");
  }

  /** The highest-priority pending goal, or undefined if none remain. */
  next(): Goal | undefined {
    return this.goals
      .filter((g) => g.status === "pending")
      .sort((a, b) => b.priority - a.priority)[0];
  }

  /** Update a goal's status by id. */
  updateStatus(id: string, status: GoalStatus): void {
    const goal = this.goals.find((g) => g.id === id);
    if (goal) goal.status = status;
  }

  /** Read-only view of every goal, for inspection and reporting. */
  all(): readonly Goal[] {
    return this.goals;
  }
}
