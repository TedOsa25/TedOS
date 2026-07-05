// Productive BATCH SEND for the Revenue Engine — gated, capped, self-disarming.
//
// sendApprovedBatch() takes the next leads whose stored status is "approved",
// renders each personalized email via the existing Revenue Engine (variant E by
// default), dispatches through the configured provider, records the outcome per
// lead (sent_at / provider / messageId / smtpStatus / error), flips the lead to
// "sent", and returns a send report.
//
// SAFETY — the same disarmed-by-default philosophy as the sending layer:
//   • Nothing sends unless REVENUE_SEND_ENABLED=1 (isSendArmed) AND a real
//     provider is configured. Otherwise every dispatch is a dry-run "skipped".
//   • Only leads EXPLICITLY marked "approved" are eligible — nothing is approved
//     by default, so a fresh store sends to nobody.
//   • Hard cap: batch 1 can never exceed FIRST_BATCH_HARD_CAP (20), regardless
//     of the requested batchSize. The loop stops after exactly that many.
//   • BCC to ted@heycarbo.com is applied to batch 1 ONLY (blind — hidden from
//     the recipient). Batches 2+ carry no BCC by default.
//   • After the batch the master switch is auto-disarmed in-process
//     (REVENUE_SEND_ENABLED=0) so no second wave can start implicitly.
//   • dryRun:true builds + reports everything but dispatches nothing real.

