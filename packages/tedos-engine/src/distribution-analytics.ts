// Distribution Analytics + Learning + the Executive-Report distribution section.
//
// After each publish/send the engine captures per-job metrics. Metrics come from
// an injected `MetricsProvider` (a real analytics connector, or the demo/tests);
// when none is available the metrics are explicitly zero / low-confidence — the
// same no-fabrication rule as the Evidence Layer's SampleProvider. It then
// aggregates: which channel / CTA / subject / hour / campaign wins (Learning),
// and the campaign ROI table the Executive Report shows. Persistence reuses the
// existing `Storage`; the shape mirrors the existing analytics/*.json sinks.
// Deterministic.

import type { Storage } from "./storage.js";
import type { Confidence } from "./evidence.js";
import type { DistributionChannel, DistributionJob, DistributionSource } from "./distribution-queue.js";

/** Per-publication metrics. Channel-specific fields are 0 when not applicable. */
export interface DistributionMetrics {
  jobId: string;
  campaign: string;
  source: DistributionSource;
  channel: DistributionChannel;
  // Social / web reach.
  impressions: number;
  clicks: number;
  engagements: number; // likes + comments + shares + saves
  newFollowers: number;
  // Email.
  opens: number;
  replies: number;
  bounces: number;
  unsubscribes: number;
  // Website + CRM attribution.
  websiteTraffic: number;
  conversions: number;
  leads: number;
  demoBookings: number;
  trialSignups: number;
  supplierActivations: number;
  revenue: number;
  timestamp: string;
  confidence: Confidence;
}

/** Supplies live metrics for a published job, or undefined when none exist. */
export type MetricsProvider = (job: DistributionJob) => Partial<DistributionMetrics> | undefined;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const ZERO = {
  impressions: 0, clicks: 0, engagements: 0, newFollowers: 0,
  opens: 0, replies: 0, bounces: 0, unsubscribes: 0,
  websiteTraffic: 0, conversions: 0, leads: 0, demoBookings: 0,
  trialSignups: 0, supplierActivations: 0, revenue: 0,
};

/**
 * Capture metrics for a published/sent job. With no live provider the row is
 * all-zero and `confidence: "low"` — never an invented number.
 */
export function captureMetrics(
  job: DistributionJob,
  provider: MetricsProvider | undefined,
  clock: () => string,
): DistributionMetrics {
  const live = provider?.(job);
  return {
    jobId: job.id,
    campaign: job.campaign,
    source: job.source,
    channel: job.channel,
    ...ZERO,
    ...(live ?? {}),
    timestamp: clock(),
    confidence: live ? "high" : "low",
  };
}

const KEY = "distribution-metrics";

/** Appends distribution metrics to the existing Storage (same shape as the JSON sinks). */
export class DistributionAnalyticsStore {
  constructor(private readonly storage: Storage) {}

  all(): DistributionMetrics[] {
    return this.storage.load<DistributionMetrics[]>(KEY) ?? [];
  }

  record(metrics: DistributionMetrics): void {
    this.storage.save(KEY, [...this.all(), metrics]);
  }

  recordMany(metrics: DistributionMetrics[]): void {
    if (metrics.length === 0) return;
    this.storage.save(KEY, [...this.all(), ...metrics]);
  }

  byCampaign(campaign: string): DistributionMetrics[] {
    return this.all().filter((m) => m.campaign === campaign);
  }
}

// ─── Learning: which content wins ────────────────────────────────────────────

/** The dimensions distribution learning aggregates over. */
export type LearningDimension = "channel" | "cta" | "subject" | "hour" | "source" | "campaign";

/** One learning row: how a dimension value performs across publications. */
export interface DistributionLearning {
  dimension: LearningDimension;
  key: string;
  posts: number;
  avgEngagement: number;
  conversions: number;
  leads: number;
  revenue: number;
  confidence: Confidence;
}

/** First word(s) of a subject line, lowercased — the "subject pattern" key. */
function subjectKey(subject: string | undefined): string | null {
  if (!subject) return null;
  return subject.trim().toLowerCase().split(/\s+/).slice(0, 3).join(" ") || null;
}

/** Hour-of-day bucket from an ISO timestamp (UTC), e.g. "14:00". */
function hourKey(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return `${String(new Date(t).getUTCHours()).padStart(2, "0")}:00`;
}

/**
 * Aggregate metrics (joined to their jobs for CTA/subject) into per-dimension
 * learning rows, sorted best-first within each dimension. Feeds future campaigns.
 */
export function learnFromMetrics(
  metrics: readonly DistributionMetrics[],
  jobs: readonly DistributionJob[],
): DistributionLearning[] {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const groups = new Map<string, { dim: LearningDimension; key: string; rows: DistributionMetrics[] }>();

  const add = (dim: LearningDimension, key: string | null, m: DistributionMetrics): void => {
    if (key === null) return;
    const id = `${dim}::${key}`;
    const g = groups.get(id) ?? { dim, key, rows: [] };
    g.rows.push(m);
    groups.set(id, g);
  };

  for (const m of metrics) {
    const job = jobById.get(m.jobId);
    add("channel", m.channel, m);
    add("source", m.source, m);
    add("campaign", m.campaign, m);
    add("cta", job?.cta ?? null, m);
    add("subject", subjectKey(job?.subject), m);
    add("hour", hourKey(m.timestamp), m);
  }

  const learnings = [...groups.values()].map(({ dim, key, rows }) => {
    const posts = rows.length;
    const engagement = rows.reduce((s, r) => s + r.engagements + r.clicks + r.opens + r.replies, 0);
    return {
      dimension: dim,
      key,
      posts,
      avgEngagement: round2(engagement / posts),
      conversions: rows.reduce((s, r) => s + r.conversions, 0),
      leads: rows.reduce((s, r) => s + r.leads, 0),
      revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      confidence: rows.some((r) => r.confidence === "high") ? "high" : "low",
    } as DistributionLearning;
  });

  return learnings.sort(
    (a, b) => b.conversions - a.conversions || b.revenue - a.revenue || b.avgEngagement - a.avgEngagement,
  );
}

