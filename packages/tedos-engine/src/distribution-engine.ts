// Distribution Engine — the executor that turns approved jobs into (gated)
// publications. It wires the EXISTING pieces and owns no new policy:
//
//   readyToDistribute() ─▶ Brand Guardian (brand-guardian.ts) ─▶ Publisher
//   (distribution-connectors.ts, credential+transport gated) ─▶ record outcome
//   on the shared DistributionQueue ─▶ capture metrics + refresh learnings
//   (distribution-analytics.ts).
//
// It distributes ONLY approved jobs; without credentials/transport a job is
// recorded `skipped` with concrete setup instructions (no publish, no fabricated
// metric). Deterministic; env/clock/metrics injected.

import { checkContent } from "./brand-guardian.js";
import type { DistributionQueue, DistributionJob } from "./distribution-queue.js";
import type { PublisherRegistry } from "./distribution-connectors.js";
import {
  type MetricsProvider,
  type DistributionMetrics,
  DistributionAnalyticsStore,
  DistributionLearningStore,
  captureMetrics,
  learnFromMetrics,
} from "./distribution-analytics.js";

/** Per-job outcome of a distribution run. */
export interface JobResult {
  jobId: string;
  channel: DistributionJob["channel"];
  status: "published" | "sent" | "skipped" | "failed";
  detail: string;
}

/** Aggregate result of distributing one batch of approved jobs. */
export interface DistributionRunResult {
  attempted: number;
  published: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Jobs stopped by the Brand Guardian (counted within `failed`). */
  blocked: number;
  results: JobResult[];
}

export interface DistributionEngineOptions {
  env?: NodeJS.ProcessEnv;
  clock?: () => string;
  /** Live metrics source; absent → metrics are zero/low-confidence (no fabrication). */
  metrics?: MetricsProvider;
  /** Run the Brand Guardian gate before publishing (default true). */
  brandGuard?: boolean;
  /** When provided, learnings are refreshed from all metrics after the run. */
  learnings?: DistributionLearningStore;
}

export class DistributionEngine {
  constructor(
    private readonly queue: DistributionQueue,
    private readonly publishers: PublisherRegistry,
    private readonly analytics: DistributionAnalyticsStore,
    private readonly opts: DistributionEngineOptions = {},
  ) {}

  /** Distribute every approved job once, gated. Safe to call repeatedly. */
  run(): DistributionRunResult {
    const env = this.opts.env ?? process.env;
    const clock = this.opts.clock ?? (() => new Date().toISOString());
    const brandGuard = this.opts.brandGuard !== false;
    const res: DistributionRunResult = { attempted: 0, published: 0, sent: 0, skipped: 0, failed: 0, blocked: 0, results: [] };

    for (const job of this.queue.readyToDistribute()) {
      res.attempted += 1;

      // Brand Guardian gate (reused) — a blocking issue stops the publish.
      if (brandGuard) {
        const check = checkContent(job.body);
        if (!check.ok) {
          const detail = `brand-block: ${check.issues.filter((i) => i.severity === "block").map((i) => i.detail).join("; ")}`;
          this.queue.recordOutcome(job.id, { status: "failed", note: detail });
          res.failed += 1;
          res.blocked += 1;
          res.results.push({ jobId: job.id, channel: job.channel, status: "failed", detail });
          continue;
        }
      }

      const publisher = this.publishers.get(job.channel);
      if (!publisher) {
        const detail = `no publisher for channel ${job.channel}`;
        this.queue.recordOutcome(job.id, { status: "failed", note: detail });
        res.failed += 1;
        res.results.push({ jobId: job.id, channel: job.channel, status: "failed", detail });
        continue;
      }

      const pub = publisher.publish(job, env);
      const note = pub.setupHint ? `${pub.detail} — ${pub.setupHint}` : pub.detail;
      this.queue.recordOutcome(job.id, {
        status: pub.status,
        note,
        ...(pub.externalId !== undefined ? { externalId: pub.externalId } : {}),
      });
      res.results.push({ jobId: job.id, channel: job.channel, status: pub.status, detail: note });

      if (pub.status === "published" || pub.status === "sent") {
        const updated = this.queue.get(job.id) ?? job;
        this.analytics.record(captureMetrics(updated, this.opts.metrics, clock));
        if (pub.status === "published") res.published += 1;
        else res.sent += 1;
      } else if (pub.status === "skipped") {
        res.skipped += 1;
      } else {
        res.failed += 1;
      }
    }

    // Refresh distribution learnings from the full metric history (reused store).
    if (this.opts.learnings) {
      this.opts.learnings.replace(learnFromMetrics(this.analytics.all(), this.queue.all()));
    }

    return res;
  }

  /** All metrics captured so far (for the Executive Report). */
  metrics(): DistributionMetrics[] {
    return this.analytics.all();
  }
}
