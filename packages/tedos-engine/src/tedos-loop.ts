// TedOS automation loop — one local, single-process, sequential loop.
//
// It wires the EXISTING components together and runs them on a timer:
//
//   Research -> Reasoner -> Feedback (adjusts impact) -> Goal Discovery ->
//   Impact -> Priority -> Goal Engine -> Runtime -> Learning (store outcomes)
//   -> Connector Router -> Connectors (only when required) -> Sub-Agent Routing
//   -> print summary -> sleep -> repeat
//
// It introduces no new framework, no parallelism, no cloud, no queue
// redesign. Every component is imported and used as-is — the kernel is
// untouched. The loop's only state is "are we stopping?" plus tick
// bookkeeping.

import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

import type { GoalKind, Project, Task } from "./types.js";
import type { PolicyEngine } from "./policy.js";
import type { ImpactScorer } from "./impact.js";
import type { ResearchProvider } from "./research/types.js";
import { ActiveProject, ProjectRegistry } from "./project.js";
import { ProjectRouter } from "./project-router.js";
import { Runtime } from "./runtime.js";
import { RuleBasedPolicyEngine } from "./policy.js";
import { ApprovalGate } from "./approval-gate.js";
import { createStorage } from "./storage.js";
import { DeterministicImpactEngine } from "./impact.js";
import { PriorityEngine } from "./priority.js";
import { ResearchEngine } from "./research-engine.js";
import { loadResearchProviders } from "./research/providers.js";
import { activateSkillLoading } from "./skill-loader.js";
// Already-implemented components being wired into the live path this sprint.
import { OutcomeStore, OutcomeLearningStore } from "./learning.js";
import { FeedbackEngine } from "./feedback.js";
import { SubAgentRouter } from "./subagent-router.js";
import { ConnectorRegistry } from "./connectors.js";
import { AttributionStore } from "./goal-attribution.js";
import { OutcomeEngine, isImplemented } from "./outcome-engine.js";
import { OutcomeFeedbackEngine } from "./outcome-prioritization.js";
import { buildDashboard, renderDashboard, type BusinessImpactDashboard } from "./business-dashboard.js";
import { DistributionQueue } from "./distribution-queue.js";
import { PublisherRegistry } from "./distribution-connectors.js";
import { DistributionAnalyticsStore, DistributionLearningStore, buildDistributionSection, renderDistributionSection } from "./distribution-analytics.js";
import { DistributionEngine } from "./distribution-engine.js";
import { GrowthEngine, type GrowthTickResult } from "./growth-engine.js";

/** Default loop interval: 15 minutes. */
const DEFAULT_INTERVAL_MS = 900_000;

// ---------------------------------------------------------------------------
// Selectable projects
//
// The loop runs against ONE project per process. The default is TedOS itself
// (unchanged). HeyCarbo and HeyAudit are real product repos under the
// monorepo; their paths are resolved relative to the engine's cwd and are only
// touched by a real (online) worker — offline runs simulate, so selection is
// deterministic. No project manager, no multi-workspace: we register the known
// projects in the EXISTING ProjectRegistry and pick one.
// ---------------------------------------------------------------------------

/** The default project: TedOS working on itself. */
const TEDOS: Project = {
  name: "TedOS",
  repository: "tedos/tedos",
  path: process.cwd(),
  defaultWorker: "local",
  connectors: ["github"],
  // A SAFE seed goal whose tasks match a skill rule, so the live loop has at
  // least one executable task that loads a skill (React -> react.md).
  goals: [{ id: "seed-react-review", title: "Research and review React component reuse", priority: 7 }],
};

const HEYCARBO: Project = {
  name: "HeyCarbo",
  repository: "tedos/heycarbo",
  path: resolvePath(process.cwd(), "..", "..", "..", "HeyCarbo"),
  defaultWorker: "local",
  connectors: ["github", "supabase", "vercel"],
  goals: [{ id: "carbo-readme", title: "Document the HeyCarbo readme", priority: 5 }],
};

const HEYAUDIT: Project = {
  name: "HeyAudit",
  repository: "tedos/heyaudit",
  path: resolvePath(process.cwd(), "..", "..", "..", "HeyAudit"),
  defaultWorker: "local",
  connectors: ["github", "supabase"],
  goals: [{ id: "audit-readme", title: "Document the HeyAudit readme", priority: 5 }],
};

