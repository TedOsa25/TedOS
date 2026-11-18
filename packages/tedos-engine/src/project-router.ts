import type { Project } from "./types.js";
import type { ProjectRegistry } from "./project.js";

/**
 * ProjectRouter resolves where discovered work belongs.
 *
 * Resolution is simple and repository-first: a source repository is
 * matched against each project's `repository`; anything without a match
 * (or without a repository at all) falls back to the default project.
 * This guarantees every discovered goal resolves to exactly one project.
 */
export class ProjectRouter {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly fallbackProject: string,
  ) {}

  /** Resolve a source repository (if any) to the project that owns it. */
  resolve(repository: string | undefined): Project | undefined {
    if (repository) {
      const matched = this.registry
        .all()
        .find((project) => project.repository === repository);
      if (matched) return matched;
    }
    return this.registry.get(this.fallbackProject);
  }
}
