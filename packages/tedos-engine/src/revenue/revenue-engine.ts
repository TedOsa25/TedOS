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
import { EMAIL_ASSETS, EMAIL_BANNER, renderEmail } from "./email-template.js";

/** A referenced banner asset (the central email banner). */
export interface BannerRef {
  industry: string;
  asset: string;
  url: string;
  industrySpecific: boolean;
}

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

/** Result of the quality gates + the numeric scores shown in the Revenue Center. */
export interface QualityResult {
  brand: boolean;
  tonality: boolean;
  spam: boolean;
  compliance: boolean;
  generic: boolean;
  repetition: boolean;
  concise: boolean;
  qualityScore: number; // composite of all gates (0–100)
  spamScore: number; // 0 clean … 100 spammy
  brandScore: number; // 0 … 100 on-brand
  passed: boolean;
  issues: string[];
}

const SALESY = ["garantiert", "beste lösung", "nr. 1", "weltweit führend", "marktführer", "unschlagbar", "konkurrenzlos"];
const SPAM_RE = [/!{2,}/, /\bgratis\b/i, /jetzt kaufen/i, /\$\$\$/, /100\s*% kostenlos/i, /klicken sie hier/i];
const GENERIC = ["viele unternehmen", "unsere kunden", "wir sprechen häufig", "oft sehen wir", "in der heutigen", "zahlreiche firmen", "unternehmen wie ihres"];
/** Max words in the personalized body so it reads in under 30 seconds. */
const MAX_BODY_WORDS = 130;

const G = (ok: boolean, issue: string) => ({ ok, issues: ok ? [] : [issue] });

function gateBrand(t: string) { return G(checkContent(t).ok, "brand: greenwashing/unverifiable claim"); }
function gateTonality(t: string) { const h = SALESY.find((s) => t.toLowerCase().includes(s)); return G(!h, `tonality: salesy phrase "${h}"`); }
function gateCompliance(t: string) { return G(!/\b(spart|reduzier\w*|senkt|saves?)\b.{0,24}\d+\s*%/i.test(t), "compliance: unsubstantiated quantified claim"); }
function gateGeneric(t: string) { const h = GENERIC.find((g) => t.toLowerCase().includes(g)); return G(!h, `generic phrase "${h}"`); }
function gateRepetition(t: string) {
  const sents = t.split(/[.!?]\s+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 24);
  const seen = new Set<string>(); let rep = false;
  for (const s of sents) { if (seen.has(s)) rep = true; seen.add(s); }
  return G(!rep, "repetition: duplicate sentence");
}
function gateConcise(body: string) { const w = body.trim().split(/\s+/).filter(Boolean).length; return G(w <= MAX_BODY_WORDS, `too long (${w} words, >${MAX_BODY_WORDS})`); }

function computeSpamScore(t: string): number {
  let s = 0;
  if (SPAM_RE.some((r) => r.test(t))) s += 50;
  s += (t.match(/!/g) ?? []).length * 8;
  if (/\b[A-ZÄÖÜ]{3,}\b(?:\s+\b[A-ZÄÖÜ]{3,}\b){2,}/.test(t)) s += 30; // shouting (all-caps run)
  return Math.min(100, s);
}

/**
 * Quality gates over the personalized copy. `body` (the email's personalized
 * text) drives the conciseness + repetition checks; everything else runs over
 * all copy. Returns the gates plus the spam/brand scores the UI displays.
 */
export function qualityCheck(texts: string[], body?: string): QualityResult {
  const joined = texts.join("\n\n");
  const bodyText = body ?? joined;
  const b = gateBrand(joined), t = gateTonality(joined), c = gateCompliance(joined), g = gateGeneric(joined);
  const rep = gateRepetition(bodyText), con = gateConcise(bodyText);
  const spamScore = computeSpamScore(joined);
  const spam = spamScore < 30;
  const brandScore = Math.max(0, 100 - (b.ok ? 0 : 50) - (t.ok ? 0 : 25) - (c.ok ? 0 : 20) - (g.ok ? 0 : 15));
  const gates = [b.ok, t.ok, spam, c.ok, g.ok, rep.ok, con.ok];
  const issues = [...b.issues, ...t.issues, ...(spam ? [] : [`spam score ${spamScore}`]), ...c.issues, ...g.issues, ...rep.issues, ...con.issues];
  return {
    brand: b.ok, tonality: t.ok, spam, compliance: c.ok, generic: g.ok, repetition: rep.ok, concise: con.ok,
    qualityScore: Math.round((gates.filter(Boolean).length / gates.length) * 100),
    spamScore, brandScore, passed: issues.length === 0, issues,
  };
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
  /** Main CTA (turquoise button) — text + target. */
  ctaText: string;
  ctaUrl: string;
  quality: QualityResult;
  /** How specifically the copy references this company's real signals (0–100). */
  personalizationScore: number;
  /** How much real intelligence we hold on the account (0–100). */
  confidenceScore: number;
  fitScore: number;
  revenueScore: number;
  buyingIntent: number;
  priority: number;
  createdAt: string;
}