import type { Storage } from "./../storage.js";
import { type Account, loadAccounts, prioritize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";
import { unsubscribeToken, unsubscribeUrl } from "./email-template.js";
import { type Variant, DEFAULT_VARIANT } from "./email-copy.js";
import {
  dispatch, getProvider, isSendArmed, selectedProviderName,
  type EmailProvider, type OutboundEmail, type ProviderName, type SendStatus,
} from "./sending.js";

/** BCC target for the first productive batch only (hidden from the recipient). */
export const BCC_FIRST_BATCH = process.env.REVENUE_BCC_FIRST_BATCH ?? "ted@heycarbo.com";
/** Absolute ceiling for batch 1 — the loop can never send more than this. */
export const FIRST_BATCH_HARD_CAP = 20;
/** Default batch size. */
export const DEFAULT_BATCH_SIZE = 20;

/** Sender identity (env-overridable, defaults to the HeyCarbo owner). */
const SENDER = {
  email: process.env.REVENUE_FROM_EMAIL ?? "ted@heycarbo.com",
  name: process.env.REVENUE_FROM_NAME ?? "Ted Osammor",
} as const;

/** Full lead lifecycle shown in the Revenue Center. */
export type LeadStatus =
  | "active" | "pending" | "approved" | "sent" | "replied"
  | "bounced" | "demo-booked" | "won" | "lost" | "unsubscribed";

/** All lifecycle statuses, in display order (for the Revenue Center). */
export const LEAD_LIFECYCLE: LeadStatus[] = [
  "active", "pending", "approved", "sent", "replied", "bounced", "demo-booked", "won", "lost", "unsubscribed",
];

/** Persisted per-lead record (keyed by account id). */
export interface LeadRecord {
  status: LeadStatus;
  sent_at?: string;
  provider?: ProviderName;
  messageId?: string;
  smtpStatus?: SendStatus;
  error?: string;
  /** Campaign/industry/variant captured at send time — for opt-out reporting. */
  campaign?: string;
  industry?: string;
  variant?: Variant;
  /** Opt-out bookkeeping. */
  unsubscribed_at?: string;
  unsubscribe_reason?: string;
}

/** Reply phrases that trigger an automatic opt-out (case-insensitive, whole word). */
export const UNSUBSCRIBE_REPLY_PHRASES = ["abmelden", "unsubscribe", "stop", "keine e-mails", "keine emails", "remove"];

/** One line of the send report. */
export interface BatchResultLine {
  accountId: string;
  company: string;
  email?: string;
  status: SendStatus;
  messageId?: string;
  smtpStatus: SendStatus;
  bcc?: string;
  error?: string;
  sent_at: string;
}

/** The full send report returned by sendApprovedBatch(). */
export interface BatchReport {
  batchNumber: number;
  provider: ProviderName;
  dryRun: boolean;
  armed: boolean;
  /** Approved leads available (before the batch cap). */
  approvedAvailable: number;
  /** Emails attempted this run (<= effective batch size). */
  attempted: number;
  /** Delivered to the provider (status "sent"). */
  sent: number;
  /** Dry-run / not-configured skips. */
  skipped: number;
  /** Failed attempts. */
  errors: number;
  bccApplied: boolean;
  bccAddress?: string;
  /** How many of the sent emails carried the BCC. */
  bccCopies: number;
  /** Counts by SMTP/provider status. */
  smtpStatus: Record<SendStatus, number>;
  messageIds: string[];
  durationMs: number;
  /** True when the master switch was auto-disarmed after the batch. */
  disarmed: boolean;
  results: BatchResultLine[];
  notes: string[];
}

const LEAD_STATUS_KEY = "revenue-lead-status";

/** Load the lead-status map (empty when nothing has been approved/sent yet). */
export function loadLeadStatus(storage: Storage): Record<string, LeadRecord> {
  return storage.load<Record<string, LeadRecord>>(LEAD_STATUS_KEY) ?? {};
}

/** Persist the lead-status map. */
function saveLeadStatus(storage: Storage, map: Record<string, LeadRecord>): void {
  storage.save(LEAD_STATUS_KEY, map);
}

/** Mark accounts as "approved" (Approve in the Revenue Center). Unsubscribed leads are never re-approved. */
export function approveLeads(storage: Storage, ids: string[]): void {
  const map = loadLeadStatus(storage);
  for (const id of ids) {
    if (map[id]?.status === "unsubscribed") continue; // opt-out wins
    map[id] = { ...(map[id] ?? {}), status: "approved" };
  }
  saveLeadStatus(storage, map);
}

/** Reject leads (✗ in the Revenue Center) — status "lost", excluded from sending. */
export function rejectLeads(storage: Storage, ids: string[]): void {
  const map = loadLeadStatus(storage);
  for (const id of ids) {
    if (map[id]?.status === "unsubscribed") continue;
    map[id] = { ...(map[id] ?? {}), status: "lost" };
  }
  saveLeadStatus(storage, map);
}

/** Skip leads (☐ in the Revenue Center) — status "pending", revisit later. */
export function skipLeads(storage: Storage, ids: string[]): void {
  const map = loadLeadStatus(storage);
  for (const id of ids) {
    if (map[id]?.status === "unsubscribed") continue;
    map[id] = { ...(map[id] ?? {}), status: "pending" };
  }
  saveLeadStatus(storage, map);
}

// Per-lead unsubscribe token/URL live in email-template.ts (single source, no
// import cycle); re-exported here for the opt-out API surface.
export { unsubscribeToken, unsubscribeUrl };

/** True when this lead has opted out — sending to it is blocked. */
export function isUnsubscribed(storage: Storage, accountId: string): boolean {
  return loadLeadStatus(storage)[accountId]?.status === "unsubscribed";
}

/**
 * Opt out a lead (by account id OR unsubscribe token). Sets status
 * "unsubscribed" + timestamp + reason, blocking all future campaigns. Idempotent.
 * Returns the resolved account id, or null when the token/id is unknown.
 */
export function unsubscribeLead(
  storage: Storage,
  idOrToken: string,
  reason = "Opt-out",
  clock: () => string = () => new Date().toISOString(),
): string | null {
  const map = loadLeadStatus(storage);
  // Direct id, else resolve a token against known leads.
  let id: string | null = map[idOrToken] ? idOrToken : null;
  if (!id) id = Object.keys(map).find((k) => unsubscribeToken(k) === idOrToken) ?? null;
  if (!id) return null;
  map[id] = { ...(map[id] ?? { status: "active" }), status: "unsubscribed", unsubscribed_at: clock(), unsubscribe_reason: reason };
  saveLeadStatus(storage, map);
  return id;
}

/** True when a reply body signals an opt-out ("Abmelden" / "Unsubscribe" / "Stop" / …). */
export function replyRequestsUnsubscribe(replyText: string): boolean {
  const t = replyText.toLowerCase();
  return UNSUBSCRIBE_REPLY_PHRASES.some((p) => new RegExp(`(^|\\b|\\s)${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\b|\\s|$)`, "i").test(t));
}

/**
 * Process an inbound reply for a lead: opt out when the body asks to unsubscribe,
 * otherwise mark the lead "replied". Returns the new status (or null if unknown lead).
 */
export function processReply(
  storage: Storage,
  accountId: string,
  replyText: string,
  clock: () => string = () => new Date().toISOString(),
): LeadStatus | null {
  const map = loadLeadStatus(storage);
  if (!map[accountId]) return null;
  if (replyRequestsUnsubscribe(replyText)) {
    unsubscribeLead(storage, accountId, "Opt-out (Reply)", clock);
    return "unsubscribed";
  }
  map[accountId] = { ...map[accountId], status: "replied" } as LeadRecord;
  saveLeadStatus(storage, map);
  return "replied";
}

/** One row for the Revenue Center approval view. */
export interface LeadReviewRow {
  accountId: string;
  company: string;
  contact?: string;
  email?: string;
  industry: string;
  priority: number;
  subject: string;
  emailHtml: string;
  status: LeadStatus;
}

/**
 * Build the approval review list: the top `limit` prioritized accounts with
 * their generated subject + email preview and current lifecycle status. Read-
 * only — never sends, never changes status.
 */
export function leadReviewList(
  storage: Storage,
  opts: { accounts?: Account[]; accountsPath?: string; limit?: number; variant?: Variant; clock?: () => string } = {},
): LeadReviewRow[] {
  const clock = opts.clock ?? (() => new Date().toISOString());
  const variant = opts.variant ?? DEFAULT_VARIANT;
  const statusMap = loadLeadStatus(storage);
  const accounts = prioritize(opts.accounts ?? loadAccounts(opts.accountsPath)).slice(0, opts.limit ?? 50);
  return accounts.map((a) => {
    const opp = buildOpportunity(a, clock, variant);
    return {
      accountId: a.id,
      company: a.company,
      ...(a.contactTitle ? { contact: a.contactTitle } : {}),
      ...(a.email ? { email: a.email } : {}),
      industry: a.industry,
      priority: a.priority,
      subject: opp.subjects[0] ?? `${a.company}: CO₂-Daten`,
      emailHtml: opp.emailHtml,
      status: statusMap[a.id]?.status ?? "active",
    };
  });
}

export interface BatchSendOptions {
  storage: Storage;
  /** How many to send (default 20). Batch 1 is additionally capped at 20. */
  batchSize?: number;
  /** Explicit batch number; inferred from prior sends when omitted. */
  batchNumber?: number;
  /** Copy variant (default E). */
  variant?: Variant;
  /** Build everything but dispatch nothing real (default false). */
  dryRun?: boolean;
  /** Provider instance (default: the env-selected one). */
  provider?: EmailProvider;
  /** Inject accounts (tests / single-test-lead). Defaults to the real CRM loader. */
  accounts?: Account[];
  /** Path to the CRM accounts file (when accounts not injected). */
  accountsPath?: string;
  /** Clock for deterministic timestamps. */
  clock?: () => string;
  /** BCC address for batch 1 (default ted@heycarbo.com). Set "" to disable. */
  bccFirstBatch?: string;
  /** Auto-disarm the master switch after the batch (default true). */
  disarmAfter?: boolean;
}

/**
 * Send the next approved batch. Returns a report; never throws on a single
 * lead's failure (records it and continues). Honors every safety gate above.
 */
export async function sendApprovedBatch(opts: BatchSendOptions): Promise<BatchReport> {
  const {
    storage,
    batchSize = DEFAULT_BATCH_SIZE,
    variant = DEFAULT_VARIANT,
    dryRun = false,
    provider = getProvider(),
    clock = () => new Date().toISOString(),
    bccFirstBatch = BCC_FIRST_BATCH,
    disarmAfter = true,
  } = opts;
  const started = Date.now();
  const notes: string[] = [];

  const statusMap = loadLeadStatus(storage);
  const priorSent = Object.values(statusMap).filter((r) => r.status === "sent").length;
  const batchNumber = opts.batchNumber ?? (priorSent === 0 ? 1 : Math.floor(priorSent / batchSize) + 1);

  // Batch 1 is hard-capped at 20 no matter what was requested.
  const effectiveSize = batchNumber === 1 ? Math.min(batchSize, FIRST_BATCH_HARD_CAP) : batchSize;
  if (batchNumber === 1 && batchSize > FIRST_BATCH_HARD_CAP) {
    notes.push(`batchSize ${batchSize} capped to ${FIRST_BATCH_HARD_CAP} for batch 1`);
  }

  // BCC applies to batch 1 only.
  const bccActive = batchNumber === 1 && !!bccFirstBatch;
  const bccAddress = bccActive ? bccFirstBatch : undefined;
  if (bccActive) notes.push(`BCC active for batch 1 → ${bccAddress} (hidden from recipient)`);
  else if (batchNumber !== 1) notes.push(`no BCC (batch ${batchNumber} — BCC is batch-1 only)`);

  const armed = isSendArmed();
  if (!armed && !dryRun) notes.push("master switch OFF — every dispatch will be a dry-run 'skipped'");
  if (dryRun) notes.push("dryRun — nothing is dispatched to a real provider");

  // Eligible = approved leads, in priority order, matched to a loaded account.
  // Opt-out is enforced here: an unsubscribed lead can never be "approved", and
  // is additionally filtered out as defence-in-depth.
  const accounts = prioritize(opts.accounts ?? loadAccounts(opts.accountsPath));
  const approved = accounts.filter((a) => statusMap[a.id]?.status === "approved" && statusMap[a.id]?.status !== undefined);
  const blockedUnsub = accounts.filter((a) => statusMap[a.id]?.status === "unsubscribed").length;
  if (blockedUnsub) notes.push(`${blockedUnsub} unsubscribed lead(s) blocked (opt-out)`);
  if (accounts.length === 0) notes.push("no accounts loaded (real CRM file missing?) — nothing to send");

  const batch = approved.slice(0, effectiveSize);
  const results: BatchResultLine[] = [];
  const smtpStatus: Record<SendStatus, number> = { sent: 0, queued: 0, skipped: 0, error: 0 };
  const messageIds: string[] = [];
  let bccCopies = 0;

  for (const account of batch) {
    // Defence-in-depth: never dispatch to an opted-out lead, even if it slipped in.
    if (statusMap[account.id]?.status === "unsubscribed") continue;
    const opp = buildOpportunity(account, clock, variant);
    const now = clock();
    const email: OutboundEmail = {
      to: account.email as string,
      ...(account.company ? { toName: account.company } : {}),
      from: SENDER.email,
      fromName: SENDER.name,
      replyTo: SENDER.email,
      ...(bccAddress ? { bcc: bccAddress } : {}),
      subject: opp.subjects[0] ?? `${account.company}: CO₂-Daten`,
      html: opp.emailHtml,
      tags: ["revenue-batch", `batch-${batchNumber}`],
    };

    const result = dryRun
      ? { provider: provider.name, status: "skipped" as SendStatus, ok: true, detail: "dryRun" }
      : await dispatch(email, provider);

    smtpStatus[result.status] += 1;
    if (result.status === "sent") {
      if (result.messageId) messageIds.push(result.messageId);
      if (bccAddress) bccCopies += 1;
    }

    const line: BatchResultLine = {
      accountId: account.id,
      company: account.company,
      ...(account.email ? { email: account.email } : {}),
      status: result.status,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      smtpStatus: result.status,
      ...(bccAddress ? { bcc: bccAddress } : {}),
      ...(result.status === "error" && result.detail ? { error: result.detail } : {}),
      sent_at: now,
    };
    results.push(line);

    // Persist the outcome and flip to "sent" only on a real successful send.
    // Campaign/industry/variant are captured for opt-out reporting.
    const rec: LeadRecord = {
      status: result.status === "sent" ? "sent" : (statusMap[account.id]?.status ?? "approved"),
      sent_at: now,
      provider: result.provider,
      smtpStatus: result.status,
      campaign: opp.campaign,
      industry: account.industry,
      variant,
      ...(result.messageId ? { messageId: result.messageId } : {}),
      ...(result.status === "error" && result.detail ? { error: result.detail } : {}),
    };
    statusMap[account.id] = rec;
  }

  saveLeadStatus(storage, statusMap);

  // Auto-disarm: no implicit second wave. In-process only — the operator must
  // also ensure REVENUE_SEND_ENABLED=0 in their shell for the next process.
  let disarmed = false;
  if (disarmAfter && !dryRun) {
    process.env.REVENUE_SEND_ENABLED = "0";
    disarmed = true;
    notes.push("REVENUE_SEND_ENABLED reset to 0 (in-process) — no second wave");
  }

  const sent = smtpStatus.sent;
  const skipped = smtpStatus.skipped + smtpStatus.queued;
  const errors = smtpStatus.error;

  return {
    batchNumber,
    provider: provider.name,
    dryRun,
    armed,
    approvedAvailable: approved.length,
    attempted: batch.length,
    sent,
    skipped,
    errors,
    bccApplied: bccActive,
    ...(bccAddress ? { bccAddress } : {}),
    bccCopies,
    smtpStatus,
    messageIds,
    durationMs: Date.now() - started,
    disarmed,
    results,
    notes,
  };
}

/** Pretty one-screen report for the CLI / logs. */
export function formatBatchReport(r: BatchReport): string {
  const L: string[] = [];
  L.push("── Versandbericht ─────────────────────────────────────────");
  L.push(`Batch                : #${r.batchNumber}${r.dryRun ? "  (DRY RUN — nichts gesendet)" : ""}`);
  L.push(`Provider             : ${r.provider}`);
  L.push(`Master-Switch        : ${r.armed ? "ARMED (REVENUE_SEND_ENABLED=1)" : "OFF (dry-run)"}`);
  L.push(`Approved verfügbar   : ${r.approvedAvailable}`);
  L.push(`Versendete E-Mails   : ${r.sent} / versucht ${r.attempted}`);
  L.push(`BCC-Kopien           : ${r.bccCopies}${r.bccAddress ? ` → ${r.bccAddress}` : ""} (${r.bccApplied ? "aktiv, Batch 1" : "inaktiv"})`);
  L.push(`SMTP-Status          : sent ${r.smtpStatus.sent} · queued ${r.smtpStatus.queued} · skipped ${r.smtpStatus.skipped} · error ${r.smtpStatus.error}`);
  L.push(`Fehler               : ${r.errors}`);
  L.push(`Message-IDs          : ${r.messageIds.length ? r.messageIds.join(", ") : "—"}`);
  L.push(`Versanddauer         : ${r.durationMs} ms`);
  L.push(`Auto-Disarm          : ${r.disarmed ? "ja (REVENUE_SEND_ENABLED=0)" : "nein"}`);
  if (r.errors > 0) {
    L.push("Fehlerdetails        :");
    for (const line of r.results.filter((x) => x.error)) L.push(`  • ${line.company} <${line.email ?? "?"}>: ${line.error}`);
  }
  if (r.notes.length) L.push(`Hinweise             : ${r.notes.join(" · ")}`);
  L.push("───────────────────────────────────────────────────────────");
  return L.join("\n");
}
