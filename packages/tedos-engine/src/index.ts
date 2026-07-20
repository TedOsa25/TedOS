import type { Goal, GoalProvider, Project } from "./types.js";
import type { ActiveProject } from "./project.js";
import type { GoalTrace, RunTrace } from "./trace.js";
import { createStorage } from "./storage.js";
import { RuleBasedPolicyEngine } from "./policy.js";
import { ApprovalGate } from "./approval-gate.js";
import { GoalDiscoveryEngine } from "./goal-discovery-engine.js";
import { loadGitHubProvider } from "./github.js";
import { DeterministicImpactEngine } from "./impact.js";
import { PriorityEngine } from "./priority.js";
import type { PrioritizedGoal } from "./priority.js";
import {
  BugProvider,
  FeatureProvider,
  ImprovementProvider,
  StaticGoalProvider,
} from "./providers.js";
import { ProjectRegistry } from "./project.js";
import { ProjectRouter } from "./project-router.js";
import { Scheduler } from "./scheduler.js";
import { ExecutionTrace } from "./trace.js";
import { OutcomeStore } from "./learning.js";

/**
 * Two real projects TedOS can work on. Paths are placeholders and the
 * connectors are declared by name only — none are functional yet.
 */
const HEYCARBO: Project = {
  name: "HeyCarbo",
  repository: "tedos/heycarbo",
  path: "/projects/heycarbo",
  defaultWorker: "claude",
  connectors: ["github"],
  goals: [
    { id: "carbo-export-bug", title: "Fix CSV export bug", priority: 8 },
    { id: "carbo-onboarding", title: "Improve onboarding flow", priority: 5 },
    { id: "carbo-deploy", title: "Deploy to production", priority: 9 },
  ],
};

const HEYAUDIT: Project = {
  name: "HeyAudit",
  repository: "tedos/heyaudit",
  path: "/projects/heyaudit",
  defaultWorker: "local",
  connectors: ["github", "supabase"],
  goals: [
    { id: "audit-report", title: "Generate compliance report", priority: 6 },
    { id: "audit-perf", title: "Optimize audit query performance", priority: 4 },
  ],
};

/** Where goals with no matching repository are routed. */
const FALLBACK_PROJECT = "HeyCarbo";

/**
 * Entry point — the first complete autonomous loop, now observable.
 *
 * Discovered goals are routed to the project that owns their repository,
 * executed there, and every step is recorded in an in-memory
 * ExecutionTrace which is printed as a readable summary at the end.
 */
