import type { Goal, GoalInput, GoalStatus, SubmitResult } from "./types.js";
import { GoalQueue } from "./queue.js";

/** Statuses that mean a goal has finished, successfully or not. */
const TERMINAL: GoalStatus[] = ["done", "failed"];

/**
 * GoalEngine decides what TedOS should work on next.
 *
 * It owns the lifecycle of a goal: receive -> validate -> reject
 * duplicates -> store -> expose the highest-priority one. Active goals
 * live in a reused GoalQueue (the in-memory store and priority
 * selector); finished goals stay there too, classified as completed.
 *
 * The Scheduler and Runtime talk to the engine instead of operating on
 * goals directly, so all goal decisions live in one place.
 */
export class GoalEngine {
  private readonly queue = new GoalQueue();

  /** Receive a goal: validate it and reject duplicates before storing. */
  submit(goal: GoalInput): SubmitResult {
    const invalid = this.validate(goal);
    if (invalid) return { accepted: false, reason: invalid };

    if (this.isDuplicate(goal)) {
      return { accepted: false, reason: `Duplicate goal: ${goal.id}` };
    }

    this.queue.add(goal);
    return { accepted: true, reason: "Goal accepted." };
  }

  /** True when there is no pending work for the Scheduler. */
  isEmpty(): boolean {
    return this.queue.isEmpty();
  }

  /** The next highest-priority goal to work on, or undefined if none. */
  next(): Goal | undefined {
    return this.queue.next();
  }

  /** Mark a goal as being worked on. */
  markInProgress(id: string): void {
    this.queue.updateStatus(id, "in_progress");
  }

  /** Move a goal to a terminal status (done or failed). */
  finish(id: string, status: "done" | "failed"): void {
    this.queue.updateStatus(id, status);
  }

  /** Goals still pending or in progress. */
  active(): readonly Goal[] {
    return this.queue.all().filter((g) => !TERMINAL.includes(g.status));
  }

  /** Goals that have reached a terminal status. */
  completed(): readonly Goal[] {
    return this.queue.all().filter((g) => TERMINAL.includes(g.status));
  }

  // --- internals ---

  /** Returns an error message if the goal is invalid, otherwise null. */
  private validate(goal: GoalInput): string | null {
    if (!goal.id.trim()) return "Goal id is required.";
    if (!goal.title.trim()) return "Goal title is required.";
    if (!Number.isFinite(goal.priority)) {
      return "Goal priority must be a finite number.";
    }
    return null;
  }

  /** A goal is a duplicate if its id or title already exists in the engine. */
  private isDuplicate(goal: GoalInput): boolean {
    const title = goal.title.trim().toLowerCase();
    return this.queue
      .all()
      .some((g) => g.id === goal.id || g.title.trim().toLowerCase() === title);
  }
}