/** Named OEMs mentioned in the real supplier-pressure signal (up to 3). */
const OEM_RE = /\b(BMW|VW|Volkswagen|Daimler|Mercedes|Audi|Porsche|Bosch|ZF|Continental|Stellantis|Ford|Toyota|Renault|Volvo|Tesla|Magna|Valeo)\b/gi;
function namedOems(sp: string | undefined): string | null {
  if (!sp) return null;
  const m = sp.match(OEM_RE);
  if (!m) return null;
  return Array.from(new Set(m.map((x) => (x.toUpperCase() === "VOLKSWAGEN" ? "VW" : x.toUpperCase())))).slice(0, 3).join(", ");
}

/**
 * The personalized opener — weaves 2–3 SPECIFIC real signals (OEM relationships,
 * certifications, products, customers, Catena-X/PCF/CSRD relevance) so it reads
 * like an AE wrote it after a 10-minute research. Derived ONLY from real fields;
 * no generic phrasing, no invented facts. Always follows "Guten Tag,".
 */
function personalizedIntro(a: Account): string {
  const oems = namedOems(a.supplierPressure);
  const cert = a.certifications[0];
  // Sentence 1 — the most specific real hook available.
  let s1: string;
  if (oems) {
    s1 = `wir haben gesehen, dass ${a.company} als Zulieferer u. a. für ${oems} produziert — und genau diese OEMs verlangen inzwischen ISO-14067-konforme PCF-Daten entlang Catena-X.`;
  } else if (cert && a.products) {
    s1 = `mit Ihrer ${cert}-Zertifizierung und dem Fokus auf ${a.products} steht ${a.company} unter wachsendem Druck, CO₂-Daten auf Produkt- und Lieferantenebene nachzuweisen.`;
  } else if (cert) {
    s1 = `da ${a.company} ${cert}-zertifiziert ist, sind belastbare CO₂- und Nachhaltigkeitsdaten für Sie ohnehin geschäftskritisch.`;
  } else if (a.products) {
    s1 = `uns ist aufgefallen, dass ${a.company} mit ${a.products} in einem Segment tätig ist, in dem Kunden zunehmend Scope-3-Daten anfragen.`;
  } else if (a.catenaXRelevance) {
    s1 = `da ${a.company} im Catena-X-/Automotive-Umfeld tätig ist, werden PCF-Daten nach ISO 14067 für Sie zunehmend zur Pflicht.`;
  } else {
    s1 = `wir haben gesehen, dass ${a.company} als ${a.industry}-Unternehmen vor wachsenden CO₂-Anforderungen Ihrer Kunden und der Regulatorik steht.`;
  }
  // Sentence 2 — a second real hook, only when the data supports it.
  let s2 = "";
  if (a.csrdRelevance && !/csrd/i.test(s1)) {
    s2 = ` Mit der näher rückenden CSRD-Berichtspflicht wird die konsolidierte Scope-1/2/3-Erfassung für Sie schnell aufwändig.`;
  } else if (a.customers.length && !oems) {
    s2 = ` Gerade gegenüber Kunden wie ${a.customers.slice(0, 2).join(" und ")} zahlt sich eine saubere Datenbasis direkt aus.`;
  } else if (a.catenaXRelevance && !/catena/i.test(s1)) {
    s2 = ` Über Catena-X werden diese Daten zunehmend standardisiert eingefordert.`;
  }
  return (s1 + s2).trim();
}

/** How much real intelligence we hold on the account (data completeness, 0–100). */
function confidenceScore(a: Account): number {
  const signals = [
    a.email, a.website, a.contactTitle, a.certifications.length, a.painPoints.length,
    a.supplierPressure, a.pcfRelevance || a.catenaXRelevance || a.csrdRelevance,
    a.products, a.customers.length, a.employees,
  ];
  return Math.round((signals.filter(Boolean).length / signals.length) * 100);
}

