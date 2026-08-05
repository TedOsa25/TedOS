// Brand/product profile for the Revenue Engine.
//
// The engine (accounts loader, copy generation, email template, batch send,
// approval, reporting, opt-out) is ONE shared pipeline. Everything product-
// SPECIFIC — product name, sender identity, CRM data source, pain field, the
// outreach copy, the email chrome (URLs, banner, signature, footer, imprint,
// privacy, unsubscribe) — is factored out here, so the same engine runs for a
// given product by selecting a profile. No send/approval/queue/SMTP logic lives
// here; this is purely the brand surface.

import type { Account } from "./accounts.js";
import type { Variant } from "./email-copy.js";

/** Where the real accounts come from and how their pain field is named. */
export interface BrandDataModel {
  /** Raw-lead field holding the product-specific pain points (e.g. `heyaudit_pain_points`). */
  painField: string;
  /**
   * Default accounts file, as a path segment resolved against the engine cwd
   * (e.g. `../../../Sales/crm-heyaudit/leads.js`). `REVENUE_ACCOUNTS_PATH` still wins.
   */
  dataPath: string;
}

/** Sender + brand identity used across the email chrome. */
export interface BrandIdentity {
  /** From-name on outbound mail. */
  senderName: string;
  /** From-address on outbound mail (env `REVENUE_FROM_EMAIL` still wins). */
  senderEmail: string;
  /** Blind monitoring BCC for batch 1 (env `REVENUE_BCC_FIRST_BATCH` still wins). */
  bcc: string;
  /** Public website (env `WEBSITE_URL` still wins). */
  websiteUrl: string;
  /** `<title>` inside the email document. */
  emailTitle: string;
  /** Banner `alt` text (unique per brand). */
  bannerAlt: string;
  /** Primary accent — CTA button + link colour (env `REVENUE_EMAIL_ACCENT` still wins). */
  accent: string;
  /** Hover/pressed darken of the accent (env `REVENUE_EMAIL_ACCENT_HOVER` still wins). */
  accentHover: string;
  /** Salt for the deterministic per-lead unsubscribe token (env still wins). */
  unsubscribeSecret: string;
}

/** All outbound-facing URLs (each has an env override in email-template.ts). */
export interface BrandUrls {
  trialUrl: string;
  calendlyUrl: string;
  imprintUrl: string;
  privacyUrl: string;
  unsubscribeBase: string;
  /**
   * RFC 8058 one-click endpoint for the `List-Unsubscribe-Post` header. Must
   * accept a POST and complete the opt-out without any further interaction.
   * Optional: without it only the mailto: form of List-Unsubscribe is emitted,
   * which is still valid — just not one-click.
   */
  unsubscribePostUrl?: string;
}

/** Banner + signature assets. */
export interface BrandAssets {
  /** Hosted asset base (CDN) for banner + signature icons. */
  hostedAssetBase: string;
  /** Signature HTML file candidates, resolved against cwd (env `REVENUE_SIGNATURE_PATH` wins). */
  signaturePaths: string[];
  /** Inline fallback signature used when no file is found. */
  fallbackSignatureHtml: string;
}

/** Legal-footer product-specific text (structure/links stay shared). */
export interface BrandFooter {
  /** The "why you received this email" relevance sentence. */
  relevanceSentence: string;
}

/** All product-specific outreach copy. */
export interface BrandCopy {
  /** Three subject-line templates, from the account's real fields. */
  subjects: (a: Account) => string[];
  /** Inbox preview text (fixed per brand). */
  previewText: string;
  /** LinkedIn opener. */
  linkedin: (a: Account) => string;
  /** Follow-up 1 — "kurz nachfassen". */
  followUp1: (a: Account) => string;
  /** Follow-up 2 — the last, low-pressure touch (carries the Calendly link). */
  followUp2: (a: Account, ctx: { campaign: string; calendlyUrl: string }) => string;
  /** Lead-in for the internal account summary, e.g. "Warum HeyAudit passt". */
  summaryLead: string;
  /** Pain clause used when the account has none of its own. */
  painFallback: (ctx: { campaign: string }) => string;
  /** Primary CTA button label. */
  ctaText: string;
  /** Subject fallback used when queueing (first subject missing). */
  queueSubjectFallback: (company: string) => string;
  /** The personalized email opener (two short sentences from the account's real signals). */
  intro: (a: Account) => string;
  /** Turn a raw pain point into one short, plain-German sentence. */
  germanizePain: (raw: string) => string;
  /** The email body paragraph per copy tone (A–E): what the product does + the ask. */
  emailBody: { value: Record<Variant, string>; closing: Record<Variant, string> };
  /**
   * One sentence naming the obligation THIS lead is actually under, keyed by the
   * campaign `selectCampaign` derived. The variant decides HOW the pitch sounds;
   * this decides WHAT the recipient has to deliver. Optional — a brand without
   * it falls back to the generic value paragraph alone.
   */
  needLead?: (campaign: string) => string;
  /** Deterministic campaign selection from the account's real signals. */
  selectCampaign: (a: Account) => string;
}

/** A complete product profile the Revenue Engine can run against. */
export interface BrandProfile {
  /** Selector key — lower-case, matches TEDOS_PROJECT / REVENUE_BRAND (e.g. "heyaudit"). */
  key: string;
  /** Display product name used in copy + summaries. */
  productName: string;
  identity: BrandIdentity;
  urls: BrandUrls;
  assets: BrandAssets;
  footer: BrandFooter;
  data: BrandDataModel;
  copy: BrandCopy;
}

import { HEYCARBO_PROFILE } from "./brand-profiles/heycarbo.js";
import { HEYAUDIT_PROFILE } from "./brand-profiles/heyaudit.js";

/** Registered profiles, keyed by their lower-case selector. */
const REGISTRY: Record<string, BrandProfile> = {
  [HEYCARBO_PROFILE.key]: HEYCARBO_PROFILE,
  [HEYAUDIT_PROFILE.key]: HEYAUDIT_PROFILE,
};

/** The default profile when nothing is selected (HeyCarbo — the original engine). */
const DEFAULT_PROFILE = HEYCARBO_PROFILE;

/** Register (or override) a profile. */
export function registerBrand(profile: BrandProfile): void {
  REGISTRY[profile.key.toLowerCase()] = profile;
}

/** Look up a profile by key; unknown keys fall back to the default (never throws). */
export function brandProfile(key: string | undefined): BrandProfile {
  return REGISTRY[(key ?? "").toLowerCase()] ?? DEFAULT_PROFILE;
}

/**
 * The active profile for this run: `REVENUE_BRAND`, else the dev-loop's
 * `TEDOS_PROJECT`, else the default. Run the HeyAudit engine with
 * `REVENUE_BRAND=heyaudit`.
 */
export function activeBrandProfile(): BrandProfile {
  return brandProfile(process.env.REVENUE_BRAND ?? process.env.TEDOS_PROJECT);
}
