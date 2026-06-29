// Outcome Engine — after each completed implementation, measure whether it
// actually moved the business, compute ROI, and record the learning.
//
// It is the orchestrator that ties the existing pieces together:
//   Goal Attribution (goal-attribution.ts) — commit, files, areas, expected value
//   Business Impact   (business-impact.ts)  — six-area, Evidence-tagged metrics
//   Learning Engine   (learning.ts)         — store the classified learning
//
// It adds no kernel seam: it reads the GoalExecution the Runtime already
// produces and the impact score the pipeline already computes. Deterministic;
// when no live data source is configured the honest answer is "kein
// nachweisbarer Business Impact" (verdict no-measurable-impact), never a guess.

import type { GoalExecution } from "./trace.js";
import type { ScoredGoal } from "./impact.js";
import type { OutcomeLearning, OutcomeClassification } from "./learning.js";
import {
  type GoalAttribution,
  attributeExecution,
} from "./goal-attribution.js";
import {
  type MetricReading,
  type SampleProvider,
  type Verdict,
  aggregateImpact,
  computeRoi,
  impactByArea,
  readMetrics,
} from "./business-impact.js";

/** The full result of measuring one implemented goal. */
export interface OutcomeAssessment {
  attribution: GoalAttribution;
  readings: MetricReading[];
  learning: OutcomeLearning;
}

/** Per-goal inputs the engine can't derive from the execution alone. */
export interface AnalyzeOptions {
  env?: NodeJS.ProcessEnv;
  /** Live metric samples for this goal (only used where the source is live). */
  samples?: SampleProvider;
  /** The watchdog/source that proposed the goal, for watchdog-accuracy learning. */
  source?: string;
}

/** A completed implementation is one the Runtime ran AND the Reviewer approved. */
export function isImplemented(exec: GoalExecution): boolean {
  return exec.status === "done" && exec.review.approved;
}

/** Map a verdict to the coarse learning bucket (no-measurable-impact ⇒ neutral). */
function classify(verdict: Verdict): OutcomeClassification {
  if (verdict === "successful") return "successful";
  if (verdict === "negative") return "negative";
  return "neutral";
}

/** A deterministic, human-readable reason for the learning. */
function explain(verdict: Verdict, actualImpact: number, liveCount: number): string {
  switch (verdict) {
    case "successful":
      return `Confirmed business impact (+${actualImpact}% avg across ${liveCount} live metric(s)); hypothesis held.`;
    case "negative":
      return `Negative business impact (${actualImpact}% avg across ${liveCount} live metric(s)); the hypothesis was wrong — revisit.`;
    case "neutral":
      return `No significant movement (~${actualImpact}% across ${liveCount} live metric(s)); marginal effect.`;
    case "no-measurable-impact":
      return "Kein nachweisbarer Business Impact — no live data source for the affected areas (see docs/connectors-setup.md).";
  }
}

/** Was the proposing source's recommendation borne out? null when unknowable. */
function watchdogAccurate(verdict: Verdict, source: string): boolean | null {
  if (source === "unknown") return null;
  if (verdict === "successful") return true;
  if (verdict === "negative") return false;
  return null; // neutral / no-measurable-impact: can't credit or blame the source
}

/**
 * OutcomeEngine measures one implemented goal at a time, deterministically.
 * The clock is injected so tests/the demo are reproducible.
 */
export class OutcomeEngine {
  constructor(private readonly clock: () => string = () => new Date().toISOString()) {}

  /** Measure a single implemented goal against the six business areas. */
  analyze(exec: GoalExecution, scored: ScoredGoal, opts: AnalyzeOptions = {}): OutcomeAssessment {
    const env = opts.env ?? process.env;
    const source = opts.source ?? "unknown";

    const base = attributeExecution(exec, scored, this.clock);
    // Empty productAreas ⇒ measure broadly across all areas (readMetrics handles it).
    const readings = readMetrics(base.productAreas, opts.samples, env, this.clock);
    const agg = aggregateImpact(readings);
    const roi = computeRoi(base.expectedImpact, agg.actualImpact);

    const attribution: GoalAttribution = {
      ...base,
      actualImpact: agg.actualImpact,
      roi,
      confidence: agg.confidence,
      verdict: agg.verdict,
      areaImpacts: impactByArea(readings),
    };

    const learning: OutcomeLearning = {
      goalId: exec.id,
      verdict: agg.verdict,
      classification: classify(agg.verdict),
      roi,
      confidence: agg.confidence,
      reason: explain(agg.verdict, agg.actualImpact, agg.liveCount),
      source,
      watchdogAccurate: watchdogAccurate(agg.verdict, source),
      timestamp: this.clock(),
    };

    return { attribution, readings, learning };
  }

  /**
   * Measure every implemented goal from a run. `scoredById` supplies each goal's
   * impact score; `sourcesById` (optional) the proposing watchdog. Executions
   * with no matching score, or that weren't implemented, are skipped.
   */
  analyzeRun(
    executions: readonly GoalExecution[],
    scoredById: ReadonlyMap<string, ScoredGoal>,
    opts: AnalyzeOptions & { sourcesById?: ReadonlyMap<string, string> } = {},
  ): OutcomeAssessment[] {
    const { sourcesById, ...base } = opts;
    const assessments: OutcomeAssessment[] = [];
    for (const exec of executions) {
      if (!isImplemented(exec)) continue;
      const scored = scoredById.get(exec.id);
      if (!scored) continue;
      const source = sourcesById?.get(exec.id) ?? base.source;
      const perGoal: AnalyzeOptions = source !== undefined ? { ...base, source } : base;
      assessments.push(this.analyze(exec, scored, perGoal));
    }
    return assessments;
  }
}
