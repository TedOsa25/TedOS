// Qualification agent (deterministic core).
//
// Fit (is this a company HeyAudit is built for?) and intent (do they want to
// buy now?) are scored SEPARATELY and never mixed: public evidence such as
// "several locations" can raise fit, but it is not a signal of buying intent.
// Only first-party actions (booking, inquiry, signup, reply) create intent.

import type { SalesEvent } from "./model.js";
import { companyKey, registrableDomain, zaehltAlsInteresse } from "./model.js";

export const QUALIFY_VERSION = "qualifizierung@1";

export type Level = "hoch" | "mittel" | "niedrig" | "keine" | "unbekannt";

export interface Qualification {
  version: string;
  fit: "yes" | "no" | "unknown";
  fitLevel: Level;
  fitReasons: string[];
  intent: Level;
  intentScore: number;
  intentReasons: string[];
  openQuestions: string[];
  internal: boolean;
}

const ICP = /(geb(ä|ae)ude ?reinigung|reinigungs?(service|dienst|firma|unternehmen|betrieb)|\breinigung\b|glas ?reinigung|unterhaltsreinigung|facility|geb(ä|ae)udeservice|geb(ä|ae)udedienst|hausmeister|objektbetreuung|geb(ä|ae)udemanagement|clean)/i;
const SECURITY = /(security|sicherheitsdienst|wachschutz|bewachung|werkschutz|objektschutz)/i;
const OFF_ICP = /(hotel|restaurant|steuerberat|rechtsanw|software|agentur|immobilienmakler|autohaus|arztpraxis)/i;

function text(e: SalesEvent): string {
  return [e.company, e.website, e.email, e.note].filter(Boolean).join(" ");
}

/** Internal/test traffic never counts as a lead. */
export function isInternal(events: SalesEvent[]): boolean {
  return events.some((e) => {
    const d = registrableDomain(e.email);
    const t = `${e.company ?? ""} ${e.person ?? ""}`.toLowerCase();
    return d === "heyaudit.de" || d === "heycarbo.com" || /bitte l(ö|oe)schen|\btest\b.*registrierung|\blivetest\b/.test(t)
      || (e.email ?? "").startsWith("tedosammor");
  });
}

function sizeFrom(note: string | undefined): string | undefined {
  const m = note?.match(/Gr(ö|oe)(ß|ss)e:\s*([^\n]+)/i);
  const v = m?.[3]?.trim();
  return v && !/folgt/i.test(v) ? v : undefined;
}

function branchFrom(note: string | undefined): string | undefined {
  const m = note?.match(/Branche:\s*([^\n]+)/i);
  const v = m?.[1]?.trim();
  return v && !/folgt/i.test(v) ? v : undefined;
}

export function qualify(events: SalesEvent[]): Qualification {
  const fitReasons: string[] = [];
  const intentReasons: string[] = [];
  const openQuestions: string[] = [];
  const internal = isInternal(events);

  // ── fit ────────────────────────────────────────────────────────────────
  const explicit = [...events].reverse().find((e) => e.fit && (e.kind === "demo_held" || e.origin === "manual"));
  const blob = events.map(text).join(" ");
  const branch = events.map((e) => branchFrom(e.note)).find(Boolean);
  const size = events.map((e) => sizeFrom(e.note)).find(Boolean);
  let fit: Qualification["fit"] = "unknown";
  if (explicit?.fit) {
    fit = explicit.fit;
    fitReasons.push(`Von Ted nach Gespräch festgelegt: ${explicit.fit}`);
  } else {
    const icp = ICP.test(blob) || (branch ? ICP.test(branch) : false);
    const security = SECURITY.test(blob);
    if (icp) fitReasons.push(branch ? `Branche laut Angabe: ${branch}` : "Name/Website deutet auf Reinigung oder Gebäudeservice");
    if (security && icp) fitReasons.push("Mischbetrieb Sicherheit + Reinigung — zulässig (Regel 07.10.)");
    if (security && !icp) { fit = "no"; fitReasons.push("Reiner Sicherheitsdienst — laut Gründerregel 07.10. kein Zielkunde"); }
    else if (OFF_ICP.test(blob) && !icp) { fit = "no"; fitReasons.push("Branche außerhalb des Zielkundenprofils"); }
    else if (icp) fit = "yes";
    if (size) fitReasons.push(`Größe laut Angabe: ${size}`);
  }
  if (!branch && fit !== "no") openQuestions.push("Branche bestätigen (Gebäudereinigung / Facility / Hausmeister?)");
  if (!size) openQuestions.push("Wie viele Mitarbeitende und Objekte?");
  const evidence = events.filter((e) => e.kind === "evidence" || e.kind === "target");
  for (const e of evidence) {
    if (e.note) fitReasons.push(`Öffentlicher Beleg: ${e.note.slice(0, 160)}${e.evidenceUrl ? ` (${e.evidenceUrl})` : ""}`);
  }
  if (evidence.length) openQuestions.push("Öffentliche Belege zeigen kein Kaufinteresse — Bedarf im Gespräch klären");

  // ── intent (first-party only) ──────────────────────────────────────────
  let score = 0;
  const has = (k: SalesEvent["kind"]) => events.some((e) => e.kind === k);
  if (has("booking") || has("booking_rescheduled")) { score = Math.max(score, 100); intentReasons.push("Demo selbst gebucht"); }
  if (has("inquiry")) { score = Math.max(score, 80); intentReasons.push("Demo-/Kontaktanfrage gestellt"); }
  // A plain Instagram answer (kontaktErbeten === false) is no buying signal.
  if (events.some((e) => e.kind === "reply" && zaehltAlsInteresse(e))) { score = Math.max(score, 70); intentReasons.push("Hat persönlich geantwortet"); }
  if (has("signup")) {
    const phone = events.some((e) => e.phone);
    const s = phone ? 60 : 40;
    score = Math.max(score, s);
    intentReasons.push(phone ? "Registriert und Telefon hinterlegt" : "Registriert (Free/Test)");
  }
  if (has("booking_canceled") && !events.some((e) => e.kind === "booking" && events.some((c) => c.kind === "booking_canceled" && c.at < e.at))) {
    intentReasons.push("Termin abgesagt");
    score -= 10;
  }
  if (has("opt_out")) { score = 0; intentReasons.push("Hat sich abgemeldet"); }
  if (!intentReasons.length) intentReasons.push("Kein Interessenssignal — nur recherchiert");
  const intent: Level = score >= 80 ? "hoch" : score >= 55 ? "mittel" : score > 0 ? "niedrig" : "keine";
  if (has("signup") && !has("booking")) openQuestions.push("Welches Problem soll HeyAudit lösen, und bis wann?");

  const fitLevel: Level = fit === "yes" ? "hoch" : fit === "no" ? "keine" : "unbekannt";
  return { version: QUALIFY_VERSION, fit, fitLevel, fitReasons, intent, intentScore: Math.max(0, score), intentReasons, openQuestions, internal };
}

/** Sort score for Ted's queue: intent first, then fit, then urgency (overdue first). */
export function priorityScore(q: Qualification, due: string, now: Date): number {
  const fitBonus = q.fit === "yes" ? 20 : q.fit === "no" ? -40 : 0;
  const overdueH = Math.max(0, (now.getTime() - Date.parse(due)) / 3_600_000);
  return q.intentScore + fitBonus + Math.min(30, overdueH);
}

export { companyKey };
