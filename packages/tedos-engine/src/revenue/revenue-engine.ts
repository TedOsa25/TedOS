// Revenue Engine V1 — turn REAL accounts into ready-to-approve outreach.
//
// Each tick: take the next highest-priority real accounts (revenue → ICP →
// buying intent), and for each generate a personalized HTML email (3 subjects,
// preview text), a LinkedIn message, two follow-ups and an account summary — all
// filled from the account's REAL fields (company, industry, pain points, contact,
// certifications). Everything runs through quality gates (Brand · Tonality ·
// Spam · Compliance → Quality Score); only passing content is queued —
// credential-gated — into the shared Distribution/Approval queue. Nothing is
// sent. Deterministic, offline; clock + accounts injected for tests.

import type { Storage } from "./../storage.js";
import { checkContent } from "./../brand-guardian.js";
import { DistributionQueue, type DistributionJobInput } from "./../distribution-queue.js";
import { type Account, loadAccounts, prioritize } from "./accounts.js";
import { type BannerRef, bannerFor, bannerGaps } from "./banners.js";

/** Campaign types, chosen from the account's real relevance/pain signals. */
export type CampaignType =
  | "supplier-management" | "scope-3" | "pcf" | "csrd"
  | "catena-x" | "esg" | "supplier-data" | "document-management";

const CAMPAIGN_VALUE: Record<CampaignType, string> = {
  "supplier-management": "Lieferanten-CO₂-Daten zentral erfassen und Datenlücken in der Lieferkette schließen",
  "scope-3": "Scope-3-Hotspots in Minuten sichtbar machen statt wochenlanger Excel-Arbeit",
  "pcf": "auditierbare Product Carbon Footprints (ISO 14067) ohne Beraterheer erstellen",
  "csrd": "CSRD-relevante Kennzahlen konsolidiert und prüfungssicher bereitstellen",
  "catena-x": "Catena-X-/PCF-Anforderungen Ihrer OEM-Kunden erfüllen",
  "esg": "ESG-/EcoVadis-/CDP-Anfragen schneller und konsistent beantworten",
  "supplier-data": "Primärdaten von Lieferanten unkompliziert einsammeln",
  "document-management": "Nachhaltigkeitsnachweise zentral und revisionssicher verwalten",
};

/** A relevance field counts as a signal when it's present and not "low/none". */
const relevant = (v: string | undefined): boolean => !!v && /high|hoch|mittel|medium|yes|ja|true|relevant/i.test(v);

/** Choose the campaign from the account's real signals (deterministic). */
export function selectCampaign(a: Account): CampaignType {
  // Structured relevance fields first…
  if (relevant(a.catenaXRelevance)) return "catena-x";
  if (relevant(a.pcfRelevance)) return "pcf";
  if (relevant(a.csrdRelevance)) return "csrd";
  // …then keywords in the free-text pain/pressure signals.
  const hay = `${a.supplierPressure ?? ""} ${a.painPoints.join(" ")}`.toLowerCase();
  if (/catena|pact|wbcsd/.test(hay)) return "catena-x";
  if (/pcf|14067|product carbon|cradle/.test(hay)) return "pcf";
  if (/csrd|esrs|berichtspflicht/.test(hay)) return "csrd";
  if (/lieferant|supplier|supply chain|scope ?3/.test(hay)) return "supplier-management";
  if (/ecovadis|cdp|esg|questionnaire|fragebogen/.test(hay)) return "esg";
  return "scope-3";
}

/** Result of the four quality gates + a composite score. */
export interface QualityResult {
  brand: boolean;
  tonality: boolean;
  spam: boolean;
  compliance: boolean;
  qualityScore: number;
  passed: boolean;
  issues: string[];
}

const SALESY = ["garantiert", "beste lösung", "nr. 1", "weltweit führend", "marktführer", "unschlagbar", "konkurrenzlos"];
const SPAM_RE = [/!{2,}/, /\bgratis\b/i, /jetzt kaufen/i, /\$\$\$/, /100\s*% kostenlos/i, /klicken sie hier/i];

