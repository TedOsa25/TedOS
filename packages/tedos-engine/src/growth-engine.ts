// Growth Engine — make every Main Loop tick PRODUCE business value, not process
// engineering tasks. Each tick it runs the growth checklist (leads, demos,
// landing/comparison pages, supplier campaigns, LinkedIn, blog, SEO, follow-ups,
// content improvements), generates Brand-Guardian-validated content drafts, and
// puts them — credential-gated — into the SHARED Distribution Queue as
// `pending-approval`. Nothing is published/sent without credentials + approval.
//
// It reuses everything: DistributionQueue (distribution-queue.ts), Brand Guardian
// (brand-guardian.ts), Storage (storage.ts), and the revenue-first category order
// (goal-prioritization.ts). Deterministic, offline by default; the clock is
// injected. Daily quotas are tracked in Storage so a day's deliverables are
// produced once and then the engine idles until the next day.

import type { Storage } from "./storage.js";
import type { Confidence } from "./evidence.js";
import { checkContent, rotateCTA } from "./brand-guardian.js";
import type { DistributionChannel, DistributionSource, DistributionJobInput } from "./distribution-queue.js";
import { DistributionQueue } from "./distribution-queue.js";

/** The seven business priorities, revenue first (mirrors goal-prioritization). */
export type GrowthCategory =
  | "revenue" | "leads" | "demo" | "trial" | "supplier" | "traffic" | "retention";

/** Concrete deliverable kinds the loop prepares each day. */
export type GrowthKind =
  | "sales-email" | "follow-up" | "linkedin-post" | "blog"
  | "comparison-page" | "landing-page" | "supplier-campaign"
  | "seo" | "content-improvement";

/** Business value (0–10) by category — revenue weighted highest. */
const CATEGORY_VALUE: Record<GrowthCategory, number> = {
  revenue: 10, leads: 9, demo: 8, trial: 7, supplier: 6, traffic: 5, retention: 4,
};

interface KindMeta {
  category: GrowthCategory;
  channel: DistributionChannel;
  source: DistributionSource;
}

/** How each deliverable maps to a category, channel and originating watchdog. */
const KIND_META: Record<GrowthKind, KindMeta> = {
  "sales-email": { category: "leads", channel: "email", source: "sales" },
  "follow-up": { category: "demo", channel: "email", source: "sales" },
  "linkedin-post": { category: "traffic", channel: "linkedin", source: "marketing" },
  "blog": { category: "traffic", channel: "web", source: "marketing" },
  "comparison-page": { category: "leads", channel: "web", source: "growth" },
  "landing-page": { category: "trial", channel: "web", source: "growth" },
  "supplier-campaign": { category: "supplier", channel: "email", source: "customer-success" },
  "seo": { category: "traffic", channel: "web", source: "growth" },
  "content-improvement": { category: "retention", channel: "web", source: "marketing" },
};

/** Daily deliverable targets (the user's example quota). */
export const DAILY_TARGETS: Record<GrowthKind, number> = {
  "sales-email": 10, "follow-up": 5, "linkedin-post": 5, "blog": 2,
  "comparison-page": 3, "landing-page": 1, "supplier-campaign": 1,
  "seo": 3, "content-improvement": 3,
};

/** Kinds in revenue-first priority order — drives generation + the score. */
const KIND_ORDER: GrowthKind[] = [
  "sales-email", "follow-up", "comparison-page", "landing-page",
  "supplier-campaign", "linkedin-post", "blog", "seo", "content-improvement",
];

// ── Content domain (HeyCarbo ICP + topics) — deterministic, no invented facts ──
const SEGMENTS = [
  "Automotive-Zulieferer", "Maschinenbau", "Chemie & Masterbatch",
  "Logistik & Supply Chain", "Elektronik-Fertigung",
];
const TOPICS = [
  "Scope-3-Datenerfassung", "CSRD-Berichtspflicht", "Product Carbon Footprint (PCF)",
  "Catena-X-Readiness", "Lieferanten-CO₂-Management", "CBAM-Vorbereitung",
];
const COMPETITORS = ["Cozero", "Plan A", "Normative", "Sweep", "Watershed", "IntegrityNext"];

const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length] as T;

/** One prepared, brand-checked deliverable. */
export interface GrowthOpportunity {
  id: string;
  kind: GrowthKind;
  category: GrowthCategory;
  channel: DistributionChannel;
  source: DistributionSource;
  campaign: string;
  title: string;
  body: string;
  subject?: string;
  cta: string;
  businessValue: number;
  confidence: Confidence;
}

