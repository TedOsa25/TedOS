// Shared sales scheduler (Europe/Berlin).
//
// One launchd entry fires `tick` every 5 minutes. The tick decides which jobs
// are due: interval jobs (inbound polling, due-task check, monitoring) and
// calendar jobs (research, daily brief, weekly report, acquisition) keyed by a
// Berlin wall-clock slot. A missed slot (Mac asleep) is caught up ONCE within
// 12 h; the executed slot is persisted so a restart never repeats it.
// Failures retry with exponential backoff; after MAX_ATTEMPTS the job goes to
// the dead-letter state and stays visible until `sales -- reset <job>`.

import { randomUUID } from "node:crypto";
import { berlinParts } from "./model.js";
import type { JobState, RunRecord, SalesStore } from "./store.js";

export const MAX_ATTEMPTS = 5;

export type Schedule =
  | { every: number }                                  // minutes
  | { at: { hour: number; minute: number }; days: number[] }; // Berlin weekdays 1..7

export interface JobDef {
  name: string;
  schedule: Schedule;
  run: (ctx: { now: Date; trigger: RunRecord["trigger"] }) => Promise<string>;
}

/** Latest Berlin slot ≤ now for a calendar schedule, as "YYYY-MM-DDTHH:MM" + its Date. */
export function latestSlot(s: Extract<Schedule, { at: unknown }>, now: Date): { key: string; at: Date } | undefined {
  for (let back = 0; back < 8; back++) {
    const probe = new Date(now.getTime() - back * 86400000);
    const p = berlinParts(probe);
    if (!s.days.includes(p.weekday)) continue;
    // Berlin wall time → instant: start from the probe day and adjust by the hour/min delta.
    const deltaMin = (s.at.hour - p.hour) * 60 + (s.at.minute - p.minute);
    const at = new Date(probe.getTime() + deltaMin * 60_000);
    at.setUTCSeconds(0, 0);
    if (at.getTime() > now.getTime()) continue;
    const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(s.at.hour).padStart(2, "0")}:${String(s.at.minute).padStart(2, "0")}`;
    return { key, at };
  }
  return undefined;
}

export function isDue(def: JobDef, st: JobState | undefined, now: Date): { due: boolean; slot?: string; why: string } {
  if (st?.paused) return { due: false, why: "pausiert" };
  if (st?.deadLetter) return { due: false, why: "dead-letter" };
  if (st?.nextRetryAt && Date.parse(st.nextRetryAt) > now.getTime()) return { due: false, why: "wartet auf Retry" };
  if (st?.nextRetryAt) {
    const s = "at" in def.schedule ? latestSlot(def.schedule, now) : undefined;
    return { due: true, why: "retry", ...(s ? { slot: s.key } : {}) };
  }
  if ("every" in def.schedule) {
    const last = st?.lastRunAt ? Date.parse(st.lastRunAt) : 0;
    return { due: now.getTime() - last >= def.schedule.every * 60_000 - 30_000, why: "intervall" };
  }
  const slot = latestSlot(def.schedule, now);
  if (!slot) return { due: false, why: "kein Slot" };
  if (st?.lastSlot && st.lastSlot >= slot.key) return { due: false, why: "Slot erledigt" };
  if (now.getTime() - slot.at.getTime() > 12 * 3_600_000) return { due: false, slot: slot.key, why: "Slot verpasst (>12 h)" };
  return { due: true, slot: slot.key, why: "zeitplan" };
}

/** Run one job with bookkeeping. Never throws. */
export async function runJob(store: SalesStore, def: JobDef, now: Date, trigger: RunRecord["trigger"], slot?: string): Promise<RunRecord> {
  const jobs = store.jobs();
  const st: JobState = jobs[def.name] ?? { name: def.name, paused: false, consecutiveFailures: 0 };
  const runId = randomUUID();
  const t0 = Date.now();
  let rec: RunRecord;
  try {
    const result = await def.run({ now, trigger });
    rec = { job: def.name, runId, startedAt: now.toISOString(), durationMs: Date.now() - t0, outcome: "ok", result, trigger };
    st.lastSuccessAt = new Date().toISOString();
    st.lastResult = result;
    st.consecutiveFailures = 0;
    delete st.nextRetryAt;
    delete st.lastError;
    if (slot) st.lastSlot = slot;
  } catch (e) {
    const msg = ((e as Error).message ?? String(e)).replace(/(pass|token|key)=\S+/gi, "$1=***").slice(0, 500);
    st.consecutiveFailures++;
    st.lastError = msg;
    if (st.consecutiveFailures >= MAX_ATTEMPTS) {
      st.deadLetter = { at: new Date().toISOString(), error: msg, attempts: st.consecutiveFailures };
      delete st.nextRetryAt;
      if (slot) st.lastSlot = slot; // don't re-fire this slot after reset
      rec = { job: def.name, runId, startedAt: now.toISOString(), durationMs: Date.now() - t0, outcome: "dead_letter", error: msg, trigger };
    } else {
      const backoffMin = Math.min(120, 5 * 2 ** (st.consecutiveFailures - 1));
      st.nextRetryAt = new Date(Date.now() + backoffMin * 60_000).toISOString();
      rec = { job: def.name, runId, startedAt: now.toISOString(), durationMs: Date.now() - t0, outcome: "error", error: msg, trigger };
    }
  }
  st.lastRunAt = now.toISOString();
  st.lastDurationMs = rec.durationMs;
  const fresh = store.jobs();
  fresh[def.name] = { ...st, paused: fresh[def.name]?.paused ?? st.paused };
  store.saveJobs(fresh);
  store.append("runs.jsonl", rec);
  return rec;
}

export async function tick(store: SalesStore, defs: JobDef[], now: Date, only?: string): Promise<RunRecord[]> {
  if (store.globallyPaused()) {
    const r: RunRecord = { job: "*", runId: randomUUID(), startedAt: now.toISOString(), durationMs: 0, outcome: "skipped", result: "global pausiert (PAUSE-Datei)", trigger: "schedule" };
    store.append("runs.jsonl", r);
    return [r];
  }
  const out: RunRecord[] = [];
  for (const def of defs) {
    if (only && def.name !== only) continue;
    const st = store.jobs()[def.name];
    const d = only ? { due: !st?.paused, why: "manuell" } as { due: boolean; slot?: string; why: string } : isDue(def, st, now);
    if (!d.due) continue;
    const trigger: RunRecord["trigger"] = only ? "manual" : d.why === "retry" ? "retry" : "schedule";
    out.push(await runJob(store, def, now, trigger, d.slot));
  }
  return out;
}

export function setPaused(store: SalesStore, job: string, paused: boolean): void {
  const jobs = store.jobs();
  jobs[job] = { ...(jobs[job] ?? { name: job, consecutiveFailures: 0 }), paused } as JobState;
  store.saveJobs(jobs);
}

export function resetJob(store: SalesStore, job: string): void {
  const jobs = store.jobs();
  const st = jobs[job];
  if (!st) return;
  delete st.deadLetter;
  delete st.nextRetryAt;
  st.consecutiveFailures = 0;
  store.saveJobs(jobs);
}
