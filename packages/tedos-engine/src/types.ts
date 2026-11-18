// Shared domain types for the TedOS execution engine.
// One place for every contract the modules pass between each other,
// so each module stays small and only depends on these shapes.

/** Lifecycle of a goal as it moves through the engine. */
export type GoalStatus = "pending" | "in_progress" | "done" | "failed";

/** A unit of work TedOS should accomplish. */
export interface Goal {
  id: string;
  title: string;
  /** Higher number = more important. */
  priority: number;
  status: GoalStatus;
}

/** A goal as submitted to the engine, before it is given a status. */
export type GoalInput = Omit<Goal, "status">;

/** The Goal Engine's explainable verdict when a goal is submitted. */
export interface SubmitResult {
  accepted: boolean;
  reason: string;
}

/** What kind of work a discovered goal represents. Drives scoring. */
export type GoalKind = "bug" | "feature" | "improvement" | "static";

/** A piece of potential work surfaced by a provider, before scoring. */
export interface GoalCandidate {
  id: string;
  title: string;
  kind: GoalKind;
}

/** A source of potential work for the Goal Discovery Engine. */
export interface GoalProvider {
  readonly name: string;
  /** Return the goals this source currently suggests. */
  discover(): GoalCandidate[];
}

/** Summary of a single discovery pass. */
export interface DiscoverySummary {
  collected: number;
  unique: number;
  submitted: number;
  rejected: number;
}

/** How a task should be executed — drives which worker runs it. */
export type TaskKind = "coding" | "local" | "general";

/** A single concrete step produced by the Planner. */
export interface Task {
  id: string;
  description: string;
  kind: TaskKind;
}

/** The Planner's output: an ordered list of tasks for one goal. */
export interface Plan {
  goalId: string;
  tasks: Task[];
}

/** The outcome of running a single task. */
export interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
  /** Project-relative paths the task changed (empty for non-file work). */
  changedFiles: string[];
  /** Allowed commands the task ran (empty when none were run). */
  commands: string[];
}

/** The Runner's output: the result of every task in a plan. */
export interface ExecutionResult {
  goalId: string;
  results: TaskResult[];
}

/** The Reviewer's verdict on an execution result. */
export interface ReviewResult {
  approved: boolean;
  reason: string;
}

/**
 * A prepared, backend-agnostic description of work to execute.
 *
 * A worker builds this from a plan — it is what a real worker would send
 * to its backend (Claude, OpenAI, a local process, ...). Holding it as a
 * value keeps preparation separate from the actual call.
 */
export interface ExecutionRequest {
  worker: string;
  goalId: string;
  repository: string;
  path: string;
  connectors: string[];
  instructions: string;
  tasks: Task[];
}

/**
 * Worker executes a plan and returns the result.
 *
 * This is the execution seam in Goal -> Planner -> Worker -> Reviewer.
 * The Runner depends only on this interface and never knows whether the
 * work is handled by Claude, OpenAI, a local process or a human.
 */
export interface Worker {
  readonly name: string;
  execute(plan: Plan, context: ProjectContext): Promise<ExecutionResult>;
}

/** Which kind of worker a project runs by default. */
export type WorkerKind = "claude" | "local";

/** A software project TedOS can work on. */
export interface Project {
  name: string;
  repository: string;
  path: string;
  defaultWorker: WorkerKind;
  connectors: string[];
  goals: GoalInput[];
}

/** Read-only context describing the project an execution runs within. */
export interface ProjectContext {
  name: string;
  repository: string;
  path: string;
  connectors: string[];
  defaultWorker: WorkerKind;
}
