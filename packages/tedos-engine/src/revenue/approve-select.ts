// HARDENED APPROVAL SELECTION — picks the next N leads to auto-approve.
//
// Pure selection logic (no send, no SMTP, no DNS). Applies, in order:
//   • eligible status (never sent/decided/opted-out/bounced/already-approved)
//   • deliverable address + data quality (company + industry present)
//   • DUPLICATE exclusion (unique lower-cased address)
//   • DOMAIN MATCH — the email domain must belong to the company (its website
//     domain, or a name token). Foreign third-party addresses like
//     info@joppnet.de for "Kapp Niles" are rejected (they caused a bounce).
// Then ranks fit-first (revenue → fit → buying intent) and, as a tiebreaker,
// PREFERS personalized addresses over generic role mailboxes (info@, kontakt@…).

import { type Account, prioritize } from "./accounts.js";
import type { LeadRecord } from "./batch-send.js";

/**
 * Statuses that make a lead ineligible for a fresh approval.
 *
 * "replied", "demo-booked" and "won" are here for the same reason as "sent":
 * the conversation has already started, and dropping a cold outbound mail into
 * it is the worst possible touch. The send-side selector already refuses these
 * (ALREADY_CONTACTED in batch-send.ts), so leaving them out never leaked a real
 * email — it just let them consume approval slots and silently shrink the
 * batch below the requested N.
 */
const INELIGIBLE = new Set([
  "sent", "lost", "unsubscribed", "approved", "bounced", "replied", "demo-booked", "won",
]);

/** Generic role mailboxes — deliverable but rarely reach a decision-maker. */
const ROLE_LOCALPARTS = new Set([
  "info", "kontakt", "contact", "service", "office", "zentrale", "mail", "email",
  "sales", "vertrieb", "hello", "team", "welcome", "anfrage", "anfragen", "presse",
  "marketing", "empfang", "buchhaltung", "no-reply", "noreply", "kommunikation",
  "webmaster", "communications", "customercenter", "customer", "support", "help",
  "dpo", "admin", "enquiries", "inquiries", "enquiry", "inquiry", "order", "orders",
  "karriere", "career", "jobs", "hr", "datenschutz", "compliance", "presales",
]);

/** Company-name words that are not distinctive brand tokens. */
const STOPWORDS = new Set([
  "group", "gruppe", "gmbh", "holding", "technologies", "technology", "international",
  "unternehmen", "maschinenfabrik", "gesellschaft", "systems", "systeme", "werke",
  "and", "und", "the", "gmbhcokg", "kgaa", "aktiengesellschaft",
]);

/** Registrable-ish core label of a host, e.g. "kapp-niles.com" → "kapp-niles". */
function coreLabel(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".").filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? h) : h;
}

/** Host from a website field (tolerates missing protocol / paths). */
function websiteHost(website: string | undefined): string {
  if (!website) return "";
  const raw = website.trim();
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  }
}

/** Distinctive lower-case tokens (len ≥ 4) from a company name. */
function nameTokens(company: string): string[] {
  return company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** True when the email's domain plausibly belongs to the company. */
export function domainMatches(email: string, website: string | undefined, company: string): boolean {
  const emailHost = (email.split("@")[1] ?? "").toLowerCase();
  if (!emailHost) return false;
  const eCore = coreLabel(emailHost);
  const wHost = websiteHost(website);
  if (wHost) {
    const wCore = coreLabel(wHost);
    if (eCore === wCore) return true;
    if (emailHost.endsWith(wHost) || wHost.endsWith(emailHost)) return true; // sub-domains
    if (eCore.length >= 4 && wCore.includes(eCore)) return true;
    if (wCore.length >= 4 && eCore.includes(wCore)) return true;
    return false;
  }
  // No website on file → fall back to a company-name token appearing in the domain.
  return nameTokens(company).some((t) => eCore.includes(t) || t.includes(eCore));
}

/**
 * True when the local part looks like a person (firstname.lastname / f.lastname),
 * not a generic role mailbox. Conservative on purpose — it is only a ranking
 * tiebreaker, so a false "role" is cheaper than an inflated personalized count.
 */
export function isPersonalized(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (!local) return false;
  const tokens = local.split(/[.\-_]+/).filter(Boolean);
  if (tokens.some((t) => ROLE_LOCALPARTS.has(t))) return false;
  const alpha = tokens.filter((t) => /^[a-z]+$/.test(t));
  return alpha.length >= 2 && alpha.some((t) => t.length >= 2);
}

export interface ApprovalSelection {
  pick: Account[];
  eligible: number;
  rejected: { status: number; noEmail: number; dataQuality: number; duplicate: number; domainMismatch: number };
  personalizedInPick: number;
}

/**
 * Select up to `limit` leads to approve, applying the hardened filter and
 * ranking fit-first with a personalized-address tiebreaker. Pure — no side effects.
 */
export function selectForApproval(
  accounts: Account[],
  statusMap: Record<string, LeadRecord>,
  limit: number,
): ApprovalSelection {
  const rejected = { status: 0, noEmail: 0, dataQuality: 0, duplicate: 0, domainMismatch: 0 };
  const seen = new Set<string>();
  const eligible: Account[] = [];

  for (const a of prioritize(accounts)) {
    const st = statusMap[a.id]?.status ?? "active";
    if (INELIGIBLE.has(st)) { rejected.status += 1; continue; }
    const email = (a.email ?? "").trim();
    if (!email) { rejected.noEmail += 1; continue; }
    if (!a.company || !a.industry) { rejected.dataQuality += 1; continue; }
    const key = email.toLowerCase();
    if (seen.has(key)) { rejected.duplicate += 1; continue; }
    if (!domainMatches(email, a.website, a.company)) { rejected.domainMismatch += 1; continue; }
    seen.add(key);
    eligible.push(a);
  }

  // Fit-first, personalized address as tiebreaker.
  eligible.sort(
    (a, b) =>
      b.revenueScore - a.revenueScore ||
      b.fitScore - a.fitScore ||
      (Number(isPersonalized(b.email as string)) - Number(isPersonalized(a.email as string))) ||
      b.buyingIntent - a.buyingIntent,
  );

  const pick = eligible.slice(0, limit);
  return {
    pick,
    eligible: eligible.length,
    rejected,
    personalizedInPick: pick.filter((a) => isPersonalized(a.email as string)).length,
  };
}
