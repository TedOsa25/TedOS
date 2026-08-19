// HeyCarbo brand profile — the default. Values are extracted VERBATIM from the
// previously hardcoded revenue-engine.ts / email-copy.ts / email-template.ts /
// batch-send.ts so behaviour is identical. CO₂ / PCF / Scope-3 messaging for the
// industrial Mittelstand.

import type { Account } from "../accounts.js";
import type { BrandProfile } from "../brand-profile.js";
import {
  HEYCARBO_VALUE, HEYCARBO_CLOSING, needLeadHeycarbo, selectCampaignHeycarbo, researchIntro, germanizePain,
  bedarfsPhrase, kampagnenName,
} from "../email-copy.js";

const WEBSITE = "https://heycarbo.com";

export const HEYCARBO_PROFILE: BrandProfile = {
  key: "heycarbo",
  productName: "HeyCarbo",
  identity: {
    senderName: "Ted Osammor",
    senderEmail: "ted@heycarbo.com",
    bcc: "ted@heycarbo.com",
    websiteUrl: WEBSITE,
    emailTitle: "HeyCarbo",
    bannerAlt: "HeyCarbo — Carbon. Made. Simple.",
    accent: "#13A6A6",
    accentHover: "#0F8F8F",
    unsubscribeSecret: "heycarbo-unsub",
  },
  urls: {
    // MUST stay a PUBLIC route: /trial sits behind <ProtectedRoute> in the app,
    // so a cold recipient clicking the CTA hit the login wall instead of signing
    // up. /signup is the public entry point (HeyAudit already points there).
    trialUrl: `${WEBSITE}/signup`,
    calendlyUrl: "https://calendly.com/ted-heycarbo/30min",
    imprintUrl: `${WEBSITE}/impressum`,
    privacyUrl: `${WEBSITE}/datenschutz`,
    unsubscribeBase: `${WEBSITE}/unsubscribe`,
    // Supabase edge function `marketing-unsubscribe` — the same endpoint the
    // /unsubscribe page posts to. Gmail/Yahoo bulk-sender rules expect a
    // one-click List-Unsubscribe-Post target; this is it.
    unsubscribePostUrl:
      "https://odwbhglzsmmtkrriggkv.supabase.co/functions/v1/marketing-unsubscribe",
  },
  assets: {
    hostedAssetBase: "https://cdn.jsdelivr.net/gh/TedOsa25/heycarbo-email-assets@master",
    signaturePaths: [
      "../../../Sales/crm-heycarbo/assets/signature.html",
      "../../../Sales/heycarbo_signature_FINAL.html",
    ],
    fallbackSignatureHtml:
      `<table cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#16172B">` +
      `<strong>Ted Osammor</strong><br>Co-Founder · HeyCarbo<br>` +
      `<a href="${WEBSITE}" style="color:#13A6A6">heycarbo.com</a></td></tr></table>`,
  },
  footer: {
    relevanceSentence:
      "Sie erhalten diese E-Mail, weil wir davon ausgehen, dass unsere Lösung für Ihr Unternehmen im Zusammenhang mit CO₂-Bilanzierung, Product Carbon Footprints oder Lieferkettenanforderungen relevant sein könnte.",
  },
  data: {
    painField: "heycarbo_pain_points",
    dataPath: "../../../Sales/crm-heycarbo/leads.js",
  },
  copy: {
    subjects: (a: Account) => [
      `${a.company}: CO₂-Bilanz & PCF in Minuten`,
      `${a.industry} & Scope 3 — kurze Frage`,
      `PCF-Daten für ${a.company}?`,
    ],
    previewText:
      "CO₂-Bilanzen & Product Carbon Footprints in Minuten – auditfähig, für den Mittelstand.",
    linkedin: (a: Account) =>
      `Guten Tag, ich verfolge, wie ${a.industry}-Unternehmen wie ${a.company} das Thema CO₂-/Scope-3-Daten angehen. Falls das bei Ihnen gerade Thema ist, tausche ich mich gern kurz aus — ganz unverbindlich.`,
    // NACH BEDARF, nicht mehr ein Satz für alle. Die Phrase kommt aus derselben
    // Ableitung wie der Erstkontakt (Branche · OEM-Druck · CSRD-Signal), damit
    // Erstmail und Nachfassmail dieselbe Sprache sprechen — ein Werkzeugbauer
    // und eine Molkerei bekamen vorher denselben Text.
    followUp1: (a: Account) =>
      `Guten Tag, ich wollte kurz nachfassen. Falls ${bedarfsPhrase(a)} bei ${a.company} gerade anstehen, zeige ich Ihnen in 15 Minuten, wie HeyCarbo den Aufwand dafür senkt. Passt das diese Woche?`,
    // ctx.campaign ist ein technisches Kürzel aus dem Store ("scope-3",
    // "catena-x"). Ungefiltert ergab das "Wenn scope-3-Themen für Koinor später
    // relevant werden" — maschinell und kleingeschrieben mitten im Satz.
    followUp2: (a: Account, ctx: { campaign: string; calendlyUrl: string }) =>
      // "das Thema" davor, weil die Labels teils Plural sind: "Sollte Product Carbon
      // Footprints ... " war schlicht falsches Deutsch. Mit "das Thema" stimmt die
      // Kongruenz unabhaengig davon, was kampagnenName liefert.
      `Guten Tag, ich lasse es dabei — Sie haben Wichtigeres zu tun. Sollte das Thema ${kampagnenName(ctx.campaign)} bei ${a.company} später auf den Tisch kommen, melden Sie sich gern: ${ctx.calendlyUrl}`,
    summaryLead: "Warum HeyCarbo passt",
    painFallback: (ctx: { campaign: string }) => `${ctx.campaign}-Anforderungen der Kunden.`,
    // MUSS zur tatsächlichen Testdauer passen: Migration 039 hat sie von 14 auf
    // 7 Tage gesenkt ("Change trial from 14 to 7 days"), und 071 erzwingt das
    // Feld system-seitig. Die Mail versprach 14 Tage, die Landingpage nennt 7 —
    // wer klickte, sah als Erstes, dass die Zusage nicht gilt.
    ctaText: "7 Tage kostenlos testen",
    queueSubjectFallback: (company: string) => `${company}: CO₂-Daten`,
    intro: researchIntro,
    germanizePain,
    emailBody: { value: HEYCARBO_VALUE, closing: HEYCARBO_CLOSING },
    needLead: needLeadHeycarbo,
    selectCampaign: selectCampaignHeycarbo,
  },
};
