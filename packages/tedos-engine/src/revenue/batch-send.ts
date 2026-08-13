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
//   • The brand's monitoring BCC (profile.identity.bcc) is applied to batch 1
//     ONLY (blind — hidden from the recipient). Batches 2+ carry no BCC by default.
//   • After the batch the master switch is auto-disarmed in-process
//     (REVENUE_SEND_ENABLED=0) so no second wave can start implicitly.
//   • dryRun:true builds + reports everything but dispatches nothing real.

import type { Storage } from "./../storage.js";
import { type Account, loadAccounts, prioritize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";
import { activeBrandProfile } from "./brand-profile.js";
import { unsubscribeToken, unsubscribeUrl } from "./email-template.js";
import { type Variant, DEFAULT_VARIANT } from "./email-copy.js";
import { assignExperiment, experimentConfig, describeExperiment } from "./experiment.js";
import { berlinZeit } from "./zeit.js";
import {
  dispatch, getProvider, isSendArmed, selectedProviderName,
  type EmailProvider, type OutboundEmail, type ProviderName, type SendStatus,
} from "./sending.js";

/** BCC target for the first productive batch only (hidden from the recipient).
 *  Fully brand-profile driven (env `REVENUE_BCC_FIRST_BATCH` still overrides). */
export const BCC_FIRST_BATCH = process.env.REVENUE_BCC_FIRST_BATCH ?? activeBrandProfile().identity.bcc;
/** Absolute ceiling for batch 1 — the loop can never send more than this. */
export const FIRST_BATCH_HARD_CAP = 20;
/** Default batch size. */
export const DEFAULT_BATCH_SIZE = 20;

/** Sender identity (env-overridable, defaults to the active brand's owner). */
const SENDER = {
  email: process.env.REVENUE_FROM_EMAIL ?? activeBrandProfile().identity.senderEmail,
  name: process.env.REVENUE_FROM_NAME ?? activeBrandProfile().identity.senderName,
} as const;

/** Reply-To for outbound mail — defaults to the sender (env `REVENUE_REPLY_TO` overrides). */
const REPLY_TO = process.env.REVENUE_REPLY_TO ?? SENDER.email;

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
  /** Operator batch label (e.g. "Pilot Batch 02"), when provided. */
  batchCampaign?: string;
  /** Opt-out bookkeeping. */
  unsubscribed_at?: string;
  unsubscribe_reason?: string;
  /** Set when a permanent (5.x.x) bounce suppressed this address. */
  bounced_at?: string;
  /** Freitext-Vermerk (Dubletten-Stilllegung, tote Domain, manuelle Notiz). */
  note?: string;
  /** Welche Betreffvariante versendet wurde (A/B-Auswertung). */
  subjectIndex?: number;
  /** Zeitpunkte der Nachfassmails (max. zwei). */
  followup1_at?: string;
  followup2_at?: string;
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
  /** Operator campaign label for this batch, if provided. */
  campaignLabel?: string;
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

/**
 * Mark leads as "bounced" — a permanent (5.x.x) delivery failure. They are then
 * excluded from every future batch by `contactedAddresses()`. Opt-out still wins,
 * and an already-`unsubscribed` record is never downgraded.
 */
export function markBounced(storage: Storage, ids: string[], at: string): number {
  const map = loadLeadStatus(storage);
  let changed = 0;
  for (const id of ids) {
    if (map[id]?.status === "unsubscribed") continue;
    if (map[id]?.status === "bounced") continue;
    map[id] = { ...(map[id] ?? {}), status: "bounced", bounced_at: at };
    changed += 1;
  }
  if (changed) saveLeadStatus(storage, map);
  return changed;
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
  /** Record the opt-out even when `idOrToken` has no status row yet (see below). */
  createIfMissing = false,
): string | null {
  const map = loadLeadStatus(storage);
  // Direct id, else resolve a token against known leads.
  let id: string | null = map[idOrToken] ? idOrToken : null;
  if (!id) id = Object.keys(map).find((k) => unsubscribeToken(k) === idOrToken) ?? null;
  // The token lookup can only match leads that ALREADY carry a status row, so a
  // caller that resolved the lead itself (unsubscribe-sync, which recomputes
  // token → id against the full CRM) must be able to record an opt-out for a
  // lead we never logged. Opt-in only: the default stays "unknown → null", so a
  // bogus id can never create a junk row.
  if (!id && createIfMissing) id = idOrToken;
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

/** Result of narrowing the CRM to the actually-sendable batch. */
export interface SendableSelection {
  /** Final list to dispatch: priority-ordered, capped to `limit`. */
  batch: Account[];
  approved: number;      // raw count with status "approved"
  withEmail: number;     // approved AND carrying a deliverable address
  afterDedupe: number;   // withEmail AND a unique (lower-cased) address
  dupDropped: number;    // duplicate recipients removed (within this batch)
  contactedDropped: number; // address already reached in an EARLIER batch
  undeliverableDropped: number; // address on a domain that cannot accept mail (no MX)
  noEmailDropped: number;// approved leads without an address removed
  blockedUnsub: number;  // opted-out leads present in the CRM (defence-in-depth)
}

/**
 * The `List-Unsubscribe` header pair for one recipient.
 *
 * Gmail and Yahoo require a working List-Unsubscribe on bulk mail (their
 * bulk-sender rules, in force since February 2024); without it a sender's
 * reputation degrades regardless of how clean the list is. The header also
 * gives the recipient the native "Unsubscribe" button next to the sender name,
 * which is far more likely to be used than a footer link — and every opt-out
 * taken there is one complaint NOT filed.
 *
 * Two forms are emitted:
 *   • https: — the RFC 8058 one-click endpoint (paired with List-Unsubscribe-Post)
 *   • mailto: — the universal fallback, honoured by the reply-based opt-out
 *
 * List-Unsubscribe-Post is only set when a POST endpoint is configured: naming
 * one-click without a working POST target is worse than not offering it.
 */
export function listUnsubscribeHeaders(unsubUrl: string | undefined): Record<string, string> {
  const brand = activeBrandProfile();
  const postUrl = process.env.REVENUE_UNSUBSCRIBE_POST_URL ?? brand.urls.unsubscribePostUrl;
  const token = unsubUrl?.split("/").filter(Boolean).pop() ?? "";
  const mailto = `<mailto:${brand.identity.senderEmail}?subject=Abmelden>`;

  if (!postUrl || !token) return { "List-Unsubscribe": mailto };

  const oneClick = `<${postUrl}?token=${encodeURIComponent(token)}>`;
  return {
    "List-Unsubscribe": `${oneClick}, ${mailto}`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Statuses that mean "this address has already been reached, or must never be
 * reached again". The same company often sits in the CRM under several lead ids
 * sharing one `info@` address — without this set, approving the second id would
 * mail the same mailbox twice.
 */
const ALREADY_CONTACTED: LeadStatus[] = [
  "sent", "replied", "bounced", "demo-booked", "won", "lost", "unsubscribed",
];

/**
 * Every address that a previous batch already reached (or that is burned), taken
 * across ALL lead ids — the key to cross-batch deduplication.
 */
export function contactedAddresses(
  accounts: Account[],
  statusMap: Record<string, LeadRecord>,
): Set<string> {
  const burned = new Set<string>();
  for (const a of accounts) {
    const st = statusMap[a.id]?.status;
    const email = (a.email ?? "").trim().toLowerCase();
    if (email && st && ALREADY_CONTACTED.includes(st)) burned.add(email);
  }
  return burned;
}

/**
 * Narrow the CRM accounts to the sendable batch, applying — in order — the
 * approved-only filter, the deliverable-address requirement, exclusion of
 * addresses already contacted in an earlier batch, duplicate-recipient exclusion
 * within this batch, and the batch-size cap. Opt-out is enforced upstream (an
 * unsubscribed lead can never be "approved"); `blockedUnsub` surfaces the count
 * for transparency. Pure: no IO, no dispatch. Shared by the preflight and the
 * actual send so both operate on the EXACT same set (no drift).
 */
export function selectSendable(
  accounts: Account[],
  statusMap: Record<string, LeadRecord>,
  limit: number,
  /**
   * Adressen, die dieser Batch NICHT anschreiben darf — auch wenn sie approved
   * und sonst sauber sind. Genutzt für Empfänger-Domains ohne MX-Record: die
   * können Mail nicht annehmen, jeder Versand dorthin ist ein sicherer Bounce.
   * Der Preflight ermittelt sie und reicht sie hier durch.
   */
  excludeEmails: Set<string> = new Set(),
): SendableSelection {
  const ranked = prioritize(accounts);
  const blockedUnsub = ranked.filter((a) => statusMap[a.id]?.status === "unsubscribed").length;
  const approvedList = ranked.filter((a) => statusMap[a.id]?.status === "approved");
  const withEmailList = approvedList.filter((a) => (a.email ?? "").trim() !== "");

  // Cross-batch: drop anything whose address a previous batch already reached.
  const burned = contactedAddresses(accounts, statusMap);
  let contactedDropped = 0;
  const unreached = withEmailList.filter((a) => {
    if (burned.has((a.email as string).trim().toLowerCase())) { contactedDropped += 1; return false; }
    return true;
  });

  // Within-batch: the same address may still appear under two approved ids.
  const seen = new Set<string>();
  let dupDropped = 0;
  let undeliverableDropped = 0;
  const deduped = unreached.filter((a) => {
    const key = (a.email as string).trim().toLowerCase();
    if (seen.has(key)) { dupDropped += 1; return false; }
    if (excludeEmails.has(key)) { undeliverableDropped += 1; return false; }
    seen.add(key);
    return true;
  });
  return {
    batch: deduped.slice(0, limit),
    approved: approvedList.length,
    withEmail: withEmailList.length,
    afterDedupe: deduped.length,
    dupDropped,
    contactedDropped,
    undeliverableDropped,
    noEmailDropped: approvedList.length - withEmailList.length,
    blockedUnsub,
  };
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
  /** Explicit BCC for THIS batch — overrides the batch-1-only default (any size). "" disables. */
  bcc?: string;
  /** Operator campaign label for this batch (e.g. "Pilot Batch 02"), recorded + reported. */
  campaignLabel?: string;
  /** Auto-disarm the master switch after the batch (default true). */
  disarmAfter?: boolean;
  /** Adressen, die dieser Batch überspringen muss (Preflight: Domains ohne MX). */
  excludeEmails?: Set<string>;
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

  // The 20-cap protects only the FIRST-EVER batch (nothing sent yet). Once real
  // emails have gone out, the pipeline is validated and batchSize governs.
  const firstEver = priorSent === 0;
  const effectiveSize = firstEver ? Math.min(batchSize, FIRST_BATCH_HARD_CAP) : batchSize;
  if (firstEver && batchSize > FIRST_BATCH_HARD_CAP) {
    notes.push(`batchSize ${batchSize} capped to ${FIRST_BATCH_HARD_CAP} for the first-ever batch`);
  }

  // BCC: an explicit opts.bcc overrides the batch-1-only default (works at any
  // batch size). "" disables. Undefined → the batch-1-only default.
  const bccAddress = opts.bcc !== undefined ? (opts.bcc || undefined) : (batchNumber === 1 && bccFirstBatch ? bccFirstBatch : undefined);
  const bccActive = !!bccAddress;
  if (bccActive) notes.push(`BCC active → ${bccAddress} (hidden from recipient)`);
  else notes.push(`no BCC (batch ${batchNumber})`);

  const armed = isSendArmed();
  if (!armed && !dryRun) notes.push("master switch OFF — every dispatch will be a dry-run 'skipped'");
  if (dryRun) notes.push("dryRun — nothing is dispatched to a real provider");

  // Eligible set via the shared selector: approved-only → deliverable address →
  // duplicate-recipient exclusion → batch-size cap. Same function the preflight
  // runs, so what preflight cleared is exactly what sends.
  const accounts = opts.accounts ?? loadAccounts(opts.accountsPath);
  const sel = selectSendable(accounts, statusMap, effectiveSize, opts.excludeEmails ?? new Set());
  if (sel.blockedUnsub) notes.push(`${sel.blockedUnsub} unsubscribed lead(s) blocked (opt-out)`);
  if (sel.noEmailDropped) notes.push(`${sel.noEmailDropped} approved lead(s) without a deliverable address excluded`);
  if (sel.dupDropped) notes.push(`${sel.dupDropped} duplicate recipient(s) excluded`);
  if (sel.undeliverableDropped) notes.push(`${sel.undeliverableDropped} recipient(s) on a domain without MX excluded (guaranteed bounce)`);
  if (accounts.length === 0) notes.push("no accounts loaded (real CRM file missing?) — nothing to send");

  const batch = sel.batch;
  const results: BatchResultLine[] = [];
  const smtpStatus: Record<SendStatus, number> = { sent: 0, queued: 0, skipped: 0, error: 0 };
  const messageIds: string[] = [];
  let bccCopies = 0;

  const expCfg = experimentConfig();
  notes.push(`A/B: ${describeExperiment(expCfg)}`);

  for (const account of batch) {
    // Defence-in-depth: never dispatch to an opted-out lead, even if it slipped in.
    if (statusMap[account.id]?.status === "unsubscribed") continue;
    // Deterministisch je Lead — eine spätere Nachfassmail trifft denselben Arm.
    // opts.variant (Tests / gezielter Einzelversand) hat Vorrang.
    const exp = assignExperiment(account.id, expCfg);
    const useVariant = opts.variant ?? exp.variant;
    const opp = buildOpportunity(account, clock, useVariant);
    const now = clock();
    const email: OutboundEmail = {
      to: account.email as string,
      ...(account.company ? { toName: account.company } : {}),
      from: SENDER.email,
      fromName: SENDER.name,
      replyTo: REPLY_TO,
      ...(bccAddress ? { bcc: bccAddress } : {}),
      subject: opp.subjects[exp.subjectIndex] ?? opp.subjects[0] ?? activeBrandProfile().copy.queueSubjectFallback(account.company),
      html: opp.emailHtml,
      // multipart/alternative — HTML-only bulk mail is penalized by every major
      // spam filter and is unreadable in text-only clients.
      text: opp.emailText,
      headers: listUnsubscribeHeaders(opp.unsubscribeUrl),
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
      variant: useVariant,
      subjectIndex: exp.subjectIndex,
      ...(opts.campaignLabel ? { batchCampaign: opts.campaignLabel } : {}),
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
    ...(opts.campaignLabel ? { campaignLabel: opts.campaignLabel } : {}),
    provider: provider.name,
    dryRun,
    armed,
    approvedAvailable: sel.afterDedupe,
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
  L.push(`Batch                : #${r.batchNumber}${r.campaignLabel ? ` · Kampagne: ${r.campaignLabel}` : ""}${r.dryRun ? "  (DRY RUN — nichts gesendet)" : ""}`);
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

// ── Nachfassen ───────────────────────────────────────────────────────────────

/** Werktage zwischen zwei Zeitpunkten (Sa/So zählen nicht). */
export function workdaysBetween(from: string, to: string): number {
  const a = new Date(from), b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return 0;
  let d = 0;
  const c = new Date(a);
  while (c < b) {
    c.setDate(c.getDate() + 1);
    const wd = c.getDay();
    if (wd !== 0 && wd !== 6) d += 1;
  }
  return d;
}

export interface FollowUpCandidate {
  account: Account;
  /** 1 = erste Nachfassmail, 2 = zweite (und letzte). */
  stage: 1 | 2;
  /** Werktage seit dem letzten Kontakt. */
  workdays: number;
}

export interface FollowUpSelection {
  batch: FollowUpCandidate[];
  /** Kontakte im Status "sent" — die einzige Grundmenge fürs Nachfassen. */
  sent: number;
  eligible: number;
  tooEarly: number;
  /** Bereits zweimal nachgefasst — die Sequenz endet dort. */
  exhausted: number;
  /** Aus dem Nachfassen genommen, weil reagiert/gesperrt (mit Grund). */
  excluded: Record<string, number>;
}

/**
 * Wer bekommt eine Nachfassmail?
 *
 * NUR Leads im Status "sent". Das ist keine Bequemlichkeit, sondern die
 * eigentliche Sicherung: Sobald jemand antwortet, sich abmeldet oder bounct,
 * verlässt der Lead diesen Status und fällt damit automatisch aus jeder
 * weiteren Sequenz. Wer geantwortet hat, darf nie ein "haben Sie meine Mail
 * gesehen?" bekommen — das verbrennt den warmen Kontakt. Wer sich abgemeldet
 * hat, darf gar nichts mehr bekommen.
 *
 * Diese Sicherung trägt aber nur, solange der Posteingang tatsächlich
 * ausgewertet wird — sonst bleibt jeder Antwortende auf "sent" stehen. Der
 * Runner erzwingt deshalb einen frischen Scan, bevor er überhaupt auswählt.
 */
export function selectFollowUps(
  accounts: Account[],
  statusMap: Record<string, LeadRecord>,
  opts: { limit: number; now: string; minWorkdays1?: number; minWorkdays2?: number },
): FollowUpSelection {
  const min1 = opts.minWorkdays1 ?? 4;
  const min2 = opts.minWorkdays2 ?? 5;
  const excluded: Record<string, number> = {};
  let sent = 0, tooEarly = 0, exhausted = 0;
  const cands: FollowUpCandidate[] = [];

  for (const a of prioritize(accounts)) {
    const r = statusMap[a.id];
    if (!r) continue;
    if (r.status !== "sent") {
      // Alles andere ist entweder nie kontaktiert oder hat bereits reagiert.
      if (["replied", "unsubscribed", "bounced", "demo-booked", "won", "lost"].includes(r.status)) {
        excluded[r.status] = (excluded[r.status] ?? 0) + 1;
      }
      continue;
    }
    sent += 1;
    const email = (a.email ?? "").trim();
    if (!email) { excluded["ohne Adresse"] = (excluded["ohne Adresse"] ?? 0) + 1; continue; }
    if (r.followup2_at) { exhausted += 1; continue; }

    const last = r.followup1_at ?? r.sent_at;
    if (!last) continue;
    const wd = workdaysBetween(last, opts.now);
    const stage: 1 | 2 = r.followup1_at ? 2 : 1;
    if (wd < (stage === 1 ? min1 : min2)) { tooEarly += 1; continue; }
    cands.push({ account: a, stage, workdays: wd });
  }

  // Älteste zuerst — wer am längsten wartet, wird zuerst nachgefasst.
  cands.sort((x, y) => y.workdays - x.workdays);
  return { batch: cands.slice(0, opts.limit), sent, eligible: cands.length, tooEarly, exhausted, excluded };
}

const INBOX_SCAN_KEY = "revenue-inbox-scan";

/** Was der letzte Posteingangs-Scan verarbeitet hat. */
export interface InboxScanRecord {
  at: string;
  bounces: number;
  optOuts: number;
  replies: number;
}

/** Lauf des Posteingangs-Scans festhalten (nur im Schreibmodus aufgerufen). */
export function recordInboxScan(storage: Storage, rec: InboxScanRecord): void {
  storage.save(INBOX_SCAN_KEY, rec);
}

export function lastInboxScan(storage: Storage): InboxScanRecord | null {
  return storage.load<InboxScanRecord>(INBOX_SCAN_KEY) ?? null;
}

/**
 * Darf nachgefasst werden?
 *
 * Nur wenn der Posteingang kürzlich ausgewertet wurde. Ohne das steht jeder,
 * der geantwortet oder sich abgemeldet hat, immer noch auf "sent" — und bekäme
 * eine Nachfassmail. Der Statusfilter in selectFollowUps() sieht dann nichts,
 * weil die Statuswechsel nie geschrieben wurden.
 */
export function followUpGate(
  storage: Storage,
  now: string,
  maxAgeHours = 72,
): { ok: boolean; detail: string } {
  const scan = lastInboxScan(storage);
  if (!scan) {
    return { ok: false, detail: "Posteingang wurde nie ausgewertet — Antworten und Abmeldungen sind unbekannt. Erst `npm run inbox:scan -- --write-suppression` ausführen." };
  }
  const ageH = (new Date(now).getTime() - new Date(scan.at).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH > maxAgeHours) {
    return { ok: false, detail: `letzter Posteingangs-Scan ist ${Math.round(ageH)} h alt (max. ${maxAgeHours} h) — zwischenzeitliche Antworten und Abmeldungen wären unsichtbar.` };
  }
  return { ok: true, detail: `Posteingang ausgewertet am ${berlinZeit(scan.at)} (vor ${Math.round(ageH)} h) · ${scan.bounces} Bounces · ${scan.optOuts} Abmeldungen · ${scan.replies} Antworten` };
}

/**
 * Einen Lead als "replied" markieren — er verlässt damit die Nachfass-Sequenz.
 *
 * Endzustände (unsubscribed/bounced/demo-booked/won/lost) werden NIE
 * überschrieben: eine Abmeldung wiegt schwerer als eine Antwort, und ein
 * gebuchter Termin ist bereits weiter als "hat geantwortet".
 */
export function markReplied(storage: Storage, id: string): boolean {
  const map = loadLeadStatus(storage);
  const cur = map[id]?.status;
  if (!cur || cur === "replied") return false;
  if (["unsubscribed", "bounced", "demo-booked", "won", "lost"].includes(cur)) return false;
  map[id] = { ...(map[id] as LeadRecord), status: "replied" };
  saveLeadStatus(storage, map);
  return true;
}
