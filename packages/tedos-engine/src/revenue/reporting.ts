// Revenue reporting — lead lifecycle counts + opt-out KPIs for the Revenue Center.
//
// Reads the persisted lead-status store (batch-send.ts) and aggregates it. Pure,
// synchronous, no side effects — safe to call anytime.

import type { Storage } from "./../storage.js";
import type { Variant } from "./email-copy.js";
import { LEAD_LIFECYCLE, loadLeadStatus, type LeadStatus, type LeadRecord } from "./batch-send.js";

/** Count of leads in each lifecycle status (Active … Unsubscribed), display order. */
export function lifecycleCounts(storage: Storage): Record<LeadStatus, number> {
  const counts = Object.fromEntries(LEAD_LIFECYCLE.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const rec of Object.values(loadLeadStatus(storage))) {
    if (rec.status in counts) counts[rec.status] += 1;
  }
  return counts;
}

/** Opt-out KPIs — overall rate + breakdowns by campaign, industry and variant. */
export interface OptOutReport {
  /** Leads that were actually dispatched at least once (denominator). */
  contacted: number;
  /** Leads currently opted out. */
  unsubscribed: number;
  /** unsubscribed / contacted, rounded to 2 decimals (0 when nobody contacted). */
  optOutRate: number;
  byCampaign: Record<string, number>;
  byIndustry: Record<string, number>;
  byVariant: Record<string, number>;
}

const bump = (m: Record<string, number>, k: string | undefined): void => {
  const key = k && k.trim() ? k : "unbekannt";
  m[key] = (m[key] ?? 0) + 1;
};

/** Aggregate opt-out KPIs from the lead store. */
export function optOutReport(storage: Storage): OptOutReport {
  const recs = Object.values(loadLeadStatus(storage));
  // "Contacted" = ever dispatched (has a send timestamp), regardless of later status.
  const contacted = recs.filter((r) => !!r.sent_at).length;
  const unsub = recs.filter((r) => r.status === "unsubscribed");
  const byCampaign: Record<string, number> = {};
  const byIndustry: Record<string, number> = {};
  const byVariant: Record<string, number> = {};
  for (const r of unsub) {
    bump(byCampaign, r.campaign);
    bump(byIndustry, r.industry);
    bump(byVariant, r.variant as Variant | undefined);
  }
  const optOutRate = contacted > 0 ? Math.round((unsub.length / contacted) * 10000) / 100 : 0;
  return { contacted, unsubscribed: unsub.length, optOutRate, byCampaign, byIndustry, byVariant };
}

/** One-screen text summary of lifecycle + opt-out KPIs. */
export function formatOptOutReport(storage: Storage): string {
  const life = lifecycleCounts(storage);
  const r = optOutReport(storage);
  const L: string[] = [];
  L.push("── Lead-Lifecycle ─────────────────────────────────────────");
  L.push(LEAD_LIFECYCLE.map((s) => `${s}: ${life[s]}`).join(" · "));
  L.push("── Opt-out KPIs ───────────────────────────────────────────");
  L.push(`Kontaktiert          : ${r.contacted}`);
  L.push(`Abmeldungen          : ${r.unsubscribed}`);
  L.push(`Opt-out-Rate         : ${r.optOutRate} %`);
  L.push(`pro Kampagne         : ${fmt(r.byCampaign)}`);
  L.push(`pro Branche          : ${fmt(r.byIndustry)}`);
  L.push(`pro Variante (A–E)   : ${fmt(r.byVariant)}`);
  L.push("───────────────────────────────────────────────────────────");
  return L.join("\n");
}

const fmt = (m: Record<string, number>): string => {
  const e = Object.entries(m);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(" · ") : "—";
};

export type { LeadRecord };