function gateBrand(t: string): { ok: boolean; issues: string[] } {
  const c = checkContent(t);
  return { ok: c.ok, issues: c.ok ? [] : ["brand: greenwashing/unverifiable claim"] };
}
function gateTonality(t: string): { ok: boolean; issues: string[] } {
  const l = t.toLowerCase();
  const hit = SALESY.find((s) => l.includes(s));
  return { ok: !hit, issues: hit ? [`tonality: salesy phrase "${hit}"`] : [] };
}
function gateSpam(t: string): { ok: boolean; issues: string[] } {
  const re = SPAM_RE.find((r) => r.test(t));
  if (re) return { ok: false, issues: ["spam: trigger phrase"] };
  // "Shouting" = 3+ consecutive all-caps words. Isolated acronyms (ISO, OEM,
  // PCF) and all-caps company names (GRAFE) are legitimate and not flagged.
  const shouting = /\b[A-ZÄÖÜ]{3,}\b(?:\s+\b[A-ZÄÖÜ]{3,}\b){2,}/.test(t);
  return { ok: !shouting, issues: shouting ? ["spam: shouting (all-caps run)"] : [] };
}
function gateCompliance(t: string): { ok: boolean; issues: string[] } {
  // No quantified savings promise we cannot substantiate.
  const bad = /\b(spart|reduzier\w*|senkt|saves?)\b.{0,24}\d+\s*%/i.test(t);
  return { ok: !bad, issues: bad ? ["compliance: unsubstantiated quantified claim"] : [] };
}

/** Run all gates over the account's key copy (email + linkedin + follow-ups). */
export function qualityCheck(texts: string[]): QualityResult {
  const joined = texts.join("\n\n");
  const b = gateBrand(joined), t = gateTonality(joined), s = gateSpam(joined), c = gateCompliance(joined);
  const issues = [...b.issues, ...t.issues, ...s.issues, ...c.issues];
  const passes = [b.ok, t.ok, s.ok, c.ok].filter(Boolean).length;
  const qualityScore = Math.round((passes / 4) * 100);
  return { brand: b.ok, tonality: t.ok, spam: s.ok, compliance: c.ok, qualityScore, passed: issues.length === 0, issues };
}

/** Everything prepared for one real account. */
export interface RevenueOpportunity {
  accountId: string;
  company: string;
  industry: string;
  contactTitle?: string;
  email?: string;
  campaign: CampaignType;
  subjects: string[];
  previewText: string;
  emailHtml: string;
  linkedin: string;
  followUp1: string;
  followUp2: string;
  summary: string;
  banner: BannerRef;
  quality: QualityResult;
  fitScore: number;
  revenueScore: number;
  buyingIntent: number;
  priority: number;
  createdAt: string;
}

const firstName = (title: string | undefined): string => (title ? title.split(/[/·,]/)[0]!.trim() : "Nachhaltigkeitsverantwortliche:r");
const SIGNATURE = (banner: BannerRef): string =>
  `<table cellpadding="0" cellspacing="0"><tr><td style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#1c1917">` +
  `<strong>Ted Osammor</strong><br>Founder · HeyCarbo<br>` +
  `<a href="https://heycarbo.com" style="color:#0d9488">heycarbo.com</a><br>` +
  `<img src="${banner.url}" alt="HeyCarbo" width="500" style="margin-top:8px;max-width:100%"></td></tr></table>`;

