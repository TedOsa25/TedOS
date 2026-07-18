// HeyAudit brand profile. Same Revenue Engine, HeyAudit branding + messaging.
//
// HeyAudit = AI audit/checklist generation for German/EU SMEs: describe a check
// in one sentence, AI builds a compliant checklist, teams execute on mobile, a
// revision-safe PDF report is produced. Outreach focuses on Prüfungen, Wartungen,
// Arbeitssicherheit, Brandschutz, Betreiberpflichten, DIN/DGUV, Dokumentation,
// mobile Teams und mehrere Standorte — NOT carbon.

import type { Account } from "../accounts.js";
import type { BrandProfile } from "../brand-profile.js";
import type { Variant } from "../email-copy.js";

const WEBSITE = "https://heyaudit.de";

/** Deterministic campaign from the account's real audit signals. */
function selectCampaignHeyaudit(a: Account): string {
  const hay = `${a.industry} ${a.painPoints.join(" ")} ${a.products ?? ""}`.toLowerCase();
  if (/brandschutz/.test(hay)) return "brandschutz";
  if (/arbeitssicherheit|dguv|gefährdung|sicherheitsbegehung|unterweisung|bewachung|sicherheitsdienst/.test(hay)) return "arbeitssicherheit";
  if (/wartung|instandhaltung|inspektion|prüf|\bdin\b|\biso\b|abnahme|elektro|\bshk\b|aufzug|klima|lüftung/.test(hay)) return "wartung-pruefung";
  if (/betreiberpflicht|compliance/.test(hay)) return "betreiberpflichten";
  if (/mobil|außendienst|standort|filial|niederlassung|objekt|revier|streifen|team/.test(hay)) return "mobile-teams";
  return "pruefmanagement";
}

/** The regulatory requirement phrase used in the opener, per campaign. */
function requirementPhrase(campaign: string): string {
  switch (campaign) {
    case "brandschutz": return "prüfsichere Brandschutz- und Sicherheitsnachweise";
    case "arbeitssicherheit": return "dokumentierte Gefährdungsbeurteilungen und Sicherheitsbegehungen";
    case "wartung-pruefung": return "lückenlose Prüf- und Wartungsnachweise nach DIN/DGUV";
    case "betreiberpflichten": return "den lückenlosen Nachweis erfüllter Betreiberpflichten";
    case "mobile-teams": return "digitale, standortübergreifende Prüf- und Kontrollnachweise";
    default: return "lückenlose, revisionssichere Prüf- und Wartungsnachweise";
  }
}

/** Personalized opener — names the real company + its strongest audit driver. */
function introHeyaudit(a: Account): string {
  const emp = a.employees ?? 0;
  const who = emp >= 200
    ? `als ${a.industry}-Betrieb rund ${emp} Mitarbeitende an mehreren Standorten koordiniert`
    : emp > 0
      ? `im Bereich ${a.industry} mit rund ${emp} Mitarbeitenden arbeitet`
      : `im Bereich ${a.industry} mit dezentralen, mobilen Teams arbeitet`;
  const req = requirementPhrase(selectCampaignHeyaudit(a));
  return `Bei unserer Recherche ist uns aufgefallen, dass ${a.company} ${who}. Genau hier verlangt der Gesetzgeber inzwischen ${req} — jederzeit abrufbar und prüfsicher.`;
}

/** Turn a raw audit pain into one short, plain-German sentence. */
function germanizePainHeyaudit(rawInput: string): string {
  const raw = String(rawInput ?? "").trim();
  if (!raw) return "revisionssichere Prüf- und Wartungsnachweise.";
  const map: [RegExp, string][] = [
    [/brandschutz/i, "Brandschutznachweise müssen lückenlos und prüfsicher geführt werden."],
    [/arbeitssicherheit|dguv|sicherheitsbegehung|gefährdung|unterweisung/i, "Arbeitssicherheit und Gefährdungsbeurteilungen verlangen dokumentierte Nachweise."],
    [/wartung|instandhaltung/i, "Wartungs- und Instandhaltungsnachweise müssen revisionssicher vorliegen."],
    [/standort|filial|niederlassung|objekt|revier/i, "Mehrere Standorte erzeugen dezentralen Prüf- und Nachweisaufwand."],
    [/mobil|außendienst|streifen|team/i, "Mobile Teams dokumentieren Prüfungen heute oft noch auf Papier."],
    [/\bdin\b|\biso\b|inspektion|abnahme|prüf/i, "DIN-/Prüf-Nachweise werden regelmäßig eingefordert."],
    [/betreiberpflicht|compliance|nachweis|dokumentation|audit/i, "Betreiberpflichten erfordern lückenlose, jederzeit abrufbare Dokumentation."],
    [/excel|papier|zettel|manuell/i, "Prüfungen laufen noch über Papier und Excel."],
  ];
  for (const [re, de] of map) if (re.test(raw)) return de;
  const first = (raw.split(/[.;|–—-]/)[0] ?? raw).trim();
  const short = first.length > 88 ? `${first.slice(0, 86).trim()}…` : first;
  return /[.!?…]$/.test(short) ? short : `${short}.`;
}

