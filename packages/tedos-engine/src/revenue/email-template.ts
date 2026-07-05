// Central email layout + global marketing assets for the Revenue Engine.
//
// The engine generates ONLY the personalized top part (greeting · intro · pain ·
// benefit). Everything below — the primary CTA button, the secondary demo link,
// the HTML signature and the marketing banner — is appended automatically from
// here. Change a value here and it applies to ALL future emails.
//
// Final layout (fixed for every email):
//   1. greeting + intro + value  (short personalized text)
//   2. closing                   — short, low-pressure ask, right under the text
//   3. primary CTA button        — "14 Tage kostenlos testen" (turquoise, website look)
//   4. secondary CTA link        — "Oder direkt eine 15-Minuten-Demo vereinbaren →"
//   5. marketing banner          — ONCE, directly above the signature
//   6. HTML signature            — embedded AS-IS (only image paths are made absolute)
//
// Design tokens are taken 1:1 from heycarbo.com (turquoise #13A6A6, text #16172B,
// muted #667085, 12px radius, Inter). The whole email is a self-contained,
// responsive HTML document that renders in Outlook, Apple Mail, Gmail, iPhone/
// Android Mail. All images are embedded (data: URIs) or absolute URLs — never
// relative paths.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BANNER_DATA_URI, SIGNATURE_ICON_DATA } from "./email-assets-embedded.js";

const WEBSITE_URL = process.env.WEBSITE_URL ?? "https://heycarbo.com";

/**
 * Public CDN (jsDelivr → GitHub) hosting banner + signature icons. Used by default
 * so images render in Gmail/Outlook/Apple Mail (Gmail blocks data: URIs). The
 * embedded base64 (email-assets-embedded.ts) stays as an offline fallback, and
 * both can be overridden via REVENUE_EMAIL_BANNER_URL / REVENUE_SIGNATURE_ICON_BASE_URL.
 */
const HOSTED_ASSET_BASE = "https://cdn.jsdelivr.net/gh/TedOsa25/heycarbo-email-assets@master";

/** Force the embedded base64 assets instead of hosted URLs (offline/testing). */
const EMBED_ASSETS = process.env.REVENUE_ASSETS_EMBED === "1" || !HOSTED_ASSET_BASE;

/** Brand tokens — pulled from the live HeyCarbo website. */
const BRAND = {
  turquoise: "#13A6A6", // primary CTA (rgb(19,166,166)) — exact website value
  turquoiseHover: "#0F8F8F", // subtle darken for clients that honour :hover
  text: "#16172B", // primary text
  muted: "#667085", // secondary text
  bg: "#FFFFFF", // background
  line: "#EAECF0", // hairline divider
  radius: 12, // border-radius (px) — website standard
} as const;

/** Inter with a full system fallback stack (no web fonts, no @font-face). */
const FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const EMAIL_ASSETS = {
  /** HeyCarbo corporate turquoise — buttons + links (exact website value). */
  turquoise: BRAND.turquoise,
  websiteUrl: WEBSITE_URL,
  /**
   * Banner <img src>. Prefer a public URL (Gmail-safe, no clipping); if none is
   * configured we embed the optimized banner as a self-contained data: URI so it
   * still renders in Apple Mail / iPhone Mail / Outlook desktop with no broken
   * image and no relative path.
   */
  bannerUrl: bannerSrc(),
  /** Whether the banner is a hosted URL (true) or the embedded data: URI (false). */
  bannerHosted: /^https?:/i.test(bannerSrc()),
  /** Global Calendly link — the secondary CTA target (all emails share it). */
  calendlyUrl: process.env.CALENDLY_URL ?? process.env.REVENUE_CALENDLY_URL ?? "https://calendly.com/ted-heycarbo/30min",
  /** 14-day trial landing — the PRIMARY CTA button target. */
  trialUrl: process.env.REVENUE_TRIAL_URL ?? `${WEBSITE_URL}/trial`,
} as const;

/** The central banner as a referenced asset (for the Revenue Center preview). */
export const EMAIL_BANNER = {
  industry: "zentral",
  asset: EMAIL_ASSETS.bannerUrl,
  url: EMAIL_ASSETS.bannerUrl,
  industrySpecific: false,
} as const;

/** A configured public banner URL, if any (env only — never a relative path). */
function bannerUrlEnv(): string | undefined {
  const v = process.env.REVENUE_EMAIL_BANNER_URL ?? process.env.REVENUE_EMAIL_BANNER_PATH;
  return v && /^https?:\/\//i.test(v) ? v : undefined;
}