/** Build all artifacts for one account from its REAL data. */
export function buildOpportunity(a: Account, clock: () => string): RevenueOpportunity {
  const campaign = selectCampaign(a);
  const banner = bannerFor(a.industry);
  // Use a SHORT clause of the real pain (first sentence, trimmed) — tighter copy
  // and avoids embedding multi-paragraph narratives verbatim.
  const rawPain = a.painPoints[0] ?? `${campaign}-Anforderungen Ihrer Kunden`;
  const pain = (rawPain.split(/[.;|]/)[0] ?? rawPain).slice(0, 160).trim();
  const value = CAMPAIGN_VALUE[campaign];
  const contact = firstName(a.contactTitle);

  const intro = `Hallo ${contact},\n\nals ${a.industry}-Unternehmen steht ${a.company} zunehmend unter Druck, belastbare CO₂-Daten gegenüber Kunden und Regulatorik zu liefern.`;
  const painLine = `Konkret beobachten wir bei vergleichbaren Unternehmen: ${pain}`;
  const why = `Genau hier setzt HeyCarbo an: ${value}. Aufgebaut für den Mittelstand, nicht für Berater.`;
  const cta = "Demo buchen";

  const emailHtml =
    `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1c1917">` +
    `<p>${intro.replace(/\n/g, "<br>")}</p>` +
    `<p>${painLine}</p>` +
    `<p>${why}</p>` +
    `<p><img src="${banner.url}" alt="${a.industry}" width="500" style="max-width:100%;border-radius:8px"></p>` +
    `<p><a href="https://heycarbo.com/demo" style="background:#0d9488;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${cta}</a></p>` +
    `<p><strong>14 Tage kostenlos testen</strong> – ohne Kreditkarte.</p>` +
    SIGNATURE(banner) + `</div>`;

  const subjects = [
    `${a.company}: CO₂-Daten in Minuten statt Wochen`,
    `${a.industry} & Scope 3 — kurze Frage`,
    `Belastbare Lieferantendaten für ${a.company}?`,
  ];
  const previewText = `${value} — in Minuten statt Wochen.`;
  const linkedin = `Hallo ${contact}, ich verfolge, wie ${a.industry}-Unternehmen wie ${a.company} das Thema CO₂-/Scope-3-Daten angehen. Falls das bei Ihnen gerade Thema ist, tausche ich mich gern kurz aus — ganz unverbindlich.`;
  const followUp1 = `Hallo ${contact}, ich wollte kurz nachfassen — falls ${pain.toLowerCase()} bei ${a.company} relevant ist, zeige ich in 15 Minuten, wie HeyCarbo den Aufwand senkt. Passt diese Woche?`;
  const followUp2 = `Hallo ${contact}, ich lasse es für heute dabei. Wenn ${campaign}-Themen für ${a.company} später relevant werden, melden Sie sich gern. Hier ein kurzer Leitfaden zum Einstieg: heycarbo.com/scope3.`;
  const summary =
    `Warum HeyCarbo passt: ${a.industry}, Fit ${a.fitScore}/100, Revenue-Potenzial ${a.revenueScore}/100. ` +
    `Größter vermuteter Pain: ${pain}. Kampagne „${campaign}" gewählt, weil die realen Signale (Relevanz/Pain) darauf zeigen.`;

  const quality = qualityCheck([emailHtml, linkedin, followUp1, followUp2, ...subjects]);
  return {
    accountId: a.id, company: a.company, industry: a.industry,
    ...(a.contactTitle ? { contactTitle: a.contactTitle } : {}),
    ...(a.email ? { email: a.email } : {}),
    campaign, subjects, previewText, emailHtml, linkedin, followUp1, followUp2, summary, banner, quality,
    fitScore: a.fitScore, revenueScore: a.revenueScore, buyingIntent: a.buyingIntent, priority: a.priority,
    createdAt: clock(),
  };
}

/** The morning "Revenue Center" view — what TedOS prepared, ready to approve. */
export interface RevenueCenter {
  date: string;
  dataAvailable: boolean;
  accountsAnalyzed: number;
  accountsPrioritized: number;
  emailsCreated: number;
  followUpsCreated: number;
  linkedinCreated: number;
  bannersSelected: number;
  campaignsPrepared: number;
  readyToSend: number;
  businessImpactScore: number;
  bannerGaps: string[];
  topOpportunities: { company: string; industry: string; campaign: CampaignType; revenueScore: number; fitScore: number }[];
  /** Set when no real accounts could be loaded — the actionable data gap. */
  missingData?: string;
}

const KEY_DONE = (date: string): string => `revenue-produced-${date}`;
const KEY_OPPS = "revenue-opportunities";

export interface RevenueEngineOptions {
  accounts?: Account[];
  accountsPath?: string;
  clock?: () => string;
  dailyTarget?: number;
  perTickCap?: number;
}

export class RevenueEngine {
  private readonly accounts: Account[];
  private readonly clock: () => string;
  private readonly dailyTarget: number;
  private readonly perTickCap: number;

  constructor(
    private readonly queue: DistributionQueue,
    private readonly storage: Storage,
    opts: RevenueEngineOptions = {},
  ) {
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.dailyTarget = opts.dailyTarget ?? 40;
    this.perTickCap = opts.perTickCap ?? 8;
    const loaded = opts.accounts ?? loadAccounts(opts.accountsPath);
    this.accounts = prioritize(loaded);
  }