/** How many SPECIFIC real signals the intro actually references (0–100). */
function personalizationScore(a: Account, intro: string): number {
  let p = 0;
  if (intro.includes(a.company)) p += 25;
  if (a.certifications.some((c) => intro.includes(c))) p += 20;
  if (namedOems(a.supplierPressure) && /\b(BMW|VW|Daimler|Mercedes|Audi|Porsche|Bosch|ZF|Continental|Stellantis|Ford|Toyota|Renault|Volvo|Tesla|Magna|Valeo)\b/.test(intro)) p += 20;
  if (a.products && intro.includes(a.products)) p += 15;
  if (a.customers.some((c) => intro.includes(c))) p += 10;
  if (/catena|pcf|iso\s?14067|csrd|scope/i.test(intro)) p += 10;
  return Math.min(100, p);
}

/** Campaign-dependent main CTA (text + target). */
function ctaForCampaign(c: CampaignType): { text: string; url: string } {
  if (c === "supplier-management" || c === "catena-x" || c === "csrd") {
    return { text: "Kostenlose Demo vereinbaren", url: EMAIL_ASSETS.calendlyUrl };
  }
  return { text: "Jetzt 14 Tage kostenlos testen", url: EMAIL_ASSETS.trialUrl };
}

/** Build all artifacts for one account from its REAL data. */
export function buildOpportunity(a: Account, clock: () => string): RevenueOpportunity {
  const campaign = selectCampaign(a);
  const banner: BannerRef = { ...EMAIL_BANNER };
  // Short clause of the REAL pain (first sentence, trimmed) — tighter copy.
  const rawPain = a.painPoints[0] ?? `${campaign}-Anforderungen Ihrer Kunden`;
  const pain = (rawPain.split(/[.;|]/)[0] ?? rawPain).slice(0, 160).trim();
  const value = CAMPAIGN_VALUE[campaign];

  // Personalized top part (the only part the engine generates per account).
  const greeting = "Guten Tag,";
  const intro = personalizedIntro(a);
  const painLine = `Konkret heißt das: ${pain}.`;
  const benefit = `Genau hier setzt HeyCarbo an: ${value}. Aufgebaut für den Mittelstand, nicht für Berater.`;
  const cta = ctaForCampaign(campaign);

  // Central layout appended automatically (banner · turquoise CTA · Calendly · signature).
  const emailHtml = renderEmail({ greeting, intro, pain: painLine, benefit, ctaText: cta.text, ctaUrl: cta.url });

  const subjects = [
    `${a.company}: CO₂-Daten in Minuten statt Wochen`,
    `${a.industry} & Scope 3 — kurze Frage`,
    `Belastbare Lieferantendaten für ${a.company}?`,
  ];
  const previewText = `${value} — in Minuten statt Wochen.`;
  const linkedin = `Guten Tag, ich verfolge, wie ${a.industry}-Unternehmen wie ${a.company} das Thema CO₂-/Scope-3-Daten angehen. Falls das bei Ihnen gerade Thema ist, tausche ich mich gern kurz aus — ganz unverbindlich.`;
  const followUp1 = `Guten Tag, ich wollte kurz nachfassen — falls ${pain.toLowerCase()} bei ${a.company} relevant ist, zeige ich in 15 Minuten, wie HeyCarbo den Aufwand senkt. Passt diese Woche?`;
  const followUp2 = `Guten Tag, ich lasse es für heute dabei. Wenn ${campaign}-Themen für ${a.company} später relevant werden, melden Sie sich gern: ${EMAIL_ASSETS.calendlyUrl}`;
  const summary =
    `Warum HeyCarbo passt: ${a.industry}, Fit ${a.fitScore}/100, Revenue-Potenzial ${a.revenueScore}/100. ` +
    `Größter vermuteter Pain: ${pain}. Kampagne „${campaign}" gewählt, weil die realen Signale (Relevanz/Pain) darauf zeigen.`;

  // Quality gates run on the PERSONALIZED copy only — not the fixed central
  // template (banner/CTA/signature are governed centrally, not per account).
  // The email body drives the conciseness + repetition checks (<30s read).
  const bodyText = [greeting, intro, painLine, benefit].join(" ");
  const quality = qualityCheck([greeting, intro, painLine, benefit, linkedin, followUp1, followUp2, ...subjects], bodyText);
  return {
    accountId: a.id, company: a.company, industry: a.industry,
    ...(a.contactTitle ? { contactTitle: a.contactTitle } : {}),
    ...(a.email ? { email: a.email } : {}),
    campaign, subjects, previewText, emailHtml, linkedin, followUp1, followUp2, summary, banner,
    ctaText: cta.text, ctaUrl: cta.url, quality,
    personalizationScore: personalizationScore(a, intro), confidenceScore: confidenceScore(a),
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
      bannerGaps: [], // one central marketing banner is used for every email
      topOpportunities: ready.slice(0, 5).map((o) => ({ company: o.company, industry: o.industry, campaign: o.campaign, revenueScore: o.revenueScore, fitScore: o.fitScore })),
    };
  }
}