/**
 * Resolve the banner <img src>: explicit env URL → hosted CDN default → embedded
 * data: URI (offline fallback). Hosted URLs render in Gmail; base64 does not.
 */
function bannerSrc(): string {
  const env = bannerUrlEnv();
  if (env) return env;
  return EMBED_ASSETS ? BANNER_DATA_URI : `${HOSTED_ASSET_BASE}/banner.jpg`;
}

// ── Signature ───────────────────────────────────────────────────────────────

const FALLBACK_SIGNATURE =
  `<table cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td style="font-family:${FONT};font-size:14px;color:${BRAND.text}">` +
  `<strong>Ted Osammor</strong><br>Co-Founder · HeyCarbo<br>` +
  `<a href="${WEBSITE_URL}" style="color:${BRAND.turquoise}">heycarbo.com</a></td></tr></table>`;

let cachedSignature: string | null = null;

/** Signature file candidates, in priority order (env → drop-in → legacy). */
function signatureCandidates(): string[] {
  return [
    process.env.REVENUE_SIGNATURE_PATH,
    resolve(process.cwd(), "../../../Sales/crm-heycarbo/assets/signature.html"),
    resolve(process.cwd(), "../../../Sales/heycarbo_signature_FINAL.html"),
  ].filter((p): p is string => Boolean(p));
}

/** Read the raw signature file (unchanged), or the fallback. Cached. */
function rawSignature(): string {
  if (cachedSignature !== null) return cachedSignature;
  for (const p of signatureCandidates()) {
    try {
      if (existsSync(p)) {
        cachedSignature = readFileSync(p, "utf8");
        return cachedSignature;
      }
    } catch {
      /* try next candidate */
    }
  }
  cachedSignature = FALLBACK_SIGNATURE;
  return cachedSignature;
}

/**
 * Resolve a single signature icon (`map-pin`, `mail`, `phone`, `world`,
 * `linkedin`, `logo`) to a renderable src: a hosted PNG if
 * REVENUE_SIGNATURE_ICON_BASE_URL is set (Gmail/Outlook-safe), else the embedded
 * PNG data: URI. The original SVGs are unsupported in Gmail/Outlook, so they are
 * rasterised to PNG once and embedded here.
 */
function signatureIconSrc(name: string): string {
  const base = process.env.REVENUE_SIGNATURE_ICON_BASE_URL;
  if (base && /^https?:\/\//i.test(base)) return `${base.replace(/\/$/, "")}/${name}.png`;
  if (!EMBED_ASSETS && HOSTED_ASSET_BASE) return `${HOSTED_ASSET_BASE}/${name}.png`;
  return SIGNATURE_ICON_DATA[name] ?? "";
}

/**
 * The central HTML signature, embedded AS-IS — only the image sources are made
 * self-contained: every `icons/<name>.svg` reference (relative OR the dead
 * absolute heycarbo.com/icons URL) is swapped for a PNG that actually renders.
 * No other markup, text, colour or spacing is changed. Cached indirectly.
 */
export function renderSignature(): string {
  return rawSignature().replace(
    /src\s*=\s*(["'])\s*(?:https?:\/\/[^"']*?\/)?icons\/([a-z0-9-]+)\.svg\s*\1/gi,
    (_m, q: string, name: string) => `src=${q}${signatureIconSrc(name)}${q}`,
  );
}

/** Back-compat alias (older callers imported `loadSignature`). */
export function loadSignature(): string {
  return renderSignature();
}

// ── Email assembly ────────────────────────────────────────────────────────────

/** The personalized parts the engine produces per account. */
export interface EmailParts {
  greeting: string; // always "Guten Tag,"
  intro: string; // company + OEMs (+ pain), from real data only
  value: string; // what HeyCarbo does — one tight paragraph
  closing: string; // short, low-pressure ask (after the CTA)
  ctaText: string; // primary button label
  ctaUrl: string; // primary button target (trial)
}

/** Text of the secondary demo link (shared by every email). */
export const SECONDARY_CTA_TEXT = "Oder direkt eine 15-Minuten-Demo vereinbaren →";

const para = (html: string, margin = "margin:0 0 18px 0"): string =>
  `<p style="${margin};padding:0;">${html}</p>`;

/** Bulletproof, rounded, centered primary button (VML for Outlook, <a> elsewhere). */
function primaryButton(text: string, url: string): string {
  const r = BRAND.radius;
  // VML needs a fixed pixel width — estimate from the label length.
  const width = Math.round(text.length * 8.6) + 56;
  const height = 46;
  const arcsize = Math.round((r / height) * 100);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" style="padding:10px 0 16px 0;">` +
    `<!--[if mso]>` +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" ` +
    `style="height:${height}px;v-text-anchor:middle;width:${width}px;" arcsize="${arcsize}%" strokecolor="${BRAND.turquoise}" fillcolor="${BRAND.turquoise}">` +
    `<w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${text}</center>` +
    `</v:roundrect>` +
    `<![endif]-->` +
    `<!--[if !mso]><!-->` +
    `<a class="hc-btn" href="${url}" style="display:inline-block;background:${BRAND.turquoise};color:#ffffff;` +
    `font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;padding:13px 34px;` +
    `border-radius:${r}px;text-decoration:none;mso-padding-alt:0;">${text}</a>` +
    `<!--<![endif]-->` +
    `</td></tr></table>`
  );
}

/** Centered secondary demo link (turquoise, no button). */
function secondaryLink(url: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" style="padding:0 0 4px 0;font-family:${FONT};font-size:15px;line-height:1.5;">` +
    `<a href="${url}" style="color:${BRAND.turquoise};font-weight:600;text-decoration:none;">${SECONDARY_CTA_TEXT}</a>` +
    `</td></tr></table>`
  );
}

/** Signature block: hairline divider + the (unchanged) signature. */
function signatureBlock(): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding:30px 0 0 0;">` +
    `<div style="border-top:1px solid ${BRAND.line};height:1px;line-height:1px;font-size:1px;">&nbsp;</div>` +
    `<div style="padding-top:22px;">${renderSignature()}</div>` +
    `</td></tr></table>`
  );
}