  /** All opportunities prepared so far (for the Revenue Center / inspection). */
  opportunities(): RevenueOpportunity[] {
    return this.storage.load<RevenueOpportunity[]>(KEY_OPPS) ?? [];
  }

  /** Run the revenue pass for one tick: prepare the next batch toward the daily quota. */
  run(): RevenueCenter {
    const date = this.clock().slice(0, 10);
    if (this.accounts.length === 0) {
      return {
        date, dataAvailable: false, accountsAnalyzed: 0, accountsPrioritized: 0,
        emailsCreated: 0, followUpsCreated: 0, linkedinCreated: 0, bannersSelected: 0,
        campaignsPrepared: 0, readyToSend: 0, businessImpactScore: 0, bannerGaps: [],
        topOpportunities: [],
        missingData: `No real accounts loaded — set REVENUE_ACCOUNTS_PATH to Sales/crm-heycarbo/leads.js (never fabricated).`,
      };
    }

    const doneKey = KEY_DONE(date);
    const done = new Set(this.storage.load<string[]>(doneKey) ?? []);
    const batch: RevenueOpportunity[] = [];
    for (const a of this.accounts) {
      if (done.size >= this.dailyTarget || batch.length >= this.perTickCap) break;
      if (done.has(a.id)) continue;
      const opp = buildOpportunity(a, this.clock);
      done.add(a.id);
      if (!opp.quality.passed) continue; // analyzed, but not ready — never queued
      this.enqueue(opp);
      batch.push(opp);
    }

    this.storage.save(doneKey, [...done]);
    if (batch.length) this.storage.save(KEY_OPPS, [...this.opportunities(), ...batch]);
    return this.center(date, batch, done.size);
  }

  /** Queue the sendable artifacts, credential-gated, as pending-approval. */
  private enqueue(o: RevenueOpportunity): void {
    const base = { campaign: `${o.campaign}-${o.industry}`.toLowerCase().replace(/\s+/g, "-"), source: "sales" as const };
    const subj = o.subjects[0] ?? `${o.company}: CO₂-Daten`;
    const to = o.email ? { recipient: o.email } : {};
    const jobs: DistributionJobInput[] = [
      { id: `rev-${o.accountId}-email`, channel: "email", title: `E-Mail · ${o.company}`, body: o.emailHtml, subject: subj, cta: "Demo buchen", ...to, ...base },
      { id: `rev-${o.accountId}-linkedin`, channel: "linkedin", title: `LinkedIn · ${o.company}`, body: o.linkedin, ...base },
      { id: `rev-${o.accountId}-fu1`, channel: "email", title: `Follow-up 1 · ${o.company}`, body: o.followUp1, subject: `Re: ${subj}`, ...to, ...base },
      { id: `rev-${o.accountId}-fu2`, channel: "email", title: `Follow-up 2 · ${o.company}`, body: o.followUp2, subject: `Re: ${subj}`, ...to, ...base },
    ];
    for (const j of jobs) this.queue.enqueue(j);
  }

  private center(date: string, batch: RevenueOpportunity[], analyzedTotal: number): RevenueCenter {
    const ready = batch; // batch only contains passed opportunities
    const score = Math.round(ready.reduce((s, o) => s + o.revenueScore * 0.6 + o.fitScore * 0.4, 0) / 10);
    return {
      date,
      dataAvailable: true,
      accountsAnalyzed: analyzedTotal,
      accountsPrioritized: this.accounts.length,
      emailsCreated: ready.length,
      followUpsCreated: ready.length * 2,
      linkedinCreated: ready.length,
      bannersSelected: ready.length,
      campaignsPrepared: new Set(ready.map((o) => o.campaign)).size,
      readyToSend: ready.length,
      businessImpactScore: score,
      bannerGaps: bannerGaps(ready.map((o) => o.industry)),
      topOpportunities: ready.slice(0, 5).map((o) => ({ company: o.company, industry: o.industry, campaign: o.campaign, revenueScore: o.revenueScore, fitScore: o.fitScore })),
    };
  }
}
