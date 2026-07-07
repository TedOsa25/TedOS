// Email COPY generation for the Revenue Engine — short, modern, conversion-first.
//
// The engine produces only the personalized text (greeting · intro · value ·
// closing). Everything below (banner · CTA · demo link · signature) is the fixed
// central template. Copy is generated in five tones (A–E); the default that ships
// in every email is DEFAULT_VARIANT. All text is derived ONLY from the account's
// REAL fields (company, OEMs/customers, certifications, pain points) — no invented
// facts, no marketing fluff. Each paragraph stays ≤ 3 lines.

import type { Account } from "./accounts.js";

/** Copy tones. A: sehr kurz · B: beratend · C: problem · D: ROI · E: persönlich. */
export type Variant = "A" | "B" | "C" | "D" | "E";

export const VARIANTS: Variant[] = ["A", "B", "C", "D", "E"];

export const VARIANT_LABEL: Record<Variant, string> = {
  A: "sehr kurz",
  B: "beratend",
  C: "problemorientiert",
  D: "ROI-orientiert",
  E: "persönlich / dialogorientiert",
};

/**
 * The variant that ships as the default in every generated email. Chosen for the
 * highest expected overall conversion in cold B2B outreach (reply-driven): short,
 * personal, one low-friction ask. See docs/email-variants-analysis.md.
 */
export const DEFAULT_VARIANT: Variant = "E";

/** The four personalized paragraphs (the only per-account generated text). */
export interface EmailCopy {
  greeting: string; // always "Guten Tag,"
  intro: string; // company + OEMs (+ pain), from real data
  value: string; // what HeyCarbo does, in one tight paragraph
  closing: string; // a short, low-pressure ask
}

const GREETING = "Guten Tag,";

/** Named OEMs from the real supplier-pressure signal (up to 3), properly cased. */
const OEM_RE = /\b(BMW|VW|Volkswagen|Daimler|Mercedes|Audi|Porsche|Bosch|ZF|Continental|Stellantis|Ford|Toyota|Renault|Volvo|Tesla|Magna|Valeo)\b/gi;
/** Canonical display spelling per OEM (acronyms stay upper-case, brands title-case). */
const OEM_DISPLAY: Record<string, string> = {
  bmw: "BMW", vw: "VW", volkswagen: "VW", daimler: "Daimler", mercedes: "Mercedes",
  audi: "Audi", porsche: "Porsche", bosch: "Bosch", zf: "ZF", continental: "Continental",
  stellantis: "Stellantis", ford: "Ford", toyota: "Toyota", renault: "Renault",
  volvo: "Volvo", tesla: "Tesla", magna: "Magna", valeo: "Valeo",
};
export function namedOems(sp: string | undefined): string | null {
  if (!sp || typeof sp !== "string") return null;
  const m = sp.match(OEM_RE);
  if (!m) return null;
  const seen = Array.from(new Set(m.map((x) => OEM_DISPLAY[x.toLowerCase()] ?? x))).slice(0, 3);
  return seen.length > 1 ? `${seen.slice(0, -1).join(", ")} und ${seen[seen.length - 1]}` : seen[0] ?? null;
}

/** The OEM/customer clause used in the intro (real names only, else null). */
export function oemClause(a: Account): string | null {
  const oems = namedOems(a.supplierPressure);
  if (oems) return oems;
  if (a.customers.length) return a.customers.slice(0, 2).join(" und ");
  return null;
}

/**
 * Turn a raw (often long / English) pain point into ONE short, plain-German
 * sentence. Keyword-mapped for the common cases; otherwise trimmed to a short
 * clause. Deterministic — no runtime LLM.
 */
export function germanizePain(rawInput: string): string {
  const raw = String(rawInput ?? "").trim();
  if (!raw) return "belastbare CO₂- und Product-Carbon-Footprint-Daten.";
  const map: [RegExp, string][] = [
    [/iso ?14067|pcf|product carbon|cradle/i, "Product Carbon Footprints nach ISO 14067 werden von Kunden gefordert."],
    [/catena|pact|wbcsd/i, "Catena-X verlangt standardisierte CO₂-Daten."],
    [/csrd|esrs|berichtspflicht|reporting/i, "Die CSRD-Berichtspflicht rückt näher."],
    [/scope ?3/i, "Scope-3-Daten aus der Lieferkette fehlen."],
    [/supplier|lieferant|supply chain/i, "Belastbare Lieferantendaten sind schwer zu bekommen."],
    [/excel|spreadsheet|manual/i, "Die CO₂-Bilanzierung läuft noch über Excel."],
    [/ecovadis|cdp|questionnaire|fragebogen/i, "Kunden fragen ESG-Bewertungen (EcoVadis, CDP) ab."],
  ];
  for (const [re, de] of map) if (re.test(raw)) return de;
  const first = (raw.split(/[.;|–—-]/)[0] ?? raw).trim();
  const short = first.length > 88 ? `${first.slice(0, 86).trim()}…` : first;
  return /[.!?…]$/.test(short) ? short : `${short}.`;
}

