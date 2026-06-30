// Central email layout + global marketing assets for the Revenue Engine.
//
// The engine generates ONLY the personalized top part (greeting · intro · pain ·
// benefit). Everything below — central banner, turquoise CTA, Calendly link,
// HTML signature — is appended automatically from here. Change a value here and
// it applies to ALL future emails. Banner image + final signature are provided
// separately (env/file); referenced, never generated.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Globally maintained assets — one source of truth for every email. */
export const EMAIL_ASSETS = {
  /** HeyCarbo corporate turquoise — buttons only (not lime/grey/blue). */
  turquoise: "#0d9488",
  /** Central marketing banner (provided separately; swap via env). */
  bannerUrl: process.env.REVENUE_EMAIL_BANNER_URL ?? "https://heycarbo.com/email/banner.png",
  /** Global Calendly link — all 1,700 emails share it. */
  calendlyUrl: process.env.REVENUE_CALENDLY_URL ?? "https://calendly.com/ted-heycarbo/30min",
  /** 14-day trial landing (main CTA target for trial-oriented campaigns). */
  trialUrl: process.env.REVENUE_TRIAL_URL ?? "https://heycarbo.com/trial",
} as const;

/** The central banner as a referenced asset (for the Revenue Center preview). */
export const EMAIL_BANNER = {
  industry: "zentral",
  asset: process.env.REVENUE_EMAIL_BANNER_ASSET ?? "/public/email/banner.webp",
  url: EMAIL_ASSETS.bannerUrl,
  industrySpecific: false,
} as const

const FALLBACK_SIGNATURE =
  `<table cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td style="font-family:Inter,Arial,sans-serif;font-size:13px;color:#1c1917">` +
  `<strong>Ted Osammor</strong><br>Founder · HeyCarbo<br>` +
  `<a href="https://heycarbo.com" style="color:#0d9488">heycarbo.com</a></td></tr></table>`

let cachedSignature: string | null = null

/** Load the central HTML signature from a file (provided separately). Cached. */
export function loadSignature(): string {
  if (cachedSignature !== null) return cachedSignature
  const path =
    process.env.REVENUE_SIGNATURE_PATH ?? resolve(process.cwd(), "../../../Sales/heycarbo_signature_FINAL.html")
  try {
    cachedSignature = existsSync(path) ? readFileSync(path, "utf8") : FALLBACK_SIGNATURE
  } catch {
    cachedSignature = FALLBACK_SIGNATURE
  }
  return cachedSignature
}

/** The personalized parts the engine produces per account. */
export interface EmailParts {
  greeting: string // always "Guten Tag,"
  intro: string // company-specific, from real data only
  pain: string
  benefit: string
  ctaText: string // campaign-dependent
  ctaUrl: string
}

const para = (html: string): string => `<p style="margin:0 0 14px">${html}</p>`

/**
 * Assemble the full email: personalized top + central banner + turquoise CTA +
 * Calendly link + signature. The bottom half is identical for every email.
 */
export function renderEmail(p: EmailParts): string {
  const a = EMAIL_ASSETS
  return (
    `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917;max-width:600px;margin:0 auto">` +
    para(p.greeting) +
    para(p.intro) +
    para(p.pain) +
    para(p.benefit) +
    `<p style="margin:20px 0"><img src="${a.bannerUrl}" alt="HeyCarbo" width="600" style="display:block;max-width:100%;border-radius:10px"></p>` +
    `<p style="text-align:center;margin:24px 0 10px"><a href="${p.ctaUrl}" style="background:${a.turquoise};color:#ffffff;padding:14px 30px;border-radius:999px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block">${p.ctaText}</a></p>` +
    `<p style="text-align:center;margin:0 0 26px"><a href="${a.calendlyUrl}" style="color:${a.turquoise};font-size:14px;font-weight:600;text-decoration:underline">Direkt eine 15-Minuten-Demo buchen →</a></p>` +
    loadSignature() +
    `</div>`
  )
}

/** The central template assets (for the Revenue Center previews). */
export function templateMeta() {
  return {
    bannerUrl: EMAIL_ASSETS.bannerUrl,
    bannerAsset: EMAIL_BANNER.asset,
    calendlyUrl: EMAIL_ASSETS.calendlyUrl,
    turquoise: EMAIL_ASSETS.turquoise,
    signatureHtml: loadSignature(),
    secondaryCtaText: "Direkt eine 15-Minuten-Demo buchen",
  };
}
