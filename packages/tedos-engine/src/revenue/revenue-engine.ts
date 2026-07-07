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
import { activeBrandProfile } from "./brand-profile.js";
import { EMAIL_ASSETS, EMAIL_BANNER, renderEmail, unsubscribeToken, unsubscribeUrl } from "./email-template.js";
import { VARIANTS, VARIANT_LABEL, DEFAULT_VARIANT, namedOems, type Variant } from "./email-copy.js";

/** A referenced banner asset (the central email banner). */
export interface BannerRef {
  industry: string;
  asset: string;
  url: string;
  industrySpecific: boolean;
}

/** Campaign key, chosen per brand from the account's real signals (profile-driven). */
export type CampaignType = string;

/** Choose the campaign from the account's real signals (deterministic, per active brand). */
export function selectCampaign(a: Account): CampaignType {
  return activeBrandProfile().copy.selectCampaign(a);
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
  /** Which copy tone (A–E) this email uses. */
  variant: Variant;
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
  /** Per-lead opt-out — token + absolute URL embedded in the legal footer. */
  unsubscribeToken: string;
  unsubscribeUrl: string;
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

/** Build all artifacts for one account from its REAL data, in the given copy variant. */
export function buildOpportunity(a: Account, clock: () => string, variant: Variant = DEFAULT_VARIANT): RevenueOpportunity {
  const brand = activeBrandProfile();
  const campaign = selectCampaign(a);
  const banner: BannerRef = { ...EMAIL_BANNER };

  // The ONLY per-account text: short, conversion-first copy in the chosen tone,
  // assembled from the active brand profile (opener + body + closing).
  const copy = {
    greeting: "Guten Tag,",
    intro: brand.copy.intro(a),
    value: brand.copy.emailBody.value[variant],
    closing: brand.copy.emailBody.closing[variant],
  };
  // The primary CTA is fixed for every email: the brand's label on a turquoise
  // button pointing at the trial. The demo (Calendly) is the secondary link.
  const cta = { text: brand.copy.ctaText, url: EMAIL_ASSETS.trialUrl };

  // Central layout appended automatically:
  //   text · banner · "14 Tage kostenlos testen" button · demo link · signature · legal footer.
  // The legal footer carries this lead's own unsubscribe link.
  const unsubUrl = unsubscribeUrl(a.id);
  const emailHtml = renderEmail({
    greeting: copy.greeting, intro: copy.intro, value: copy.value, closing: copy.closing,
    ctaText: cta.text, ctaUrl: cta.url, unsubscribeUrl: unsubUrl,
  });

  const subjects = brand.copy.subjects(a);
  const previewText = brand.copy.previewText;
  const linkedin = brand.copy.linkedin(a);
  const followUp1 = brand.copy.followUp1(a);
  const followUp2 = brand.copy.followUp2(a, { campaign, calendlyUrl: EMAIL_ASSETS.calendlyUrl });
  const painShort = a.painPoints[0] ? brand.copy.germanizePain(a.painPoints[0]) : brand.copy.painFallback({ campaign });
  const summary =
    `${brand.copy.summaryLead}: ${a.industry}, Fit ${a.fitScore}/100, Revenue-Potenzial ${a.revenueScore}/100. ` +
    `Größter vermuteter Pain: ${painShort} Copy-Variante „${variant}" (${VARIANT_LABEL[variant]}).`;

  // Quality gates run on the PERSONALIZED copy only — not the fixed central
  // template. The email body drives the conciseness + repetition checks (<30s read).
  const bodyText = [copy.greeting, copy.intro, copy.value, copy.closing].join(" ");
  const quality = qualityCheck([copy.greeting, copy.intro, copy.value, copy.closing, linkedin, followUp1, followUp2, ...subjects], bodyText);
  return {
    accountId: a.id, company: a.company, industry: a.industry,
    ...(a.contactTitle ? { contactTitle: a.contactTitle } : {}),
    ...(a.email ? { email: a.email } : {}),
    variant, campaign, subjects, previewText, emailHtml, linkedin, followUp1, followUp2, summary, banner,
    ctaText: cta.text, ctaUrl: cta.url, quality,
    personalizationScore: personalizationScore(a, copy.intro), confidenceScore: confidenceScore(a),
    fitScore: a.fitScore, revenueScore: a.revenueScore, buyingIntent: a.buyingIntent, priority: a.priority,
    createdAt: clock(),
    unsubscribeToken: unsubscribeToken(a.id), unsubscribeUrl: unsubUrl,
  };
}

/** Build the same account in ALL five copy variants (for A/E comparison + analysis). */
export function buildVariants(a: Account, clock: () => string): Record<Variant, RevenueOpportunity> {
  const out = {} as Record<Variant, RevenueOpportunity>;
  for (const v of VARIANTS) out[v] = buildOpportunity(a, clock, v);
  return out;
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
        missingData: `No real accounts loaded — set REVENUE_ACCOUNTS_PATH to ${activeBrandProfile().data.dataPath} (never fabricated).`,
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
    const subj = o.subjects[0] ?? activeBrandProfile().copy.queueSubjectFallback(o.company);
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