/** Build the registry of known projects (TedOS is the fallback). */
function buildRegistry(): ProjectRegistry {
  const registry = new ProjectRegistry();
  registry.register(TEDOS);
  registry.register(HEYCARBO);
  registry.register(HEYAUDIT);
  return registry;
}

/**
 * Read the requested project from the CLI (`--project <name>` / `--project=x`)
 * or the TEDOS_PROJECT env var. CLI wins; nothing set means "use the default".
 */
export function readProjectSelection(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--project" && argv[i + 1]) return argv[i + 1];
    if (arg.startsWith("--project=")) return arg.slice("--project=".length);
  }
  return process.env.TEDOS_PROJECT || undefined;
}

/**
 * Resolve a selection (name, case-insensitive) to a Project. Reuses the
 * ProjectRegistry for lookup and the ProjectRouter for the guaranteed fallback
 * to TedOS, so an unknown or empty selection always resolves to the default.
 */
export function selectProject(selection: string | undefined): Project {
  const registry = buildRegistry();
  const router = new ProjectRouter(registry, TEDOS.name);
  if (selection) {
    const match = registry.all().find((p) => p.name.toLowerCase() === selection.toLowerCase());
    if (match) return match;
  }
  return router.resolve(undefined) ?? TEDOS;
}

/** A sleep that resolves on timeout OR when the abort signal fires. */
export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