const LEARN_KEY = "distribution-learnings";

/** Persists distribution learnings via the existing Storage (reuses Learning home). */
export class DistributionLearningStore {
  constructor(private readonly storage: Storage) {}
  all(): DistributionLearning[] {
    return this.storage.load<DistributionLearning[]>(LEARN_KEY) ?? [];
  }
  replace(learnings: DistributionLearning[]): void {
    this.storage.save(LEARN_KEY, learnings);
  }
}

// ─── Executive Report — Distribution section ─────────────────────────────────

/** Campaign-level ROI row for the Executive Report. */
export interface CampaignRoi {
  campaign: string;
  posts: number;
  engagement: number;
  conversions: number;
  leads: number;
  revenue: number;
  /** Revenue per published item (organic proxy ROI); 0 without live data. */
  roi: number;
  confidence: Confidence;
}

/** The Executive Report's Distribution section. */
export interface DistributionSection {
  publishedPosts: number;
  sentEmails: number;
  activeCampaigns: number;
  newLeads: number;
  demoBookings: number;
  trialSignups: number;
  supplierActivations: number;
  topCampaigns: CampaignRoi[];
  worstCampaigns: CampaignRoi[];
  roiPerCampaign: CampaignRoi[];
  confidence: Confidence;
}

function campaignRois(metrics: readonly DistributionMetrics[]): CampaignRoi[] {
  const byCampaign = new Map<string, DistributionMetrics[]>();
  for (const m of metrics) {
    const arr = byCampaign.get(m.campaign) ?? [];
    arr.push(m);
    byCampaign.set(m.campaign, arr);
  }
  return [...byCampaign.entries()].map(([campaign, rows]) => {
    const posts = rows.length;
    const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
    return {
      campaign,
      posts,
      engagement: rows.reduce((s, r) => s + r.engagements + r.clicks, 0),
      conversions: rows.reduce((s, r) => s + r.conversions, 0),
      leads: rows.reduce((s, r) => s + r.leads, 0),
      revenue,
      roi: posts ? round2(revenue / posts) : 0,
      confidence: rows.some((r) => r.confidence === "high") ? "high" : "low",
    } as CampaignRoi;
  });
}

/** Build the Executive Report's Distribution section from jobs + captured metrics. */
export function buildDistributionSection(
  jobs: readonly DistributionJob[],
  metrics: readonly DistributionMetrics[],
): DistributionSection {
  const published = jobs.filter((j) => j.status === "published");
  const sent = jobs.filter((j) => j.status === "sent");
  const distributed = [...published, ...sent];
  const rois = campaignRois(metrics).sort(
    (a, b) => b.revenue - a.revenue || b.conversions - a.conversions || b.engagement - a.engagement,
  );
  const sum = (f: (m: DistributionMetrics) => number): number => metrics.reduce((s, m) => s + f(m), 0);
  const hasLive = metrics.some((m) => m.confidence === "high");
  return {
    publishedPosts: published.length,
    sentEmails: sent.length,
    activeCampaigns: new Set(distributed.map((j) => j.campaign)).size,
    newLeads: sum((m) => m.leads),
    demoBookings: sum((m) => m.demoBookings),
    trialSignups: sum((m) => m.trialSignups),
    supplierActivations: sum((m) => m.supplierActivations),
    topCampaigns: rois.slice(0, 3),
    worstCampaigns: hasLive ? [...rois].reverse().slice(0, 3) : [],
    roiPerCampaign: rois,
    confidence: hasLive ? "high" : "low",
  };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Render the Distribution section as Executive-Report text. */
export function renderDistributionSection(d: DistributionSection): string {
  const lines: string[] = [];
  lines.push("## Distribution");
  lines.push(`Confidence: ${cap(d.confidence)}`);
  if (d.confidence === "low") {
    lines.push("(No live analytics connector — engagement figures pending. See docs/connectors-setup.md.)");
  }
  lines.push(
    `Published posts: ${d.publishedPosts} · Sent emails: ${d.sentEmails} · Active campaigns: ${d.activeCampaigns}`,
  );
  lines.push(
    `New leads: ${d.newLeads} · Demo bookings: ${d.demoBookings} · Trial signups: ${d.trialSignups} · Supplier activations: ${d.supplierActivations}`,
  );
  const camp = (c: CampaignRoi): string =>
    `${c.campaign} — ${c.posts} item(s) · engagement ${c.engagement} · conv ${c.conversions} · leads ${c.leads} · rev ${c.revenue} · ROI ${c.roi} (${cap(c.confidence)})`;
  lines.push("", "### Top campaigns", d.topCampaigns.length ? d.topCampaigns.map((c) => `  • ${camp(c)}`).join("\n") : "  • none");
  lines.push("", "### Worst campaigns", d.worstCampaigns.length ? d.worstCampaigns.map((c) => `  • ${camp(c)}`).join("\n") : "  • none");
  return lines.join("\n");
}