/** Deterministic content per (kind, index). Templated — no fabricated numbers. */
function buildContent(kind: GrowthKind, i: number, date: string): GrowthOpportunity {
  const meta = KIND_META[kind];
  const seg = pick(SEGMENTS, i);
  const topic = pick(TOPICS, i + 1);
  const cta = rotateCTA(i);
  const id = `growth-${date}-${kind}-${i + 1}`;
  let title = "";
  let body = "";
  let subject: string | undefined;

  switch (kind) {
    case "sales-email":
      subject = `${topic} für ${seg} — in Minuten statt Wochen`;
      title = `Sales-E-Mail: ${seg} (${topic})`;
      body = `Hallo {Name},\n\nIhre Kunden fragen zunehmend nach belastbaren CO₂-Daten auf Produkt- und Lieferantenebene. Für ${seg} bedeutet ${topic} oft wochenlange Excel-Arbeit.\n\nHeyCarbo verkürzt das auf Minuten: Daten hochladen, Hotspots sehen, sauber an Ihre Kunden zurückmelden — gebaut für den Mittelstand.\n\nHätten Sie 15 Minuten für eine kurze Demo? CTA: ${cta}.`;
      break;
    case "follow-up":
      subject = `Kurzes Follow-up: ${topic}`;
      title = `Follow-up: ${seg} (${topic})`;
      body = `Hallo {Name},\n\nich wollte kurz nachfassen — falls ${topic} bei ${seg} gerade Thema ist, zeige ich Ihnen in 15 Minuten, wie HeyCarbo den Aufwand drastisch senkt.\n\nPasst diese Woche? CTA: ${cta}.`;
      break;
    case "linkedin-post":
      title = `LinkedIn: ${topic}`;
      body = `${topic} ist für ${seg} kein Reporting-Thema mehr, sondern eine Kundenanforderung.\n\nWer Lieferanten-CO₂-Daten in Minuten liefern kann, gewinnt Ausschreibungen. Wer Wochen braucht, verliert sie.\n\nSo bereiten Sie sich vor: Daten zentral erfassen, Hotspots priorisieren, sauber berichten. CTA: ${cta}.`;
      break;
    case "blog":
      title = `Blog: ${topic} — Leitfaden für ${seg}`;
      body = `# ${topic}: praktischer Leitfaden für ${seg}\n\nDieser Artikel erklärt, wie ${seg} ${topic} ohne Beraterheer umsetzt: relevante Kategorien, typische Datenquellen, häufige Fehler und ein pragmatischer Startpunkt.\n\nFazit: mit zentraler Datenerfassung und klaren Hotspots wird ${topic} vom Projekt zur Routine. CTA: ${cta}.`;
      break;
    case "comparison-page": {
      const comp = pick(COMPETITORS, i);
      title = `Comparison Page: HeyCarbo vs ${comp}`;
      body = `# HeyCarbo vs ${comp}\n\nFür ${seg}, die ${topic} pragmatisch umsetzen wollen: ein nüchterner Vergleich der Ansätze — Datenerfassung, Lieferanteneinbindung, Time-to-Value und Eignung für den Mittelstand.\n\nHeyCarbo fokussiert auf schnelle Lieferantendaten und kurze Time-to-Value. CTA: ${cta}.`;
      break;
    }
    case "landing-page":
      title = `Landingpage: ${topic} für ${seg}`;
      body = `# ${topic} für ${seg}\n\nLaden Sie Ihre Daten hoch, sehen Sie Ihre Scope-3-Hotspots und melden Sie belastbare Werte an Ihre Kunden zurück — in Minuten.\n\nKostenlos starten, ohne Kreditkarte. CTA: ${cta}.`;
      break;
    case "supplier-campaign":
      subject = `Einladung: Ihre CO₂-Daten für die Lieferkette`;
      title = `Supplier-Kampagne: ${seg}`;
      body = `Hallo,\n\nim Rahmen von ${topic} laden wir Ihre Lieferanten ein, ihre CO₂-Daten unkompliziert über HeyCarbo bereitzustellen — kostenlos und in wenigen Minuten.\n\nSo schließen ${seg} Datenlücken in der Lieferkette. CTA: ${cta}.`;
      break;
    case "seo":
      title = `SEO: Keyword-Cluster „${topic}"`;
      body = `SEO-Opportunity: Themencluster rund um „${topic}" für ${seg} — Suchintention „Anleitung/Vergleich/Pflicht". Vorgeschlagene Inhalte: Leitfaden, FAQ, Comparison Page. Interne Verlinkung auf die Demo. CTA: ${cta}.`;
      break;
    case "content-improvement":
      title = `Content-Verbesserung: ${topic}-Seite`;
      body = `Bestehende Inhalte zu „${topic}" für ${seg} aktualisieren: klarere H1, konkreter Nutzen für den Mittelstand, aktuelle Regulatorik, stärkerer CTA. CTA: ${cta}.`;
      break;
  }

  const check = checkContent(body);
  return {
    id, kind, category: meta.category, channel: meta.channel, source: meta.source,
    campaign: `${meta.category}-${topic}`.toLowerCase().replace(/\s+/g, "-"),
    title, body: check.corrected, ...(subject ? { subject } : {}), cta,
    businessValue: CATEGORY_VALUE[meta.category],
    // High only when there is real account/evidence data; offline → low (ICP template).
    confidence: "low",
  };
}