const defaultSleep: SleepFn = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    function cleanup(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
    function onAbort(): void {
      cleanup();
      resolve();
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Infer a goal's kind from its title — used only to synthesise the impact score
 * that anchors a goal's EXPECTED business value for the Outcome Engine. Mirrors
 * the deterministic keyword style of impact.ts.
 */
function inferGoalKind(title: string): GoalKind {
  const t = title.toLowerCase();
  if (/\bfix\b|bug|error|broken|regression|crash/.test(t)) return "bug";
  if (/\badd\b|new |feature|implement|build|introduce|launch/.test(t)) return "feature";
  if (/document|readme|cleanup|chore|refactor/.test(t)) return "static";
  return "improvement";
}

/** What one tick observed, from Research and Runtime (both reused as-is). */
export interface TickSummary {
  tick: number;
  discovered: number;
  unique: number;
  submitted: number;
  rejected: number;
  processed: number;
  succeeded: number;
  failed: number;
  awaiting: number;
  /** Goals the Policy Engine refused to run (FORBIDDEN). */
  blocked: number;
  /** Active impact scorer's name — proves the FeedbackEngine is in the path. */
  impactEngine: string;
  /** Outcomes the Learning store recorded this tick, and the running total. */
  outcomesRecorded: number;
  outcomesTotal: number;
  /** Goals measured for BUSINESS impact this tick (done + approved). */
  outcomesAssessed: number;
  /** Average ROI of the goals assessed this tick (0 when none). */
  avgRoi: number;
  /** Total outcome learnings recorded so far. */
  learningsTotal: number;
  /** Approved distribution jobs published/sent this tick (skipped offline). */
  distributed: number;
  /** Growth Engine result — the business deliverables prepared this tick. */
  growth: GrowthTickResult;
  /** Connectors selected for the executed tasks this tick, by connector name. */
  connectors: Record<string, number>;
  /** Worker roles chosen for the executed tasks this tick, by role. */
  roles: Record<string, number>;
}

/** Everything the loop needs; assembled by createTedosLoop. */
export interface LoopDeps {
  active: ActiveProject;
  /** The project definition the loop is running against (for reporting). */
  selected: Project;
  policy: PolicyEngine;
  approvals: ApprovalGate;
  impact: ImpactScorer;
  priority: PriorityEngine;
  outcomes: OutcomeStore;
  /** Outcome & Business Impact engine + its two stores (Sprint A). */
  attributions: AttributionStore;
  learnings: OutcomeLearningStore;
  outcomeEngine: OutcomeEngine;
  /** Distribution Engine + its shared queue (credential-gated; inert offline). */
  distributionQueue: DistributionQueue;
  distribution: DistributionEngine;
  /** Growth Engine — generates business deliverables each tick (the productive core). */
  growth: GrowthEngine;
  subagents: SubAgentRouter;
  connectors: ConnectorRegistry;
  loadProviders: () => Promise<ResearchProvider[]>;
  intervalMs: number;
  maxTicks: number | null;
  sleep: SleepFn;
  log: (message: string) => void;
}

/** Read the loop interval from the environment (ms), or the 15-minute default. */
export function readIntervalMs(): number {
  const raw = process.env.TEDOS_LOOP_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_MS;
}

/** Read the optional tick cap from the environment; null means "run forever". */
export function readMaxTicks(): number | null {
  const raw = process.env.TEDOS_MAX_TICKS;
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * TedosLoop runs ticks sequentially until it hits maxTicks or is stopped.
 *
 * A stop request (operator signal or stop()) lets the current tick finish,
 * then exits cleanly — it never interrupts work mid-tick.
 */
export class TedosLoop {
  readonly intervalMs: number;
  readonly maxTicks: number | null;
  /** The project this loop runs against (TedOS by default). */
  readonly selected: Project;
  private stopping = false;
  private readonly controller = new AbortController();

  constructor(private readonly deps: LoopDeps) {
    this.intervalMs = deps.intervalMs;
    this.maxTicks = deps.maxTicks;
    this.selected = deps.selected;
  }

  /** Run one tick: research -> submit (via the pipeline) -> Runtime once. */
  async tick(n: number): Promise<TickSummary> {
    const providers = await this.deps.loadProviders();

    // Research submits through the EXISTING pipeline into the project's engine.
    // deps.impact is the FeedbackEngine, so outcomes stored on earlier ticks
    // adjust each candidate's impact right here, before goals are submitted.
    const research = new ResearchEngine(
      providers,
      this.deps.active.engine,
      this.deps.impact,
      this.deps.priority,
    ).research();

    // Run the Runtime once over whatever is now pending (timed for Learning).
    const startedAt = Date.now();
    const state = await new Runtime(this.deps.active, this.deps.policy, this.deps.approvals).run();
    const runtimeMs = Date.now() - startedAt;

    // Learning: store this pass's execution outcomes automatically. The same
    // store backs the FeedbackEngine above, closing the feedback loop.
    const recorded = this.deps.outcomes.recordRun(state.executions, runtimeMs);

    // Outcome & Business Impact (Sprint A): for every goal that was actually
    // implemented this tick (done + approved), measure whether it moved the
    // business, attribute it (commit/files/areas/expected value), compute ROI,
    // and persist the learning. Offline by default → "kein nachweisbarer
    // Business Impact" until a data source is configured. Kernel untouched.
    const implemented = state.executions.filter(isImplemented);
    const scoredById = new Map(
      implemented.map((e) => [e.id, this.deps.impact.score({ id: e.id, title: e.title, kind: inferGoalKind(e.title) })]),
    );
    const assessments = this.deps.outcomeEngine.analyzeRun(implemented, scoredById);
    this.deps.attributions.recordMany(assessments.map((a) => a.attribution));
    this.deps.learnings.recordMany(assessments.map((a) => a.learning));
    const avgRoi = assessments.length
      ? Math.round((assessments.reduce((s, a) => s + a.attribution.roi, 0) / assessments.length) * 100) / 100
      : 0;

    // Growth Engine: the productive core. Each tick generates the day's business
    // deliverables (sales emails, follow-ups, comparison/landing pages, supplier
    // campaigns, LinkedIn, blog, SEO, content improvements), Brand-Guardian-checked,
    // and enqueues them credential-gated into the shared Distribution Queue as
    // pending-approval. Daily quotas mean a day's work is produced once, then idle.
    const growth = this.deps.growth.run();

    // Distribution (Autonomous Distribution Engine): publish every APPROVED job
    // through its credential-gated connector. Offline / without credentials this
    // is a no-op — approved jobs are recorded `skipped` with setup instructions,
    // never published. The queue is shared by all watchdogs.
    const dist = this.deps.distribution.run();

    // Route the tasks that actually ran through the already-built routers:
    // Connector Router -> Connectors (only when one is required), and
    // Sub-Agent Routing for the worker role. Deterministic, sequential.
    const tasks: Task[] = state.executions.flatMap((e) =>
      e.tasks.map((t, i) => ({ id: `${e.id}#${i}`, description: t.title, kind: t.kind })),
    );
    const connectors: Record<string, number> = {};
    const roles: Record<string, number> = {};
    for (const task of tasks) {
      const { connector } = this.deps.connectors.forTask(task);
      if (connector) connectors[connector.name] = (connectors[connector.name] ?? 0) + 1;
      const { role } = this.deps.subagents.route(task);
      roles[role] = (roles[role] ?? 0) + 1;
    }

    return {
      tick: n,
      discovered: research.summary.collected,
      unique: research.summary.unique,
      submitted: research.summary.submitted,
      rejected: research.summary.rejected,
      processed: state.processed,
      succeeded: state.succeeded,
      failed: state.failed,
      awaiting: state.awaiting,
      blocked: state.rejected,
      impactEngine: this.deps.impact.name,
      outcomesRecorded: recorded.length,
      outcomesTotal: this.deps.outcomes.all().length,
      outcomesAssessed: assessments.length,
      avgRoi,
      learningsTotal: this.deps.learnings.all().length,
      distributed: dist.published + dist.sent,
      growth,
      connectors,
      roles,
    };
  }

  /** Run the loop until stopped or maxTicks is reached. */
  async run(): Promise<TickSummary[]> {
    const summaries: TickSummary[] = [];
    let n = 0;
    while (!this.stopping) {
      n += 1;
      const summary = await this.tick(n);
      summaries.push(summary);
      this.deps.log(this.format(summary));

      if (this.maxTicks !== null && n >= this.maxTicks) break;
      if (this.stopping) break;

      await this.deps.sleep(this.intervalMs, this.controller.signal);
    }
    // Executive Report extension: the Business Impact Dashboard (primary decision
    // surface) plus the Distribution section (published/sent, campaigns, ROI).
    this.deps.log(renderDashboard(this.dashboard()));
    this.deps.log(renderDistributionSection(
      buildDistributionSection(this.deps.distributionQueue.all(), this.deps.distribution.metrics()),
    ));
    this.deps.log("TedOS loop stopped cleanly.");
    return summaries;
  }

  /**
   * The Business Impact Dashboard built from the outcome stores (Phase 5).
   * Exposed so an operator/report can render it on demand, not only at run end.
   */
  dashboard(now: () => Date = () => new Date()): BusinessImpactDashboard {
    return buildDashboard(this.deps.attributions, this.deps.learnings, now);
  }

  /** Request a clean stop: finish the current tick, wake any sleep, then exit. */
  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.controller.abort();
  }

  private format(s: TickSummary): string {
    const render = (r: Record<string, number>): string =>
      Object.entries(r)
        .map(([k, v]) => `${k}×${v}`)
        .join(", ") || "none";
    const g = s.growth;
    // Business-first: a tick's success is its contribution to pipeline & revenue.
    const business =
      `[tick ${s.tick}] BUSINESS IMPACT SCORE ${g.businessImpactScore} | ` +
      `revenue opportunities: ${g.revenueOpportunities} | new campaigns: ${g.newCampaigns} | ` +
      `sales emails prepared: ${g.salesEmails} | marketing assets: ${g.marketingAssets} | ` +
      `website improvements: ${g.websiteImprovements} | SEO opportunities: ${g.seoOpportunities} | ` +
      `content opportunities: ${g.contentOpportunities} | supplier opportunities: ${g.supplierOpportunities} | ` +
      `queued for approval: ${g.queuedForApproval} (credential-gated, not sent)`;
    const technical =
      `        ops: research ${s.submitted} · runtime ${s.processed} (done ${s.succeeded}, blocked ${s.blocked}) · ` +
      `learning +${s.outcomesRecorded} · outcome avgROI ${s.avgRoi} · distribution ${s.distributed} sent · ` +
      `impact ${s.impactEngine}`;
    return `${business}\n${technical}`;
  }
}

/** Options for assembling a loop; any omitted value falls back to env/defaults. */
export interface TedosLoopOptions {
  intervalMs?: number;
  maxTicks?: number | null;
  sleep?: SleepFn;
  log?: (message: string) => void;
  loadProviders?: () => Promise<ResearchProvider[]>;
  /** Project selection (name); falls back to env/CLI then the TedOS default. */
  project?: string;
}

/**
 * Build a fully-wired TedosLoop from the existing components.
 *
 * Providers default to loadResearchProviders, which is offline/mock unless
 * the real-provider env vars are set (Phase 1) — so the loop is deterministic
 * and offline by default.
 */
export function createTedosLoop(options: TedosLoopOptions = {}): TedosLoop {
  const storage = createStorage();
  // Learning store, shared so the FeedbackEngine reads back what it records.
  const outcomes = new OutcomeStore(storage);
  // Outcome & Business Impact stores, sharing the same Storage (Sprint A).
  const attributions = new AttributionStore(storage);
  const learnings = new OutcomeLearningStore(storage);
  // Distribution: ONE shared queue (reuses Storage + the kernel ApprovalGate)
  // and a credential-gated engine. No live `Transport` is wired here, so offline
  // every approved job is recorded `skipped` with setup instructions — nothing
  // is published or sent without credentials. Watchdogs enqueue into this queue.
  const distributionGate = new ApprovalGate(storage);
  const distributionQueue = new DistributionQueue(storage, distributionGate);
  const distributionAnalytics = new DistributionAnalyticsStore(storage);
  const distributionLearnings = new DistributionLearningStore(storage);
  const distribution = new DistributionEngine(
    distributionQueue,
    new PublisherRegistry(),
    distributionAnalytics,
    { learnings: distributionLearnings },
  );
  // Growth Engine: prepares the day's business deliverables into the shared queue.
  const growth = new GrowthEngine(distributionQueue, storage);
  // Resolve the project once: explicit option > CLI/env > TedOS default.
  const project = selectProject(options.project ?? readProjectSelection());
  return new TedosLoop({
    active: new ActiveProject(project),
    selected: project,
    policy: new RuleBasedPolicyEngine(),
    approvals: new ApprovalGate(storage),
    // Impact scoring is two stacked, deterministic decorators around the base
    // engine, both reading stores written on previous ticks (self-learning):
    //   FeedbackEngine       — adjusts by the goal's own EXECUTION history.
    //   OutcomeFeedbackEngine — adjusts by realized BUSINESS outcomes (per-area
    //                           movement, ROI, watchdog accuracy) in the same
    //                           business areas. No-op until live outcomes exist.
    impact: new OutcomeFeedbackEngine(
      new FeedbackEngine(new DeterministicImpactEngine(), outcomes),
      { attributions, learnings },
    ),
    priority: new PriorityEngine(),
    outcomes,
    attributions,
    learnings,
    outcomeEngine: new OutcomeEngine(),
    distributionQueue,
    distribution,
    growth,
    subagents: new SubAgentRouter(),
    connectors: new ConnectorRegistry(),
    loadProviders: options.loadProviders ?? loadResearchProviders,
    intervalMs: options.intervalMs ?? readIntervalMs(),
    maxTicks: options.maxTicks !== undefined ? options.maxTicks : readMaxTicks(),
    sleep: options.sleep ?? defaultSleep,
    log: options.log ?? ((m: string) => console.log(m)),
  });
}

/**
 * Install SIGINT/SIGTERM handlers that request a clean stop.
 * Returns an uninstaller so callers (and tests) can remove them.
 */
export function installSignalHandlers(loop: TedosLoop): () => void {
  const onSignal = (signal: string) => () => {
    console.log(`\nReceived ${signal} — finishing current tick, then exiting.`);
    loop.stop();
  };
  const sigint = onSignal("SIGINT");
  const sigterm = onSignal("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  return () => {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
  };
}

async function main(): Promise<void> {
  const loop = createTedosLoop();
  // Activate skill loading in the live execution path (reversible).
  const stopSkills = activateSkillLoading();
  const uninstall = installSignalHandlers(loop);
  const cap = loop.maxTicks !== null ? `, max ${loop.maxTicks} tick(s)` : "";
  console.log(
    `TedOS loop starting — project "${loop.selected.name}" (${loop.selected.repository}) ` +
      `at ${loop.selected.path} — interval ${loop.intervalMs}ms${cap}.`,
  );
  try {
    await loop.run();
  } finally {
    uninstall();
    stopSkills();
  }
}

// Run only when executed directly (tsx src/tedos-loop.ts), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
