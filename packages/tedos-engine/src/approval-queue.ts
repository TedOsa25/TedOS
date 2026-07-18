// Non-blocking Approval Queue for the Main Loop.
//
// A MEDIUM/HIGH goal must never stop a Main Loop iteration — it is deferred
// here and the loop continues with the next LOW goal. This EXTENDS the existing
// approval mechanism rather than duplicating it: it persists through the same
// Storage layer (like OutcomeStore / ApprovalGate) and delegates the
// approved/awaiting bookkeeping to the kernel ApprovalGate, adding the richer
// metadata + status lifecycle the Main Loop needs. No second approval system.

import type { Storage } from "./storage.js";
import type { ApprovalGate } from "./approval-gate.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "implemented";

/** One deferred MEDIUM/HIGH goal awaiting a human decision. */
export interface ApprovalEntry {
  goalId: string;
  title: string;
  description: string;
  businessImpact: number;
  revenueImpact: number;
  customerValue: number;
  risk: "MEDIUM" | "HIGH";
  priorityScore: number;
  files: string[];
  estimatedEffort: string;
  createdAt: string;
  status: ApprovalStatus;
  /** Set when approved/rejected — used for average approval duration. */
  decidedAt?: string;
  recommendation?: "approve" | "reject";
}

/** What a caller provides on enqueue (status/createdAt are filled in). */
export type ApprovalInput = Omit<ApprovalEntry, "status" | "createdAt" | "decidedAt">;

const KEY = "approval-queue";

/** Aggregate metrics that feed the Executive Report. */
export interface ApprovalStats {
  openApprovals: number;
  avgBusinessImpactPending: number;
  avgApprovalDurationMs: number | null;
  totalDecided: number;
}

export class ApprovalQueue {
  private entries: ApprovalEntry[];

  constructor(
    private readonly storage: Storage,
    /** Kernel gate kept in sync (reused, not duplicated). Optional for tests. */
    private readonly gate?: ApprovalGate,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.entries = storage.load<ApprovalEntry[]>(KEY) ?? [];
  }

  /** Every entry, in insertion order. */
  all(): ApprovalEntry[] {
    return [...this.entries];
  }

  byStatus(status: ApprovalStatus): ApprovalEntry[] {
    return this.entries.filter((e) => e.status === status);
  }

  /** Entries still awaiting a decision. */
  pending(): ApprovalEntry[] {
    return this.byStatus("pending");
  }

  /**
   * Defer a goal for approval (idempotent by goalId while pending). Also records
   * it in the kernel ApprovalGate so the existing awaiting/approved state stays
   * the single source of truth for execution gating.
   */
  enqueue(input: ApprovalInput): ApprovalEntry {
    const existing = this.entries.find((e) => e.goalId === input.goalId && e.status === "pending");
    if (existing) return existing;
    const entry: ApprovalEntry = { ...input, status: "pending", createdAt: this.clock() };
    this.entries.push(entry);
    this.gate?.requestApproval(input.goalId, `${input.title} (${input.risk}, ROI ${input.priorityScore})`);
    this.persist();
    return entry;
  }

  /** Approve a pending goal (syncs the kernel gate). */
  approve(goalId: string): void {
    this.decide(goalId, "approved");
    this.gate?.approve(goalId);
  }

  reject(goalId: string): void {
    this.decide(goalId, "rejected");
  }

  expire(goalId: string): void {
    this.decide(goalId, "expired");
  }

  /** Mark an approved goal as shipped. */
  markImplemented(goalId: string): void {
    const entry = this.entries.find((e) => e.goalId === goalId);
    if (!entry) return;
    entry.status = "implemented";
    this.persist();
  }

  private decide(goalId: string, status: Extract<ApprovalStatus, "approved" | "rejected" | "expired">): void {
    const entry = this.entries.find((e) => e.goalId === goalId && e.status === "pending");
    if (!entry) return;
    entry.status = status;
    entry.decidedAt = this.clock();
    this.persist();
  }

  /**
   * A single collected report of all pending approvals (never several separate
   * prompts), ordered by priority score (highest first).
   */
  report(): string {
    const pending = [...this.pending()].sort((a, b) => b.priorityScore - a.priorityScore);
    if (pending.length === 0) return "No open approvals.";
    const lines = pending.map((e, i) =>
      `${i + 1}. ${e.title}\n   ROI ${e.priorityScore} · Risk ${e.risk} · Recommendation ${e.recommendation ?? "review"}`,
    );
    return `${pending.length} open approval(s)\n\n${lines.join("\n\n")}`;
  }

  /** Metrics for Learning / the Executive Report. */
  stats(): ApprovalStats {
    const pending = this.pending();
    const decided = this.entries.filter((e) => e.decidedAt);
    const durations = decided.map((e) => Date.parse(e.decidedAt as string) - Date.parse(e.createdAt));
    const avgDuration = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
    const avgImpact = pending.length
      ? pending.reduce((a, e) => a + e.businessImpact, 0) / pending.length
      : 0;
    return {
      openApprovals: pending.length,
      avgBusinessImpactPending: Number(avgImpact.toFixed(2)),
      avgApprovalDurationMs: avgDuration,
      totalDecided: decided.length,
    };
  }

  private persist(): void {
    this.storage.save(KEY, this.entries);
  }
}
