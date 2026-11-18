// Durable state for HeyAudit Sales.
//
// One restricted directory (0700) outside git. Every collection is one JSON
// file written via tmp + rename (atomic on the same filesystem). A directory
// lock with owner pid guards against parallel runs; a lock whose owner process
// is gone (crash, SIGKILL, reboot) is taken over, a live one makes the second
// run exit cleanly ("busy"), which the scheduler logs as skipped — never as a
// double action.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SalesEvent } from "./model.js";

export type TaskType =
  | "demo_briefing"    // internal: prepare the booked demo
  | "callback"         // Ted calls the lead
  | "reply_draft"      // answer draft (external → approval)
  | "rebook"           // booking canceled → offer a new slot
  | "outcome_capture"  // demo is over → record result once
  | "followup_draft"   // after demo: next step draft (external → approval)
  | "review_reply";    // a human answered → Ted reads it

export type TaskStatus = "open" | "done" | "superseded" | "canceled";

export interface SalesTask {
  /** Stable action id — the dedupe key. Re-deriving the same situation yields the same id. */
  id: string;
  account: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  due: string;
  /** Lower = earlier. Derived from intent, urgency and fit. */
  priority: number;
  contactEmail?: string;
  contactPhone?: string;
  /** Internal brief / draft body (data for Ted, never auto-sent). */
  body?: string;
  /** Prompt/template version that produced body. */
  bodyVersion?: string;
  /** Goal id in the shared ApprovalQueue when the task carries an external draft. */
  approvalGoalId?: string;
  closedReason?: string;
  overCapacity?: boolean;
}

export interface JobState {
  name: string;
  paused: boolean;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastDurationMs?: number;
  lastResult?: string;
  lastError?: string;
  consecutiveFailures: number;
  nextRetryAt?: string;
  deadLetter?: { at: string; error: string; attempts: number };
  /** Last schedule slot (Berlin, "YYYY-MM-DDTHH:MM") that was executed — catch-up key. */
  lastSlot?: string;
}

export interface RunRecord {
  job: string;
  runId: string;
  startedAt: string;
  durationMs: number;
  outcome: "ok" | "error" | "skipped" | "dead_letter";
  result?: string;
  error?: string;
  trigger: "schedule" | "event" | "manual" | "retry";
}

export interface ResearchTarget {
  id: string;            // places:<id>
  company: string;
  website?: string;
  sourceUrl: string;
  query: string;
  signal: string;
  fitReason: string;
  assumptions: string[];
  foundAt: string;
  status: "neu" | "dublette" | "gesperrt" | "ausgeschlossen";
  reviewed?: { at: string; verdict: string };
}

export class LockBusyError extends Error {
  constructor(public readonly owner: string) {
    super(`Sales-Lauf läuft bereits (${owner})`);
  }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export class SalesStore {
  constructor(public readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // ── atomic json ────────────────────────────────────────────────────────
  read<T>(name: string, fallback: T): T {
    const p = join(this.dir, name);
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  }

  write(name: string, value: unknown): void {
    const p = join(this.dir, name);
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, p);
  }

  append(name: string, line: unknown): void {
    appendFileSync(join(this.dir, name), JSON.stringify(line) + "\n", { mode: 0o600 });
  }

  readLines<T>(name: string): T[] {
    const p = join(this.dir, name);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
  }

  // ── lock ───────────────────────────────────────────────────────────────
  /** Run fn under the directory lock. Throws LockBusyError if a live run holds it. */
  withLock<T>(fn: () => T): T;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  withLock<T>(fn: () => T | Promise<T>): T | Promise<T> {
    const lock = join(this.dir, "run.lock");
    const owner = join(lock, "owner.json");
    try {
      mkdirSync(lock);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let info: { pid?: number; startedAt?: string } = {};
      try { info = JSON.parse(readFileSync(owner, "utf8")); } catch { /* half-written owner */ }
      const age = info.startedAt ? Date.now() - Date.parse(info.startedAt) : Infinity;
      const alive = typeof info.pid === "number" && pidAlive(info.pid);
      if (alive && age < 30 * 60_000) throw new LockBusyError(`pid ${info.pid} seit ${info.startedAt}`);
      // Stale: owner gone or hung > 30 min. Take over atomically via rename.
      const stale = `${lock}.stale-${Date.now()}`;
      try { renameSync(lock, stale); rmSync(stale, { recursive: true, force: true }); } catch { /* raced */ }
      mkdirSync(lock); // throws EEXIST if another run won the race → caller sees error
    }
    writeFileSync(owner, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const release = () => rmSync(lock, { recursive: true, force: true });
    try {
      const out = fn();
      if (out instanceof Promise) return out.finally(release);
      release();
      return out;
    } catch (e) {
      release();
      throw e;
    }
  }

  // ── collections ────────────────────────────────────────────────────────
  events(): Record<string, SalesEvent & { seenAt: string }> {
    return this.read("events.json", {});
  }

  /**
   * Add events idempotently. Same id + same content = no-op. Same id with
   * different content: a later observation of the same fact (e.g. a webhook
   * retry with an extra field) is merged field-wise, never overwriting a
   * known value — so a late or repeated delivery cannot flip history.
   */
  addEvents(incoming: SalesEvent[], now = new Date().toISOString()): { added: number; merged: number; duplicate: number } {
    const all = this.events();
    let added = 0, merged = 0, duplicate = 0;
    for (const e of incoming) {
      const prev = all[e.id];
      if (!prev) { all[e.id] = { ...e, seenAt: now }; added++; continue; }
      let changed = false;
      for (const [k, v] of Object.entries(e)) {
        if (v !== undefined && (prev as unknown as Record<string, unknown>)[k] === undefined) {
          (prev as unknown as Record<string, unknown>)[k] = v; changed = true;
        }
      }
      if (changed) merged++; else duplicate++;
    }
    this.write("events.json", all);
    return { added, merged, duplicate };
  }

  tasks(): Record<string, SalesTask> {
    return this.read("tasks.json", {});
  }

  saveTasks(t: Record<string, SalesTask>): void {
    this.write("tasks.json", t);
  }

  jobs(): Record<string, JobState> {
    return this.read("jobs.json", {});
  }

  saveJobs(j: Record<string, JobState>): void {
    this.write("jobs.json", j);
  }

  research(): Record<string, ResearchTarget> {
    return this.read("research.json", {});
  }

  saveResearch(r: Record<string, ResearchTarget>): void {
    this.write("research.json", r);
  }

  runs(): RunRecord[] {
    return this.readLines<RunRecord>("runs.jsonl");
  }

  /** Global kill switch: file PAUSE in the state dir stops every job. */
  globallyPaused(): boolean {
    return existsSync(join(this.dir, "PAUSE"));
  }
}