/** A relevance field counts as a real signal when present and not "low/none".
 *  Robust to messy CRM data (booleans, numbers, null) — coerces before testing. */
const signal = (v?: unknown): boolean => {
  if (v === undefined || v === null || v === false) return false;
  const s = String(v).trim().toLowerCase();
  return s !== "" && !/^(low|none|no|niedrig|keine?|n\/a|false|0)$/.test(s);
};

/** Coarse industry bucket derived from the account's real industry string. */
type Bucket = "automotive" | "maschinenbau" | "chemie" | "logistik" | "elektronik" | "generic";
function classifyIndustry(industry: string): Bucket {
  const s = String(industry ?? "").toLowerCase();
  if (/automotive|mobility|fahrzeug|automobil|\bkfz\b/.test(s)) return "automotive";
  if (/maschinen|anlagen|machinery|mechanical|engineering/.test(s)) return "maschinenbau";
  if (/chemie|chemical|kunststoff|plastic|polymer|pharma/.test(s)) return "chemie";
  if (/logistik|logistics|transport|spedition|fracht|freight/.test(s)) return "logistik";
  if (/elektro|electronic|elektronik|semiconductor|halbleiter/.test(s)) return "elektronik";
  return "generic";
}

/** The STRONGEST pain as a noun phrase (object of "verlangen … {phrase}"). */
function painPhrase(a: Account, bucket: Bucket): string {
  if (namedOems(a.supplierPressure) || signal(a.catenaXRelevance) || signal(a.pcfRelevance) || bucket === "automotive")
    return "ISO-14067-konforme PCF-Daten entlang Catena-X";
  if (signal(a.csrdRelevance))
    return "konsolidierte Scope-1-, Scope-2- und Scope-3-Daten für die CSRD-Berichtspflicht";
  switch (bucket) {
    case "maschinenbau": return "belastbare Scope-3- und Product-Carbon-Footprint-Daten";
    case "chemie": return "transparente CO₂-Daten entlang der gesamten Lieferkette";
    case "logistik": return "belastbare Scope-1-, Scope-2- und Scope-3-Daten";
    case "elektronik": return "standardisierte Product Carbon Footprints";
    default: return "belastbare CO₂- und Product-Carbon-Footprint-Daten";
  }
}

/** Sentence 1 tail when NO real customer/OEM names exist — anchored on the branch. */
function whoByBucket(bucket: Bucket): string {
  switch (bucket) {
    case "maschinenbau": return "zahlreiche Industriekunden beliefert";
    case "chemie": return "internationale Industriekunden beliefert";
    case "logistik": return "für Unternehmen mit steigenden Nachhaltigkeitsanforderungen tätig ist";
    case "elektronik":
    case "automotive": return "für internationale Industrieunternehmen produziert";
    default: return "zahlreiche Industriekunden beliefert";
  }
}

/** Sentence 2 — subject + verb by audience/branch, object = the strongest pain. */
function sentence2(kind: "oems" | Bucket, pain: string): string {
  switch (kind) {
    case "oems": return `Genau diese OEMs verlangen inzwischen ${pain}.`;
    case "automotive": return `Genau diese Kunden verlangen inzwischen ${pain}.`;
    case "maschinenbau": return `Genau diese Unternehmen fordern zunehmend ${pain}.`;
    case "chemie": return `Genau diese Unternehmen erwarten heute ${pain}.`;
    case "logistik": return `Immer mehr Auftraggeber erwarten inzwischen ${pain}.`;
    case "elektronik": return `Genau diese Kunden verlangen zunehmend ${pain}.`;
    default: return `Genau diese Unternehmen verlangen inzwischen ${pain}.`;
  }
}

/**
 * THE standard outreach opener (identical across all variants): two short,
 * personal sentences that name the account's real customers/OEMs (or its branch
 * when none are known) and its strongest pain — so the recipient sees at once
 * that the email was written for THEIR company. No generic phrasing, no marketing.
 *
 *   "Bei unserer Recherche ist uns aufgefallen, dass {company} … {customers}.
 *    Genau diese {OEMs|Unternehmen|Kunden} verlangen inzwischen {pain}."
 */