/** Marketing banner — ONCE, directly above the signature. */
function bannerBlock(): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding:26px 0 0 0;">` +
    `<a href="${WEBSITE_URL}" style="text-decoration:none;">` +
    `<img src="${bannerSrc()}" width="600" alt="HeyCarbo — Carbon. Made. Simple." ` +
    `style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:${BRAND.radius}px;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;">` +
    `</a></td></tr></table>`
  );
}

/**
 * Assemble the full, standalone, responsive HTML email:
 *   personalized text → primary CTA button → secondary link → signature → banner.
 * The bottom half is identical for every email.
 */
export function renderEmail(p: EmailParts): string {
  const a = EMAIL_ASSETS;
  const preheader = ""; // preview text is set by the ESP / job, not inlined here
  return (
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">` +
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="de">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge">` +
    `<meta name="color-scheme" content="light">` +
    `<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->` +
    `<title>HeyCarbo</title>` +
    `<style type="text/css">` +
    `body{margin:0;padding:0;background:${BRAND.bg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}` +
    `table{border-collapse:collapse;}` +
    `img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}` +
    `a{text-decoration:none;}` +
    `.hc-btn:hover{background:${BRAND.turquoiseHover} !important;}` +
    `@media only screen and (max-width:620px){` +
    `.hc-wrap{padding:20px 12px !important;}` +
    `.hc-card{padding:24px 20px 28px !important;}` +
    `}` +
    `</style>` +
    `</head>` +
    `<body style="margin:0;padding:0;background:${BRAND.bg};">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};">` +
    `<tr><td class="hc-wrap" align="center" style="padding:28px 16px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto;">` +
    `<tr><td class="hc-card" style="padding:12px 24px 16px 24px;font-family:${FONT};font-size:16px;line-height:1.6;color:${BRAND.text};">` +
    para(p.greeting) +
    para(p.intro) +
    para(p.value) +
    para(p.closing) +
    primaryButton(p.ctaText, p.ctaUrl) +
    secondaryLink(a.calendlyUrl) +
    bannerBlock() +
    signatureBlock() +
    `</td></tr></table>` +
    `</td></tr></table>` +
    `</body></html>`
  );
}

/** The central template assets (for the Revenue Center previews). */
export function templateMeta() {
  return {
    bannerUrl: EMAIL_ASSETS.bannerUrl,
    bannerAsset: EMAIL_BANNER.asset,
    bannerHosted: EMAIL_ASSETS.bannerHosted,
    calendlyUrl: EMAIL_ASSETS.calendlyUrl,
    turquoise: EMAIL_ASSETS.turquoise,
    signatureHtml: renderSignature(),
    secondaryCtaText: SECONDARY_CTA_TEXT,
  };
}
