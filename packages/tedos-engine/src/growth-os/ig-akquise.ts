// Instagram-Akquise, halbautomatisch. Rein, kein Netz, keine Uhr.
//
// Ablauf (vom Gruender am 12.11.2026 so festgelegt):
//   1. Morgens und abends je bis zu 15 Reinigungsfirmen als Charge vorschlagen.
//   2. Charge freigeben -> Claude folgt in der laufenden Chrome-Sitzung, langsam.
//   3. Wer zurueckfolgt, bekommt EINMAL die Danke-Nachricht mit Link.
// Kein Bot: Instagram verbietet automatisches Folgen und Nachrichten. Hier wird
// nur geplant, gezaehlt und doppelt Gemachtes verhindert.

import type { ApprovalInput } from "../approval-queue.js";
import { kampagnenLink } from "./content-plan.js";

export const JE_CHARGE = 15;
export const FOLGEN_JE_TAG = 30;
export const NACHRICHTEN_JE_TAG = 20;
export type Slot = "morgen" | "abend";

export interface Kandidat {
  handle: string; // ohne @
  name: string;
  ort?: string;
  grund: string; // warum passend (z. B. "Gebäudereinigung, Bio, letzter Post Nov.")
}

export type Status = "vorgeschlagen" | "gefolgt" | "zurueckgefolgt" | "angeschrieben" | "uebersprungen";

export interface Kontakt extends Kandidat {
  status: Status;
  charge: string; // z. B. 2026-11-12-abend
  gefolgtAm?: string;
  zurueckAm?: string;
  angeschriebenAm?: string;
}

export interface Bestand {
  kontakte: Record<string, Kontakt>;
}

export const normHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

/** Neue Charge: nur unbekannte Konten, hoechstens JE_CHARGE. */
export function neueCharge(kandidaten: Kandidat[], b: Bestand, datum: string, slot: Slot): Kontakt[] {
  const charge = `${datum}-${slot}`;
  const gesehen = new Set(Object.keys(b.kontakte));
  const out: Kontakt[] = [];
  for (const k of kandidaten) {
    const h = normHandle(k.handle);
    if (!h || gesehen.has(h)) continue;
    gesehen.add(h);
    out.push({ ...k, handle: h, status: "vorgeschlagen", charge });
    if (out.length >= JE_CHARGE) break;
  }
  return out;
}

export function chargeFreigabe(charge: Kontakt[]): ApprovalInput {
  const id = charge[0]?.charge ?? "leer";
  return {
    goalId: `growth:ig-folgen:${id}`,
    title: `Instagram: ${charge.length} Reinigungsfirmen folgen (${id})`,
    description: charge.map((k) => `@${k.handle} (${k.name}${k.ort ? `, ${k.ort}` : ""}): ${k.grund}`).join(" · "),
    businessImpact: 3,
    revenueImpact: 3,
    customerValue: 2,
    risk: "LOW",
    priorityScore: 35,
    files: [],
    estimatedEffort: "Liste ansehen, ca. 2 Minuten",
  };
}

const anTag = (iso: string | undefined, tag: string) => (iso ?? "").slice(0, 10) === tag;

/** Wie viele duerfen heute noch gefolgt werden? */
export function folgenRest(b: Bestand, tag: string): number {
  return Math.max(0, FOLGEN_JE_TAG - Object.values(b.kontakte).filter((k) => anTag(k.gefolgtAm, tag)).length);
}

/** Zurueckgefolgte, noch nicht angeschriebene Kontakte, im Tageslimit. */
export function faelligeNachrichten(b: Bestand, tag: string): Kontakt[] {
  const heute = Object.values(b.kontakte).filter((k) => anTag(k.angeschriebenAm, tag)).length;
  return Object.values(b.kontakte)
    .filter((k) => k.status === "zurueckgefolgt")
    .slice(0, Math.max(0, NACHRICHTEN_JE_TAG - heute));
}

/** Follower-Liste abgleichen: wem wir folgen und wer jetzt zurueckfolgt. */
export function zurueckGefolgt(b: Bestand, follower: string[], jetzt: string): string[] {
  const f = new Set(follower.map(normHandle));
  const neu: string[] = [];
  for (const k of Object.values(b.kontakte)) {
    if (k.status === "gefolgt" && f.has(k.handle)) {
      k.status = "zurueckgefolgt";
      k.zurueckAm = jetzt;
      neu.push(k.handle);
    }
  }
  return neu;
}

export const DM_LINK = kampagnenLink({ quelle: "instagram", medium: "dm", kampagne: "ig-dm-folgen" });
export const DM_LINK_FREE = `${DM_LINK}&plan=free`;
/** Kurzlink auf der Website (next.config.ts /gratis) -> DM_LINK_FREE, seit 12.11.2026. */
export const DM_KURZLINK = "heyaudit.de/gratis";

/**
 * Die eine Danke-Nachricht. Free laut App (lib/billing/plans.ts, Live 9e7f14d4):
 * 3 Mitarbeiter, 5 Objekte, ohne Angebote und Rechnungen -> darum "Planung und
 * Zeiterfassung" kostenlos, nicht "alles".
 */
export function dankNachricht(): string {
  return [
    "Hey, danke fürs Folgen! 🙌",
    "",
    "Falls ihr noch keine Software für euren Reinigungsalltag habt: HeyAudit ist speziell für Reinigungsfirmen gemacht. Alles an einem Ort:",
    "→ Objekt- und Einsatzplanung",
    "→ Zeiterfassung per App",
    "→ Leistungsnachweise mit Fotos",
    "→ Angebote und E-Rechnung",
    "",
    "Für bis zu 3 Mitarbeiter und 5 Objekte sind Planung und Zeiterfassung dauerhaft kostenlos. Schaut gern rein:",
    DM_KURZLINK,
  ].join("\n");
}
