// A/B-ZUTEILUNG — damit nicht wieder 1.750 Mails mit derselben Botschaft rausgehen.
//
// Die Engine kann seit jeher fünf Copy-Tonalitäten (A–E) und drei
// Betreffvarianten. Benutzt wurde ausschliesslich Variante E mit Betreff 0 —
// 1.750-mal, ohne eine einzige Vergleichsgruppe. Der Kanal hat damit kein
// Volumen-, sondern ein Erkenntnisproblem: Es gibt keine Daten darüber, was
// wirkt, weil nie etwas anderes probiert wurde.
//
// ZUTEILUNG IST DETERMINISTISCH, nicht zufällig. Derselbe Lead bekommt immer
// denselben Arm — sonst würde eine Nachfassmail in anderer Tonalität kommen als
// der Erstkontakt, und die Auswertung wäre wertlos, sobald ein Lead zweimal
// angefasst wird. Der Hash ist stabil über Läufe und Maschinen hinweg.

import { createHash } from "node:crypto";
import type { Variant } from "./email-copy.js";

/** Standard-Arme: alle fünf Tonalitäten, alle drei Betreffzeilen. */
export const ALL_VARIANTS: Variant[] = ["A", "B", "C", "D", "E"];
export const ALL_SUBJECTS = [0, 1, 2];

export interface ExperimentConfig {
  variants: Variant[];
  subjects: number[];
}

/**
 * Konfiguration aus der Umgebung.
 *
 *   REVENUE_TEST_VARIANTS=A,B,C,D,E   (Standard: alle)
 *   REVENUE_TEST_SUBJECTS=0,1,2       (Standard: alle)
 *
 * Auf einen einzigen Wert gesetzt, verhält sich alles wie vorher — so lässt
 * sich ein laufender Test jederzeit einfrieren, etwa wenn ein Gewinner
 * feststeht.
 */
export function experimentConfig(env: NodeJS.ProcessEnv = process.env): ExperimentConfig {
  const v = (env.REVENUE_TEST_VARIANTS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  // Leere Einträge VOR Number() aussortieren: Number("") ist 0, nicht NaN —
  // eine nicht gesetzte Variable hätte den Betreff-Test sonst still auf
  // "nur Variante 0" eingefroren, also genau den Zustand, der behoben werden soll.
  const s = (env.REVENUE_TEST_SUBJECTS ?? "").split(",")
    .map((x) => x.trim()).filter(Boolean)
    .map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  const variants = v.filter((x): x is Variant => (ALL_VARIANTS as string[]).includes(x));
  return {
    variants: variants.length ? variants : ALL_VARIANTS,
    subjects: s.length ? s : ALL_SUBJECTS,
  };
}

/**
 * Stabiler Arm für einen Lead: sha256(leadId + salt) modulo Armanzahl.
 *
 * Gleichverteilt und reproduzierbar. `salt` trennt die Achsen, damit Tonalität
 * und Betreff nicht gekoppelt zugeteilt werden — sonst bekäme jeder Lead mit
 * Variante A immer denselben Betreff, und die beiden Effekte wären nicht mehr
 * auseinanderzuhalten.
 */
export function assignArm<T>(leadId: string, arms: T[], salt: string): T {
  if (arms.length <= 1) return arms[0] as T;
  const h = createHash("sha256").update(`${leadId}:${salt}`).digest();
  return arms[h.readUInt32BE(0) % arms.length] as T;
}

/** Tonalität und Betreffindex für einen Lead. */
export function assignExperiment(
  leadId: string,
  cfg: ExperimentConfig = experimentConfig(),
): { variant: Variant; subjectIndex: number } {
  return {
    variant: assignArm(leadId, cfg.variants, "variant"),
    subjectIndex: assignArm(leadId, cfg.subjects, "subject"),
  };
}

/**
 * Arme der Nachfassmails — eigene Achse, eigener Salt.
 *
 * Bewusst NICHT an die Tonalität des Erstkontakts gekoppelt: sonst bekäme jeder
 * Lead mit Tonalität E immer denselben Nachfasstext, und die beiden Wirkungen
 * wären nicht mehr zu trennen. Stufe 1 und Stufe 2 haben zusätzlich getrennte
 * Salts, damit sich die Arme nicht paarweise mitziehen.
 *
 *   REVENUE_TEST_FOLLOWUP1=0,1,2   (Standard: alle)
 *   REVENUE_TEST_FOLLOWUP2=0,1,2
 *
 * Auf einen Wert gesetzt friert die Stufe ein — so lässt sich ein Gewinner
 * festschreiben, ohne die andere Stufe anzuhalten.
 */
function armeAus(roh: string | undefined, anzahl: number): number[] {
  const gewaehlt = (roh ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < anzahl);
  return gewaehlt.length ? gewaehlt : Array.from({ length: anzahl }, (_, i) => i);
}

export function followUpConfig(
  anzahl1: number,
  anzahl2: number,
  env: NodeJS.ProcessEnv = process.env,
): { stufe1: number[]; stufe2: number[] } {
  return {
    stufe1: armeAus(env.REVENUE_TEST_FOLLOWUP1, anzahl1),
    stufe2: armeAus(env.REVENUE_TEST_FOLLOWUP2, anzahl2),
  };
}

/** Welcher Nachfasstext dieser Lead auf dieser Stufe bekommt. */
export function assignFollowUpArm(leadId: string, stage: 1 | 2, arme: number[]): number {
  return assignArm(leadId, arme, `followup${stage}`);
}

/** Einzeiler für Batch-Report und Preflight. */
export function describeExperiment(cfg: ExperimentConfig = experimentConfig()): string {
  const arme = cfg.variants.length * cfg.subjects.length;
  if (arme <= 1) return `kein Test aktiv — alle Mails identisch (Variante ${cfg.variants[0]}, Betreff ${cfg.subjects[0]})`;
  return `${arme} Arme · Tonalitäten ${cfg.variants.join("/")} × Betreff ${cfg.subjects.join("/")}`;
}
