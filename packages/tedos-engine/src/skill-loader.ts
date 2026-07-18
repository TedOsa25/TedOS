// Skill loading for the Intelligence Layer.
//
// Goal: before a Worker executes a task, load the most relevant skill from
// the existing skills folder and pass its content into the worker — with
// deterministic keyword rules only. No AI, no embeddings, no vector DB, no
// semantic search.
//
// This sits AROUND the worker as a decorator (SkillAwareWorker) that
// implements the existing Worker interface and delegates to an unchanged
// inner worker. The kernel is never modified.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ExecutionResult, Plan, ProjectContext, Task, Worker, WorkerKind } from "./types.js";
import { WorkerFactory } from "./workers.js";

// Default skills folder: ai-os/skills, relative to this file
// (.../packages/tedos-engine/src -> ai-os).
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_DIR = resolve(HERE, "..", "..", "..", "skills");

/** A loaded skill: the matched file name and its markdown content. */
export interface LoadedSkill {
  name: string;
  content: string;
}

/** One deterministic rule: if the pattern matches the task text, use `file`. */
interface SkillRule {
  pattern: RegExp;
  file: string;
}

/**
 * Ordered, first-match-wins rules mapping task text to a skill file.
 *
 * Order matters and is fixed, so selection is fully deterministic. A rule may
 * point at a file that does not exist (e.g. security.md) — the loader simply
 * returns no skill in that case, and execution continues normally.
 */
const RULES: SkillRule[] = [
  { pattern: /\breact\b/i, file: "react.md" },
  { pattern: /\bcarbon\b|\bemission|\bco2\b|\bghg\b/i, file: "carbon.md" },
  { pattern: /\bsales\b|\blead\b|\bcrm\b|\bpipeline\b/i, file: "sales.md" },
  { pattern: /\bsecurity\b|\bvuln|\badvisory\b|\bcve\b/i, file: "security.md" },
  { pattern: /\bmarketing\b|\bcampaign\b|\blaunch\b|\btweet\b/i, file: "marketing.md" },
  { pattern: /\bsupabase\b|\bpostgres\b|\bdatabase\b/i, file: "supabase.md" },
  { pattern: /\besrs\b|\bcsrd\b/i, file: "esrs.md" },
  { pattern: /\bcatena\b/i, file: "catena-x.md" },
  { pattern: /\bprompt\b/i, file: "prompt-engineering.md" },
];

/**
 * SkillLoader selects and reads a skill for a task using fixed rules.
 *
 * It never throws: a missing, empty, or unreadable skill file yields null,
 * which callers treat as "no skill — continue normally".
 */
export class SkillLoader {
  private readonly dir: string;

  constructor(skillsDir: string = process.env.TEDOS_SKILLS_DIR ?? DEFAULT_SKILLS_DIR) {
    this.dir = isAbsolute(skillsDir) ? skillsDir : resolve(process.cwd(), skillsDir);
  }

  /** The skill file a piece of text maps to (first matching rule), or null. */
  select(text: string): string | null {
    for (const rule of RULES) {
      if (rule.pattern.test(text)) return rule.file;
    }
    return null;
  }

  /** Load the skill for some text, or null if none matches / file is unusable. */
  forText(text: string): LoadedSkill | null {
    const file = this.select(text);
    if (!file) return null;
    try {
      const path = join(this.dir, file);
      if (!existsSync(path)) return null;
      const content = readFileSync(path, "utf8").trim();
      if (content.length === 0) return null; // empty placeholder skill -> no skill
      return { name: file, content };
    } catch {
      return null; // never fail execution because of a skill read error
    }
  }

  /** Load the skill for the first task in a plan that matches a rule. */
  forPlan(plan: Plan): LoadedSkill | null {
    for (const task of plan.tasks) {
      const skill = this.forText(task.description);
      if (skill) return skill;
    }
    return null;
  }
}

/**
 * SkillAwareWorker wraps any Worker and loads a skill before execution.
 *
 * Flow: Task -> SkillLoader -> load matching skill -> inject the skill content
 * into the plan -> delegate to the inner worker -> execute.
 *
 * It implements the existing Worker interface and keeps the inner worker's
 * behaviour unchanged: when no skill matches, the original plan is passed
 * through untouched. The decorator is the only new piece — the wrapped worker
 * (ClaudeWorker, LocalWorker, …) is reused as-is.
 */
export class SkillAwareWorker implements Worker {
  readonly name: string;

  constructor(
    private readonly inner: Worker,
    private readonly loader: SkillLoader,
    private readonly log: (message: string) => void = (m) => console.log(m),
  ) {
    this.name = inner.name;
  }

  async execute(plan: Plan, context: ProjectContext): Promise<ExecutionResult> {
    const skill = this.loader.forPlan(plan);
    if (!skill) {
      // No matching skill — continue normally with the unchanged plan.
      return this.inner.execute(plan, context);
    }

    this.log(`Loaded skill:\n${skill.name}`);
    this.log("");
    this.log("Executing task...");
    return this.inner.execute(this.applySkill(plan, skill), context);
  }

  /** Inject the skill content as a preamble on the plan's first task. */
  private applySkill(plan: Plan, skill: LoadedSkill): Plan {
    const [first, ...rest] = plan.tasks;
    if (!first) return plan;
    const guided: Task = {
      ...first,
      description: `Apply the "${skill.name}" skill below.\n\n${skill.content}\n\n---\n\n${first.description}`,
    };
    return { goalId: plan.goalId, tasks: [guided, ...rest] };
  }
}

/**
 * Activate skill loading inside the normal TedOS execution path.
 *
 * The kernel's TaskDispatcher builds every Worker through WorkerFactory.create.
 * This composes a SkillAwareWorker around that boundary at runtime — without
 * editing any kernel source — so every worker the Runtime dispatches is
 * skill-aware. It preserves the Worker interface (the decorator IS a Worker)
 * and is fully reversible: the returned function restores the original
 * factory, so the standalone demo and other tests are unaffected.
 */
export function activateSkillLoading(
  loader: SkillLoader = new SkillLoader(),
  log: (message: string) => void = (m) => console.log(m),
): () => void {
  const original = WorkerFactory.create;
  WorkerFactory.create = (kind: WorkerKind): Worker =>
    new SkillAwareWorker(original(kind), loader, log);
  return () => {
    WorkerFactory.create = original;
  };
}
