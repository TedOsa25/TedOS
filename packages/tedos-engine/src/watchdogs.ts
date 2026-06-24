// TedOS watchdog registry — the canonical manifest of the autonomous schedule.
//
// This is a data-only spec that mirrors the harness cron jobs the scheduler
// runs. It does NOT drive execution (the scheduler owns the cron jobs); it is
// the single source of truth + documentation anchor, consumed by the
// watchdogs demo and validated by watchdogs.test. Pure extension — no existing
// module is changed, no framework added.

/** A daily read-only watchdog: researches, analyses, emits GoalCandidates. */
export interface Watchdog {
  id: string;
  name: string;
  /** 5-field cron expression (local time) as scheduled. */
  cron: string;
  /** Nominal local time (the requested slot). */
  time: string;
  /** Learning feed it appends findings to (under learning-data/). */
  feed: string;
  mission: string;
}

/** The continuous executor — the only component that implements GoalCandidates. */
export const MAIN_LOOP = {
  id: "main-loop",
  name: "Main Loop",
  cron: "*/15 * * * *",
  time: "every 15 min",
  feed: "loop-outcomes.json",
  mission: "Select the highest-value safe GoalCandidate, implement+validate LOW risk on the feature branch, escalate MEDIUM/HIGH for approval.",
} as const;

/** The twelve daily watchdogs, in schedule order (08:00 → 17:30). */
export const WATCHDOGS: Watchdog[] = [
  { id: "health", name: "Health Watchdog", cron: "4 8 * * *", time: "08:00", feed: "health-findings.json", mission: "Build/types/tests/coverage/deps/security/perf/dead-code health." },
  { id: "ux", name: "UX Watchdog", cron: "6 9 * * *", time: "09:00", feed: "ux-findings.json", mission: "Navigation, mobile, a11y, typography, components, states, design consistency." },
  { id: "strategy", name: "Product Strategy Watchdog", cron: "8 10 * * *", time: "10:00", feed: "strategy-findings.json", mission: "Supplier-network strategy: onboarding, Scope 3, PCF, gaps, network effects." },
  { id: "competitor", name: "Competitor Watchdog", cron: "7 11 * * *", time: "11:00", feed: "competitor-findings.json", mission: "Market, competitors, pricing, positioning, enterprise & PLG features." },
  { id: "security", name: "Security Watchdog", cron: "9 12 * * *", time: "12:00", feed: "security-findings.json", mission: "CVEs, deps, secrets, OWASP, authn/authz, API, rate limits, GDPR." },
  { id: "growth", name: "Growth Watchdog", cron: "11 13 * * *", time: "13:00", feed: "growth-findings.json", mission: "Landing, trial funnel, conversion, activation, retention, SEO, perf." },
  { id: "marketing", name: "Marketing Watchdog", cron: "13 14 * * *", time: "14:00", feed: "marketing-findings.json", mission: "LinkedIn, blog, newsletter, case studies, PR, content gaps, brand." },
  { id: "customer-success", name: "Customer Success Watchdog", cron: "8 15 * * *", time: "15:00", feed: "customer-success-findings.json", mission: "Tickets, feedback, feature requests, churn, onboarding, help center." },
  { id: "revenue", name: "Revenue Watchdog", cron: "9 16 * * *", time: "16:00", feed: "revenue-findings.json", mission: "Pricing/upsell/cross-sell/enterprise/expansion (analysis only)." },
  { id: "sales", name: "Sales Watchdog", cron: "32 16 * * *", time: "16:30", feed: "sales-findings.json", mission: "CRM, pipeline, demos, conversion, lost deals, win rate, ICP, velocity, KPIs, bottlenecks." },
  { id: "ai", name: "AI Watchdog", cron: "11 17 * * *", time: "17:00", feed: "ai-findings.json", mission: "New models, LLM releases, APIs, agents, prompting, inference cost/speed/quality." },
  { id: "supplier", name: "Supplier Watchdog", cron: "32 17 * * *", time: "17:30", feed: "supplier-findings.json", mission: "Supplier invitations, activation, response rate, Scope 3 coverage, PCF requests, Catena-X readiness, engagement, growth." },
];

/**
 * The end-of-day Executive Report. It aggregates the Main Loop plus every
 * watchdog feed (13 sources) into a one-page business-first summary.
 */
export const EXECUTIVE_REPORT = {
  id: "executive-report",
  name: "Executive Report",
  cron: "12 18 * * *",
  time: "18:00",
  feed: "executive-reports.json",
  /** The 13 source ids it reads: the Main Loop + all twelve watchdogs. */
  sources: [MAIN_LOOP.id, ...WATCHDOGS.map((w) => w.id)],
} as const;

/** The guardrails every watchdog obeys (read-only; only the Main Loop implements). */
export const GUARDRAILS = {
  allowed: ["research", "analysis", "read", "reports", "goalCandidates", "prioritization"],
  forbidden: ["deploy", "merge", "main", "compliance", "co2", "billing", "pricing", "security", "migrations", "product-logic"],
  highRisk: "auto-creates an approval request; never auto-actioned",
} as const;

/** Every learning feed the watchdogs + main loop write to. */
export function allFeeds(): string[] {
  return [MAIN_LOOP.feed, ...WATCHDOGS.map((w) => w.feed)];
}

/** Validate the manifest is internally consistent and scheduler-compatible. */
export function validateSchedule(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const isCron = (c: string): boolean => c.trim().split(/\s+/).length === 5;

  const ids = WATCHDOGS.map((w) => w.id);
  const crons = WATCHDOGS.map((w) => w.cron);
  const feeds = WATCHDOGS.map((w) => w.feed);

  if (new Set(ids).size !== ids.length) errors.push("duplicate watchdog id");
  if (new Set(crons).size !== crons.length) errors.push("duplicate cron expression");
  if (new Set(feeds).size !== feeds.length) errors.push("duplicate feed");

  for (const w of [MAIN_LOOP, ...WATCHDOGS, EXECUTIVE_REPORT]) {
    if (!isCron(w.cron)) errors.push(`invalid cron for ${w.id}: "${w.cron}"`);
  }
  for (const w of WATCHDOGS) {
    if (!w.feed.endsWith("-findings.json")) errors.push(`watchdog ${w.id} feed must end with -findings.json`);
  }
  if (EXECUTIVE_REPORT.sources.length !== 13) {
    errors.push(`Executive Report must read 13 sources, got ${EXECUTIVE_REPORT.sources.length}`);
  }

  return { ok: errors.length === 0, errors };
}
