// Revenue Center export — the data bridge to the HeyCarbo UI.
//
// Flattens the engine's prepared RevenueOpportunities into a JSON the Revenue
// Center page reads. Adds the approval `status` lifecycle. The UI never sends:
// it only moves status (draft → pending approval → approved → ready to send →
// sent), and real sending stays credential-gated in the engine's queue.

import type { RevenueOpportunity, RevenueCenter } from "./revenue-engine.js";
import { templateMeta } from "./email-template.js";

/** The approval lifecycle a prepared artifact moves through (manual only). */
export type RevenueStatus =
  | "draft" | "pending approval" | "approved" | "ready to send" | "sent";

/** A prepared opportunity plus its current approval status. */
export interface ExportedOpportunity extends RevenueOpportunity {
  status: RevenueStatus;
}

/** The full export the Revenue Center UI consumes. */
export interface RevenueCenterExport {
  generatedAt: string;
  summary: RevenueCenter;
  /** Central template assets (banner, signature, Calendly, brand colour). */
  template: ReturnType<typeof templateMeta>;
  accounts: ExportedOpportunity[];
}

/**
 * Build the export. Quality-passed, prepared artifacts start as
 * "pending approval" — ready for Ted to review and approve. Nothing is sent.
 */
export function buildRevenueExport(
  summary: RevenueCenter,
  opportunities: RevenueOpportunity[],
  now: string,
): RevenueCenterExport {
  return {
    generatedAt: now,
    summary,
    template: templateMeta(),
    accounts: opportunities.map((o) => ({ ...o, status: "pending approval" as const })),
  };
}
