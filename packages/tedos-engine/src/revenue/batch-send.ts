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
import { EMAIL_ASSETS } from "./email-template.js";
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

export type LeadStatus = "pending" | "approved" | "sent";

/** Persisted per-lead record (keyed by account id). */
export interface LeadRecord {
  status: LeadStatus;
  sent_at?: string;
  provider?: ProviderName;
  messageId?: string;
  smtpStatus?: SendStatus;
  error?: string;
}

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

/** Mark accounts as "approved" (setup/operator helper; never auto-called). */
export function approveLeads(storage: Storage, ids: string[]): void {
  const map = loadLeadStatus(storage);
  for (const id of ids) map[id] = { ...(map[id] ?? {}), status: "approved" };
  saveLeadStatus(storage, map);
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
  const accounts = prioritize(opts.accounts ?? loadAccounts(opts.accountsPath));
  const approved = accounts.filter((a) => statusMap[a.id]?.status === "approved");
  if (accounts.length === 0) notes.push("no accounts loaded (real CRM file missing?) — nothing to send");

  const batch = approved.slice(0, effectiveSize);
  const results: BatchResultLine[] = [];
  const smtpStatus: Record<SendStatus, number> = { sent: 0, queued: 0, skipped: 0, error: 0 };
  const messageIds: string[] = [];
  let bccCopies = 0;

  for (const account of batch) {
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
    const rec: LeadRecord = {
      status: result.status === "sent" ? "sent" : (statusMap[account.id]?.status ?? "approved"),
      sent_at: now,
      provider: result.provider,
      smtpStatus: result.status,
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