async function main(): Promise<void> {
  // Persistence is opt-in via TEDOS_STORAGE_PATH; otherwise in-memory only.
  const storage = createStorage();
  const goalsKey = (name: string): string => `project-${name}-goals`;

  // Safety layer: classify every goal, gate approval-required ones.
  const policy = new RuleBasedPolicyEngine();
  const approvals = new ApprovalGate(storage);

  // Operator approval channel: TEDOS_APPROVE="all" or a comma-separated id list.
  const approveEnv = process.env.TEDOS_APPROVE;
  if (approveEnv) {
    const ids =
      approveEnv === "all"
        ? approvals.awaiting().map((record) => record.id)
        : approveEnv.split(",").map((id) => id.trim());
    for (const id of ids) approvals.approve(id);
  }

  const registry = new ProjectRegistry();
  registry.register(HEYCARBO);
  registry.register(HEYAUDIT);

  // Activate every project, restoring any persisted goals first.
  const active = new Map<string, ActiveProject>();
  for (const project of registry.all()) {
    const persisted = storage.load<Goal[]>(goalsKey(project.name)) ?? [];
    const prepared = registry.activate(project.name, persisted);
    if (prepared) active.set(project.name, prepared);
  }

  const router = new ProjectRouter(registry, FALLBACK_PROJECT);

  // Run-level discovery counts and a goal-id -> source map (provider name),
  // computed without touching the kernel.
  const sourceById = new Map<string, string>();
  let discovered = 0;
  let submitted = 0;
  let rejected = 0;

  // The scoring stages of the pipeline (deterministic for now).
  const impact = new DeterministicImpactEngine();
  const priority = new PriorityEngine();
  const backlog: PrioritizedGoal[] = [];

  const discoverInto = (
    providers: GoalProvider[],
    repository: string | undefined,
  ): void => {
    const target = router.resolve(repository);
    const owner = target ? active.get(target.name) : undefined;
    if (!target || !owner) return;

    for (const provider of providers) {
      for (const candidate of provider.discover()) {
        sourceById.set(candidate.id, provider.name);
      }
    }

    const { summary, scored } = new GoalDiscoveryEngine(
      providers,
      owner.engine,
      impact,
      priority,
    ).run();
    discovered += summary.collected;
    submitted += summary.submitted;
    rejected += summary.rejected;
    backlog.push(...scored);
  };

  // In-memory providers have no repository -> fallback project.
  discoverInto(
    [
      new BugProvider(),
      new FeatureProvider(),
      new ImprovementProvider(),
      new StaticGoalProvider(),
    ],
    undefined,
  );

  // GitHub provider -> project whose repository matches its repo.
  const github = await loadGitHubProvider();
  if (github) {
    discoverInto([github], github.repository);
  } else {
    console.log("GitHub unavailable — in-memory providers only.");
  }

  // Print the scored backlog, ordered by impact.
  console.log("\nScored backlog (by impact):");
  for (const item of [...backlog].sort((a, b) => b.scored.overall - a.scored.overall)) {
    const d = item.scored.dimensions;
    console.log(`  [${item.level}] impact ${item.scored.overall}  ${item.scored.candidate.title}`);
    console.log(
      `        biz ${d.businessImpact} user ${d.userImpact} rev ${d.revenuePotential} ` +
        `risk ${d.technicalRisk} effort ${d.implementationEffort}`,
    );
    console.log(`        ${item.scored.reasoning}`);
  }

  // Execute each project, collect goal traces, and persist its goals.
  // Learning (Sprint 6): every execution's outcome is also appended to the
  // Storage layer via OutcomeStore. Pure data collection — no scoring, no
  // analytics, no kernel changes; the store just records what happened.
  const outcomes = new OutcomeStore(storage);
  const goals: GoalTrace[] = [];
  let executed = 0;
  let outcomesAdded = 0;
  for (const [name, owner] of active) {
    const startedAt = Date.now();
    const state = await new Scheduler(owner, policy, approvals).start();
    const runtimeMs = Date.now() - startedAt;
    if (state) {
      executed += state.processed;
      // Store the outcome of every goal this project just processed.
      outcomesAdded += outcomes.recordRun(state.executions, runtimeMs).length;
      for (const execution of state.executions) {
        goals.push({
          ...execution,
          source: sourceById.get(execution.id) ?? "project",
          project: name,
        });
      }
    }
    // Persist active + completed/failed goals so the next run remembers them.
    storage.save(goalsKey(name), [
      ...owner.engine.active(),
      ...owner.engine.completed(),
    ]);
  }

  // Persist this run's trace, numbered after any prior runs.
  const priorRuns = storage.load<RunTrace[]>("traces") ?? [];
  const thisRun: RunTrace = {
    tick: priorRuns.length + 1,
    discovered,
    submitted,
    rejected,
    executed,
    goals,
  };
  storage.save("traces", [...priorRuns, thisRun]);

  console.log("\nPersisted run history:");
  for (const run of [...priorRuns, thisRun]) {
    console.log(
      `  tick ${run.tick}: discovered ${run.discovered}, submitted ${run.submitted}, executed ${run.executed}`,
    );
  }

  console.log(
    `\nLearning — stored execution outcomes: ${outcomes.all().length} total ` +
      `(this run added ${outcomesAdded}).`,
  );

  const trace = new ExecutionTrace();
  trace.record(thisRun);
  trace.print();

  const pending = approvals.awaiting();
  console.log(`\nAwaiting approval (${pending.length}):`);
  for (const record of pending) {
    console.log(`  - ${record.id}: ${record.reason}`);
  }
  if (pending.length > 0) {
    console.log("  Approve with: TEDOS_APPROVE=all (or a comma-separated id list)");
  }
}

main();