/** HeyAudit email body paragraph per tone (A–E). */
const VALUE: Record<Variant, string> = {
  A: "Mit HeyAudit erstellen Sie Prüf- und Wartungschecklisten in Minuten, Ihre Teams füllen sie mobil vor Ort aus und der revisionssichere PDF-Bericht entsteht automatisch.",
  B: "Viele Betriebe führen Prüfungen und Begehungen heute noch auf Papier oder in Excel. Mit HeyAudit erstellen Sie passende Checklisten in Minuten, Ihre Teams füllen sie mobil vor Ort aus und der prüfsichere Bericht entsteht automatisch.",
  C: "Genau diese Lücke schließt HeyAudit: Prüfungen, Wartungen und Sicherheitsbegehungen digital abwickeln – mobil ausgefüllt, revisionssicher dokumentiert, ohne Zettelwirtschaft und Nacherfassung.",
  D: "Statt Papier, Excel und doppelter Nacherfassung: Mit HeyAudit füllen Ihre Teams Prüfungen mobil aus und der revisionssichere Bericht entsteht automatisch. Das entlastet Ihren Innendienst spürbar.",
  E: "Mit HeyAudit wickeln Sie Prüfungen, Wartungen und Sicherheitsbegehungen digital ab – mobil ausgefüllt und revisionssicher dokumentiert, gemacht für Betriebe mit mehreren Standorten und mobilen Teams.",
};

/** HeyAudit closing ask per tone (A–E). */
const CLOSING: Record<Variant, string> = {
  A: "Hätten Sie nächste Woche 15 Minuten für einen kurzen Austausch?",
  B: "Wenn das Thema bei Ihnen gerade relevant ist, zeige ich Ihnen in 15 Minuten, worauf es bei revisionssicheren Prüfnachweisen ankommt. Hätten Sie nächste Woche kurz Zeit?",
  C: "Hätten Sie nächste Woche 15 Minuten? Ich zeige Ihnen, wie andere Betriebe diese Nachweispflichten heute ohne Mehraufwand erfüllen.",
  D: "Hätten Sie nächste Woche 15 Minuten? Ich zeige Ihnen gern, wie viel Aufwand andere Betriebe damit heute einsparen.",
  E: "Wäre das für Sie gerade ein Thema? Über einen kurzen Austausch nächste Woche – 15 Minuten – würde ich mich freuen.",
};

export const HEYAUDIT_PROFILE: BrandProfile = {
  key: "heyaudit",
  productName: "HeyAudit",
  identity: {
    senderName: "Ted Osammor",
    senderEmail: "ted@heyaudit.de",
    bcc: "ted@heyaudit.de",
    websiteUrl: WEBSITE,
    emailTitle: "HeyAudit",
    bannerAlt: "HeyAudit — Prüfungen. Digital. Revisionssicher.",
    unsubscribeSecret: "heyaudit-unsub",
  },
  urls: {
    trialUrl: `${WEBSITE}/signup`,
    calendlyUrl: "https://calendly.com/ted-heyaudit/30min",
    imprintUrl: `${WEBSITE}/impressum`,
    privacyUrl: `${WEBSITE}/datenschutz`,
    unsubscribeBase: `${WEBSITE}/abmelden`,
  },
  assets: {
    // NOTE: upload the HeyAudit banner + signature icons to this repo before real sends.
    hostedAssetBase: "https://cdn.jsdelivr.net/gh/TedOsa25/heyaudit-email-assets@master",
    signaturePaths: ["../../../Sales/heyaudit_signature.html"],
    fallbackSignatureHtml:
      `<table cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#141b26">` +
      `<strong>Ted Osammor</strong><br>Gründer · HeyAudit<br>` +
      `<a href="${WEBSITE}" style="color:#2563EB">heyaudit.de</a></td></tr></table>`,
  },
  footer: {
    relevanceSentence:
      "Sie erhalten diese E-Mail, weil wir davon ausgehen, dass unsere Lösung für Ihr Unternehmen im Zusammenhang mit Prüfungen, Wartungen, Arbeitssicherheit oder Betreiberpflichten relevant sein könnte.",
  },
  data: {
    painField: "heyaudit_pain_points",
    dataPath: "../../../Sales/crm-heyaudit/leads.js",
  },
  copy: {
    subjects: (a: Account) => [
      `${a.company}: Prüfungen & Checklisten digital in Minuten`,
      `${a.industry} & Betreiberpflichten — kurze Frage`,
      `Digitale Prüfnachweise für ${a.company}?`,
    ],
    previewText:
      "Prüfungen, Wartungen & Sicherheitsbegehungen digital – mobil ausgefüllt, revisionssicher dokumentiert.",
    linkedin: (a: Account) =>
      `Guten Tag, ich verfolge, wie ${a.industry}-Unternehmen wie ${a.company} Prüfungen, Wartungen und Nachweispflichten organisieren. Falls digitale Prüfnachweise bei Ihnen gerade Thema sind, tausche ich mich gern kurz aus — ganz unverbindlich.`,
    followUp1: (a: Account) =>
      `Guten Tag, ich wollte kurz nachfassen — falls digitale Prüf- und Wartungsnachweise bei ${a.company} gerade Thema sind, zeige ich in 15 Minuten, wie HeyAudit den Dokumentationsaufwand senkt. Passt diese Woche?`,
    followUp2: (a: Account, ctx: { campaign: string; calendlyUrl: string }) =>
      `Guten Tag, ich lasse es für heute dabei. Wenn ${ctx.campaign}-Themen für ${a.company} später relevant werden, melden Sie sich gern: ${ctx.calendlyUrl}`,
    summaryLead: "Warum HeyAudit passt",
    painFallback: (ctx: { campaign: string }) => `${ctx.campaign}-Nachweispflichten an mehreren Standorten.`,
    ctaText: "14 Tage kostenlos testen",
    queueSubjectFallback: (company: string) => `${company}: Digitale Prüfnachweise`,
    intro: introHeyaudit,
    germanizePain: germanizePainHeyaudit,
    emailBody: { value: VALUE, closing: CLOSING },
    selectCampaign: selectCampaignHeyaudit,
  },
};
