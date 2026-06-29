import type { Goal, Project, ProjectContext } from "./types.js";
import { GoalEngine } from "./goal-engine.js";

/**
 * ActiveProject is a project prepared for execution.
 *
 * It loads goals into a dedicated Goal Engine and exposes a read-only
 * ProjectContext (including the default worker). Persisted goals (with
 * their statuses) are restored first, using only the engine's public
 * methods, then the project's own backlog is seeded — so completed work
 * is remembered across restarts and new project goals still appear.
 */
export class ActiveProject {
  readonly engine: GoalEngine;
  readonly context: ProjectContext;

  constructor(project: Project, persisted: readonly Goal[] = []) {
    this.engine = new GoalEngine();

    // Restore persisted goals with their terminal status. Pending or
    // interrupted (in_progress) goals stay pending so they re-run.
    for (const goal of persisted) {
      const accepted = this.engine.submit({
        id: goal.id,
        title: goal.title,
        priority: goal.priority,
      }).accepted;
      if (accepted && (goal.status === "done" || goal.status === "failed")) {
        this.engine.finish(goal.id, goal.status);
      }
    }

    // Seed the project's backlog; goals already restored are deduped away.
    for (const goal of project.goals) {
      this.engine.submit(goal);
    }

    this.context = {
      name: project.name,
      repository: project.repository,
      path: project.path,
      connectors: project.connectors,
      defaultWorker: project.defaultWorker,
    };
  }
}

/**
 * ProjectRegistry holds the projects TedOS knows about.
 *
 * In-memory only. It stores Project definitions and hands them out by
 * name, and can activate one — turning a definition into an
 * ActiveProject ready for the Runtime.
 */
export class ProjectRegistry {
  private readonly projects = new Map<string, Project>();

  /** Register a project definition. */
  register(project: Project): void {
    this.projects.set(project.name, project);
  }

  /** Look up a project definition by name. */
  get(name: string): Project | undefined {
    return this.projects.get(name);
  }

  /** All registered project definitions. */
  all(): readonly Project[] {
    return [...this.projects.values()];
  }

  /** Activate a project by name, optionally restoring persisted goals. */
  activate(name: string, persisted: readonly Goal[] = []): ActiveProject | undefined {
    const project = this.get(name);
    return project ? new ActiveProject(project, persisted) : undefined;
  }
}
