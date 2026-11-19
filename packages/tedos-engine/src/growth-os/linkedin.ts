// LinkedIn-Wochenplan: drei Posts je Woche mit denselben Motiven wie Instagram.
// Rein, kein Netz. VEROEFFENTLICHT NICHTS: der Plan geht als ein Vorschlag in
// die Freigabe; geplant wird danach von Hand bzw. per Browser auf der Seite.
//
// Unterschied zu Instagram: Link ist klickbar, deshalb steht der Tracking-Link
// im Text (utm_campaign = li-<jahr>-kw<nn>-<motiv>), nur 3 Hashtags, Pfeile
// statt Haken, sachlicher Schluss.

import type { ApprovalInput } from "../approval-queue.js";
import { beitragsKampagne, kampagnenLink, pruefeText, type Befund, type Wochenplan } from "./content-plan.js";
import type { FormatMotiv } from "./format-katalog.js";

/** Di, Mi, Do (Versatz ab Montag). Werktags morgens liest die Zielgruppe LinkedIn. */
export const LINKEDIN_VERSATZ = [1, 2, 3];
export const LINKEDIN_UHRZEIT = "08:30";
export const LINKEDIN_MAX_ZEICHEN = 3000;
const LINKEDIN_TAGS = ["#Gebäudereinigung", "#Reinigungsbranche"];

export interface LinkedinEintrag {
  datum: string;
  wochentag: string;
  uhrzeit: string;
  motivId: string;
  titel: string;
  bild: string; // Dateiname in motive/
  text: string;
  link: string;
  befunde: Befund[];
}

export interface LinkedinPlan {
  jahr: number;
  kw: number;
  montag: string;
  eintraege: LinkedinEintrag[];
}

export function linkedinText(m: FormatMotiv, link: string): string {
  const t = m.text_;
  const tags = [...LINKEDIN_TAGS, t.tags[0]!.replace(/^#(\p{L})/u, (_, c: string) => `#${c.toUpperCase()}`)];
  return [t.hook, "", t.einleitung, "", ...t.punkte.map((p) => `→ ${p}`), "", t.absatz, "", "HeyAudit läuft im Browser, ohne Installation. 14 Tage kostenlos testen:", link, "", tags.join(" ")].join("\n");
}

export function pruefeLinkedin(text: string): Befund[] {
  // Markenregeln wie Instagram (Preise, verbotene Aussagen), Laenge nach LinkedIn.
  const b = pruefeText(text).filter((x) => !/Zeichen, Instagram/.test(x.text));
  if (text.length > LINKEDIN_MAX_ZEICHEN) b.push({ stufe: "fehler", text: `${text.length} Zeichen, LinkedIn erlaubt ${LINKEDIN_MAX_ZEICHEN}` });
  return b;
}

/** Aus dem freigegebenen Instagram-Tagesplan der Woche: Di, Mi, Do. */
export function baueLinkedinPlan(ig: Wochenplan): LinkedinPlan {
  const eintraege: LinkedinEintrag[] = [];
  for (const v of LINKEDIN_VERSATZ) {
    const e = ig.eintraege[v];
    const m = e?.motiv as FormatMotiv | undefined;
    if (!e || !m?.text_) continue;
    const link = kampagnenLink({ quelle: "linkedin", medium: "organic", kampagne: beitragsKampagne("li", ig.jahr, ig.kw, m.id), inhalt: m.id });
    const text = linkedinText(m, link);
    eintraege.push({ datum: e.datum, wochentag: e.wochentag, uhrzeit: LINKEDIN_UHRZEIT, motivId: m.id, titel: m.titel, bild: `${m.id}.png`, text, link, befunde: pruefeLinkedin(text) });
  }
  return { jahr: ig.jahr, kw: ig.kw, montag: ig.montag, eintraege };
}

export function linkedinFreigabe(p: LinkedinPlan): ApprovalInput {
  const kw = String(p.kw).padStart(2, "0");
  return {
    goalId: `growth:content:li-${p.jahr}-kw${kw}`,
    title: `LinkedIn-Wochenplan KW ${kw}: ${p.eintraege.length} Posts`,
    description: `Ab ${p.montag}. ${p.eintraege.map((e) => `${e.wochentag.slice(0, 2)} ${e.titel}`).join(" · ")}. Gleiche Motive wie Instagram, Link mit Tracking. Veröffentlicht wird erst nach Freigabe.`,
    businessImpact: 4,
    revenueImpact: 3,
    customerValue: 4,
    risk: "MEDIUM",
    priorityScore: 45,
    files: [],
    estimatedEffort: "Freigabe lesen, ca. 3 Minuten",
  };
}

export function renderLinkedinPlan(p: LinkedinPlan): string {
  const kw = String(p.kw).padStart(2, "0");
  const z = [`# LinkedIn-Wochenplan KW ${kw} (${p.jahr})`, "", `Woche ab ${p.montag}. **Entwurf, nichts ist veröffentlicht.** Bild jeweils aus motive/ (gleich wie Instagram).`, ""];
  for (const e of p.eintraege) {
    z.push(`## ${e.wochentag} ${e.datum}, ${e.uhrzeit} · ${e.titel}`, `- Bild: motive/${e.bild}`, `- Tracking: ${e.link}`);
    for (const b of e.befunde) z.push(`- ${b.stufe === "fehler" ? "FEHLER" : "Hinweis"}: ${b.text}`);
    z.push("", "```", e.text, "```", "");
  }
  return z.join("\n");
}
