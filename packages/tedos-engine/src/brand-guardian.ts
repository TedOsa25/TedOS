// Brand Guardian — content QA for the HeyCarbo Growth Engine.
//
// Runs before any content is previewed/approved. It auto-corrects mechanical
// brand-voice issues (double spaces, double hyphens) and flags issues a human
// must resolve (AI-filler phrases, greenwashing/unverifiable claims, missing
// CTA). It does NOT publish and does NOT change the Brandbook — the Brandbook
// (HeyCarbo/docs/BRANDBOOK.md) remains the highest authority. Deterministic.

/** The approved CTAs the Growth Engine rotates through. */
export const CTAS = [
  "Kostenlos testen",
  "Demo buchen",
  "Lieferanten kostenlos einladen",
  "Scope-3 analysieren",
  "CO₂-Daten hochladen",
  "Supplier Portal testen",
  "Jetzt starten",
] as const;

/** Phrases that read as AI-generated filler — warned, not auto-removed. */
const AI_FILLER = [
  "lassen sie uns",
  "eintauchen",
  "nahtlos",
  "mühelos",
  "in der heutigen schnelllebigen",
  "in der heutigen digitalen",
  "game-changer",
  "gamechanger",
  "revolutionär",
  "entfesseln",
  "es ist wichtig zu beachten",
  "zusammenfassend lässt sich sagen",
  "in conclusion",
  "delve",
];

/** Unverifiable / greenwashing claims — blocked until a human edits them. */
const GREENWASHING = [
  "100% klimaneutral",
  "völlig nachhaltig",
  "komplett nachhaltig",
  "zero emissions",
  "co2-frei",
  "co₂-frei",
  "grünste",
  "umweltfreundlichste",
  "garantiert nachhaltig",
];

export type BrandIssueKind =
  | "double-space"
  | "double-hyphen"
  | "ai-filler"
  | "greenwashing"
  | "missing-cta"
  | "em-dash-overuse";

export type BrandSeverity = "auto-fixed" | "warning" | "block";

export interface BrandIssue {
  kind: BrandIssueKind;
  severity: BrandSeverity;
  detail: string;
}

export interface BrandCheck {
  /** True when no blocking issues remain (safe to preview). */
  ok: boolean;
  /** The text after mechanical auto-corrections. */
  corrected: string;
  issues: BrandIssue[];
}

/** Collapse double spaces and repeated hyphens; trim each line. */
export function autoCorrect(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").replace(/-{2,}/g, "-").replace(/\s+$/g, ""))
    .join("\n");
}

/** Validate content against brand-voice rules and auto-correct the mechanical ones. */
export function checkContent(text: string): BrandCheck {
  const issues: BrandIssue[] = [];
  const lower = text.toLowerCase();

  if (/ {2,}/.test(text)) issues.push({ kind: "double-space", severity: "auto-fixed", detail: "collapsed double spaces" });
  if (/-{2,}/.test(text)) issues.push({ kind: "double-hyphen", severity: "auto-fixed", detail: "collapsed repeated hyphens" });

  const emDashes = (text.match(/—/g) ?? []).length;
  if (emDashes > 2) issues.push({ kind: "em-dash-overuse", severity: "warning", detail: `${emDashes} em-dashes (reads AI-generated)` });

  for (const phrase of AI_FILLER) {
    if (lower.includes(phrase)) issues.push({ kind: "ai-filler", severity: "warning", detail: `AI-filler phrase: "${phrase}"` });
  }
  for (const claim of GREENWASHING) {
    if (lower.includes(claim)) issues.push({ kind: "greenwashing", severity: "block", detail: `unverifiable/greenwashing claim: "${claim}"` });
  }
  if (!CTAS.some((cta) => text.includes(cta))) {
    issues.push({ kind: "missing-cta", severity: "warning", detail: "no approved CTA present" });
  }

  return {
    ok: !issues.some((i) => i.severity === "block"),
    corrected: autoCorrect(text),
    issues,
  };
}

/** Deterministic CTA rotation (wraps). */
export function rotateCTA(index: number): string {
  const i = ((index % CTAS.length) + CTAS.length) % CTAS.length;
  return CTAS[i] as string;
}

/** Append a demo calendar link to a CTA when one is configured. */
export function withCalendar(cta: string, calendarUrl?: string): string {
  return calendarUrl ? `${cta} → ${calendarUrl}` : cta;
}