export function researchIntro(a: Account): string {
  const oems = namedOems(a.supplierPressure);
  const custs = a.customers.slice(0, 2);
  const bucket = classifyIndustry(a.industry);
  const auto = bucket === "automotive" || signal(a.catenaXRelevance) || signal(a.pcfRelevance);

  // Sentence 1 — who they produce for (real names first, branch otherwise).
  let who: string;
  if (oems) who = `unter anderem für ${oems} produziert`;
  else if (custs.length) {
    who = bucket === "maschinenbau" || bucket === "chemie"
      ? `unter anderem ${custs.join(" und ")} beliefert`
      : `unter anderem für ${custs.join(" und ")} produziert`;
  } else who = whoByBucket(bucket);

  // Sentence 2 — strongest pain, phrased for the audience/branch.
  const kind: "oems" | Bucket = oems ? "oems" : auto ? "automotive" : bucket;
  const s2 = sentence2(kind, painPhrase(a, bucket));

  return `Bei unserer Recherche ist uns aufgefallen, dass ${a.company} ${who}. ${s2}`;
}

/** HeyCarbo email body paragraph per tone (A–E). Referenced by the HeyCarbo profile. */
export const HEYCARBO_VALUE: Record<Variant, string> = {
  A: "Mit HeyCarbo erstellen Sie CO₂-Bilanzen (Scope 1–3) und Product Carbon Footprints in Minuten – auditfähig, für den Mittelstand.",
  B: "Viele Zulieferer lösen das heute noch in Excel. Mit HeyCarbo erstellen Sie Scope-1-, Scope-2- und Scope-3-Bilanzen sowie Product Carbon Footprints in wenigen Minuten – auditfähig und für den industriellen Mittelstand gedacht.",
  C: "Mit HeyCarbo schließen Sie genau diese Lücke: Scope-1- bis Scope-3-Bilanzen und Product Carbon Footprints in Minuten – auditfähig, ohne Beraterheer.",
  D: "Statt Wochen in Excel: Mit HeyCarbo erstellen Sie Scope-1- bis Scope-3-Bilanzen und Product Carbon Footprints in Minuten – auditfähig und ohne externe Berater. Das spart Ihrem Team spürbar Zeit.",
  E: "Mit HeyCarbo erstellen Sie CO₂-Bilanzen (Scope 1–3) und Product Carbon Footprints in wenigen Minuten – auditfähig und für mittelständische Industrie gemacht.",
};

/** HeyCarbo closing ask per tone (A–E). Referenced by the HeyCarbo profile. */
export const HEYCARBO_CLOSING: Record<Variant, string> = {
  A: "Hätten Sie nächste Woche 15 Minuten für einen kurzen Austausch?",
  B: "Wenn das Thema bei Ihnen gerade relevant ist, zeige ich Ihnen in 15 Minuten, worauf es bei auditfähigen PCF-Daten wirklich ankommt. Hätten Sie nächste Woche kurz Zeit?",
  C: "Hätten Sie nächste Woche 15 Minuten? Ich zeige Ihnen, wie andere Zulieferer diese Anforderung heute ohne Mehraufwand erfüllen.",
  D: "Hätten Sie nächste Woche 15 Minuten? Ich zeige Ihnen gern, wie viel Aufwand andere Zulieferer damit heute einsparen.",
  E: "Wäre das für Sie gerade ein Thema? Über einen kurzen Austausch nächste Woche – 15 Minuten – würde ich mich freuen.",
};

/** A relevance field counts as a signal when present and not "low/none". */
const relevant = (v: string | undefined): boolean => !!v && /high|hoch|mittel|medium|yes|ja|true|relevant/i.test(v);

/** HeyCarbo campaign selection from the account's real carbon signals (deterministic). */
export function selectCampaignHeycarbo(a: Account): string {
  if (relevant(a.catenaXRelevance)) return "catena-x";
  if (relevant(a.pcfRelevance)) return "pcf";
  if (relevant(a.csrdRelevance)) return "csrd";
  const hay = `${a.supplierPressure ?? ""} ${a.painPoints.join(" ")}`.toLowerCase();
  if (/catena|pact|wbcsd/.test(hay)) return "catena-x";
  if (/pcf|14067|product carbon|cradle/.test(hay)) return "pcf";
  if (/csrd|esrs|berichtspflicht/.test(hay)) return "csrd";
  if (/lieferant|supplier|supply chain|scope ?3/.test(hay)) return "supplier-management";
  if (/ecovadis|cdp|esg|questionnaire|fragebogen/.test(hay)) return "esg";
  return "scope-3";
}

/** Build the four personalized paragraphs for one account in the requested tone (HeyCarbo). */
export function buildCopy(a: Account, v: Variant): EmailCopy {
  return {
    greeting: GREETING,
    intro: researchIntro(a), // standard opener — identical across all variants
    value: HEYCARBO_VALUE[v],
    closing: HEYCARBO_CLOSING[v],
  };
}