/** The extended per-tick business report (the new logging the user asked for). */
export interface GrowthTickResult {
  generated: number;
  queuedForApproval: number;
  revenueOpportunities: number;
  newCampaigns: number;
  salesEmails: number;
  marketingAssets: number;
  websiteImprovements: number;
  seoOpportunities: number;
  contentOpportunities: number;
  supplierOpportunities: number;
  businessImpactScore: number;
  byKind: Partial<Record<GrowthKind, number>>;
  opportunities: GrowthOpportunity[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface GrowthEngineOptions {
  clock?: () => string;
  /** Override daily targets (tests/demo). */
  targets?: Partial<Record<GrowthKind, number>>;
  /** Max items generated per tick, so a day's quota spreads across ticks. */
  perTickCap?: number;
}

/**
 * GrowthEngine generates the day's business deliverables, brand-checks them, and
 * enqueues them credential-gated into the shared Distribution Queue.
 */
export class GrowthEngine {
  private readonly clock: () => string;
  private readonly targets: Record<GrowthKind, number>;
  private readonly perTickCap: number;

  constructor(
    private readonly queue: DistributionQueue,
    private readonly storage: Storage,
    opts: GrowthEngineOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.targets = { ...DAILY_TARGETS, ...opts.targets };
    this.perTickCap = opts.perTickCap ?? 8;
  }

  /** What has been produced today, by kind (Storage-backed, per-date bucket). */
  private producedKey(date: string): string {
    return `growth-produced-${date}`;
  }

  /** Run the growth pass for one tick. Produces up to the daily quota, then idles. */
  run(): GrowthTickResult {
    const date = this.clock().slice(0, 10);
    const key = this.producedKey(date);
    const produced = this.storage.load<Record<string, number>>(key) ?? {};
    const opportunities: GrowthOpportunity[] = [];
    let madeThisTick = 0;

    for (const kind of KIND_ORDER) {
      const target = this.targets[kind];
      let made = produced[kind] ?? 0;
      while (made < target && madeThisTick < this.perTickCap) {
        const opp = buildContent(kind, made, date);
        const job: DistributionJobInput = {
          id: opp.id, source: opp.source, channel: opp.channel, campaign: opp.campaign,
          title: opp.title, body: opp.body, cta: opp.cta,
          ...(opp.subject ? { subject: opp.subject } : {}),
        };
        this.queue.enqueue(job); // pending-approval; credential-gated; never auto-sent
        opportunities.push(opp);
        made += 1;
        madeThisTick += 1;
      }
      produced[kind] = made;
    }

    this.storage.save(key, produced);
    return this.summarize(opportunities);
  }

  private summarize(opps: GrowthOpportunity[]): GrowthTickResult {
    const byKind: Partial<Record<GrowthKind, number>> = {};
    for (const o of opps) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    const n = (k: GrowthKind): number => byKind[k] ?? 0;
    const score = round2(opps.reduce((s, o) => s + o.businessValue, 0));
    return {
      generated: opps.length,
      queuedForApproval: opps.length,
      revenueOpportunities: opps.filter((o) => o.category === "revenue" || o.category === "leads" || o.category === "demo").length,
      newCampaigns: n("supplier-campaign") + n("comparison-page") + n("landing-page"),
      salesEmails: n("sales-email") + n("follow-up"),
      marketingAssets: n("linkedin-post") + n("blog"),
      websiteImprovements: n("landing-page") + n("content-improvement"),
      seoOpportunities: n("seo"),
      contentOpportunities: n("blog") + n("linkedin-post") + n("content-improvement"),
      supplierOpportunities: n("supplier-campaign"),
      businessImpactScore: score,
      byKind,
      opportunities: opps,
    };
  }
}
