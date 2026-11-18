// Distribution Queue — the ONE shared queue of approved distribution jobs.
//
// Every watchdog (Marketing, Sales, Growth, Customer Success, Content) enqueues
// into THIS queue — there are no per-watchdog queues. It reuses the existing
// persistence (`Storage`, like ApprovalQueue/OutcomeStore) and the existing
// approval source of truth (the kernel `ApprovalGate` that ApprovalQueue itself
// delegates to — no second approval system). A job is created `pending-approval`
// and may only be distributed after it is approved AND its connector has valid
// credentials. Nothing is ever published or sent from here; the Distribution
// Engine performs that, gated. Deterministic; clock injected.

import type { Storage } from "./storage.js";
import type { ApprovalGate } from "./approval-gate.js";

/** The channels a job can be distributed through. */
export type DistributionChannel = "linkedin" | "instagram" | "email" | "web";

/** The watchdogs that feed the queue (existing watchdogs — none new). */
export type DistributionSource = "marketing" | "sales" | "growth" | "customer-success" | "content";

/**
 * Job lifecycle:
 *   pending-approval → approved → (published | sent | skipped | failed)
 * `skipped` is the honest terminal state when credentials are missing — it
 * carries actionable setup instructions instead of fabricating a publish.
 */
export type DistributionJobStatus =
  | "pending-approval"
  | "approved"
  | "published"
  | "sent"
  | "skipped"
  | "failed";

/** One unit of distribution work (a post, an email, a web publish). */
export interface DistributionJob {
  id: string;
  source: DistributionSource;
  channel: DistributionChannel;
  /** Campaign grouping — the unit ROI/analytics aggregate over. */
  campaign: string;
  title: string;
  /** The content to distribute (Brand-Guardian-checked at distribution time). */
  body: string;
  /** Email/outreach only. */
  subject?: string;
  recipient?: string;
  /** The approved CTA carried for learning (which CTA converts). */
  cta?: string;
  status: DistributionJobStatus;
  createdAt: string;
  updatedAt: string;
  /** Why skipped/failed, or a setup hint — never a secret. */
  note?: string;
  /** External id returned by a connector after a real publish (when live). */
  externalId?: string;
}

/** What a caller provides on enqueue; status/timestamps are filled in. */
export type DistributionJobInput = Omit<DistributionJob, "status" | "createdAt" | "updatedAt" | "note" | "externalId">;

/** A terminal result the Distribution Engine writes back onto a job. */
export interface DistributionOutcome {
  status: Extract<DistributionJobStatus, "published" | "sent" | "skipped" | "failed">;
  note?: string;
  externalId?: string;
}

const KEY = "distribution-queue";

/** Aggregate counts for the Executive Report. */
export interface DistributionQueueStats {
  pendingApproval: number;
  approved: number;
  published: number;
  sent: number;
  skipped: number;
  failed: number;
  total: number;
}

export class DistributionQueue {
  private jobs: DistributionJob[];

  constructor(
    private readonly storage: Storage,
    /** Shared kernel approval gate (the same one ApprovalQueue syncs to). */
    private readonly gate?: ApprovalGate,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.jobs = storage.load<DistributionJob[]>(KEY) ?? [];
  }

  /** Every job, in insertion order. */
  all(): DistributionJob[] {
    return [...this.jobs];
  }

  get(id: string): DistributionJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  byStatus(status: DistributionJobStatus): DistributionJob[] {
    return this.jobs.filter((j) => j.status === status);
  }

  /**
   * Enqueue a distribution job (idempotent by id). It starts `pending-approval`
   * and requests approval through the shared kernel gate — so it surfaces in the
   * SAME approval flow as every other gated action. Never auto-distributed.
   */
  enqueue(input: DistributionJobInput): DistributionJob {
    const existing = this.jobs.find((j) => j.id === input.id);
    if (existing) return existing;
    const now = this.clock();
    const job: DistributionJob = { ...input, status: "pending-approval", createdAt: now, updatedAt: now };
    this.jobs.push(job);
    this.gate?.requestApproval(job.id, `Distribute ${job.channel} "${job.title}" (campaign ${job.campaign})`);
    this.persist();
    return job;
  }

  /**
   * Approve a job for distribution (syncs the shared gate). Only a
   * `pending-approval` job can be approved.
   */
  approve(id: string): void {
    const job = this.jobs.find((j) => j.id === id && j.status === "pending-approval");
    if (!job) return;
    job.status = "approved";
    job.updatedAt = this.clock();
    this.gate?.approve(id);
    this.persist();
  }

  /**
   * Jobs ready to distribute: approved AND (when a gate is present) actually
   * approved in the shared gate. This is the engine's work list.
   */
  readyToDistribute(): DistributionJob[] {
    return this.jobs.filter((j) => j.status === "approved" && (this.gate ? this.gate.isApproved(j.id) : true));
  }

  /** Write a terminal outcome from the Distribution Engine back onto a job. */
  recordOutcome(id: string, outcome: DistributionOutcome): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.status = outcome.status;
    if (outcome.note !== undefined) job.note = outcome.note;
    if (outcome.externalId !== undefined) job.externalId = outcome.externalId;
    job.updatedAt = this.clock();
    this.persist();
  }

  stats(): DistributionQueueStats {
    const count = (s: DistributionJobStatus): number => this.byStatus(s).length;
    return {
      pendingApproval: count("pending-approval"),
      approved: count("approved"),
      published: count("published"),
      sent: count("sent"),
      skipped: count("skipped"),
      failed: count("failed"),
      total: this.jobs.length,
    };
  }

  private persist(): void {
    this.storage.save(KEY, this.jobs);
  }
}
