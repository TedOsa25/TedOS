// Instagram-Wochenplan des Content-Agenten. Rein: keine Uhr, kein Netz.
//
// Waehlt aus dem Katalog die Motive fuer die naechste Woche (am laengsten
// nicht gezeigte zuerst, hoechstens zwei je Saeule), setzt Beitragstext,
// Aufruf, Hashtags und einen Link mit UTM-Kennung (Signup speichert die UTM),
// und prueft jeden Text gegen die Markenregeln. Ergebnis ist EIN Vorschlag
// fuer die Freigabe-Warteschlange. Veroeffentlicht wird hier nichts.

import type { ApprovalInput } from "../approval-queue.js";
import { HASHTAGS, type Format, type Motiv, type Saeule } from "./content-katalog.js";

export const SIGNUP_URL = "https://app.heyaudit.de/signup";
export const AUFRUF = "14 Tage kostenlos testen. Link in der Bio.";
export const MAX_JE_SAEULE = 2;
export const MAX_HASHTAGS = 12; // Format vom 04.11. nutzt 12
export const MAX_ZEICHEN = 2200; // Instagram-Grenze fuer Beitragstexte

/** Feed an Mo/Mi/Fr/So, Storys an Di/Do. Uhrzeit ist eine Annahme, bis eigene Insights vorliegen. */
export const FEED_TAGE = [0, 2, 4, 6] as const; // Versatz ab Montag
export const STORY_TAGE = [1, 3] as const;
export const UHRZEIT_ANNAHME = "08:00"; // der taegliche Lauf veroeffentlicht um 08:00

/**
 * Erlaubte Preisangaben, Stand heyaudit-dashboard lib/billing/plans.ts
 * (2026-11-11): Starter 49 € (jaehrlich 468 € = 39 €/Monat),
 * Business 79 € (828 € = 69 €), Pro 179 € (1.788 € = 149 €).
 */
export const ERLAUBTE_PREISE = [39, 49, 69, 79, 149, 179];

const VERBOTEN: { muster: RegExp; grund: string }[] = [
  { muster: /\b(Sie|Ihnen|Ihr|Ihre|Ihren)\b/, grund: "Siezen: Instagram duzt" },
  { muster: /garantiert|Nr\.\s*1|beste[nr]? (Software|App)|marktführend/i, grund: "unbelegter Superlativ" },
  { muster: /für immer kostenlos|dauerhaft kostenlos/i, grund: "falsches Preisversprechen" },
  { muster: /zertifiziert/i, grund: "Zertifizierung ohne Beleg" },
  { muster: /\d+\s?%\s*(weniger|mehr|schneller|Zeit)/i, grund: "erfundene Wirkungszahl" },
];

export interface Befund {
  stufe: "fehler" | "hinweis";
  text: string;
}

export interface PlanEintrag {
  datum: string; // YYYY-MM-DD
  wochentag: string;
  uhrzeit: string;
  art: "feed" | "story";
  motiv: Motiv;
  beitragstext: string;
  link: string;
  befunde: Befund[];
}

export interface Wochenplan {
  jahr: number;
  kw: number;
  montag: string;
  eintraege: PlanEintrag[];
  warnungen: string[];
}

const TAG = 86_400_000;
const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

const isoTag = (d: Date) => d.toISOString().slice(0, 10);

/** ISO-Kalenderwoche des Datums (UTC). */
export function isoWoche(d: Date): { jahr: number; kw: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wt = (t.getUTCDay() + 6) % 7; // Mo = 0
  t.setUTCDate(t.getUTCDate() - wt + 3); // Donnerstag derselben Woche
  const jahr = t.getUTCFullYear();
  const kw = Math.ceil(((t.getTime() - Date.UTC(jahr, 0, 1)) / TAG + 1) / 7);
  return { jahr, kw };
}

/** Montag der Woche NACH `jetzt`: geplant wird immer die kommende Woche. */
export function naechsterMontag(jetzt: Date): Date {
  const t = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate()));
  const wt = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() + (7 - wt) * TAG);
}

/**
 * Tracking-Link auf die Registrierung. Die App speichert je Anmeldung nur
 * utm_source und utm_campaign (Funnel-Zaehler), deshalb steckt der einzelne
 * Beitrag in utm_campaign: <kanal>-<jahr>-kw<nn>-<motiv>.
 */
export function kampagnenLink(o: { quelle: string; medium: string; kampagne: string; inhalt?: string }): string {
  const p = new URLSearchParams({ utm_source: o.quelle, utm_medium: o.medium, utm_campaign: o.kampagne.slice(0, 80) });
  if (o.inhalt) p.set("utm_content", o.inhalt);
  return `${SIGNUP_URL}?${p}`;
}

export const beitragsKampagne = (kanal: string, jahr: number, kw: number, motivId: string) =>
  `${kanal}-${jahr}-kw${String(kw).padStart(2, "0")}-${motivId}`;

export function utmLink(motivId: string, jahr: number, kw: number, art: "feed" | "story"): string {
  return kampagnenLink({ quelle: "instagram", medium: `organic_${art}`, kampagne: beitragsKampagne("ig", jahr, kw, motivId), inhalt: motivId });
}

/** Markenregeln. Fehler blockieren die Freigabe nicht, stehen aber oben im Plan. */
export function pruefeText(text: string): Befund[] {
  const b: Befund[] = [];
  if (text.length > MAX_ZEICHEN) b.push({ stufe: "fehler", text: `${text.length} Zeichen, Instagram erlaubt ${MAX_ZEICHEN}` });
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length > MAX_HASHTAGS) b.push({ stufe: "hinweis", text: `${tags.length} Hashtags, empfohlen höchstens ${MAX_HASHTAGS}` });
  for (const v of VERBOTEN) if (v.muster.test(text)) b.push({ stufe: "fehler", text: v.grund });
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d{3})*)\s?€/g)) {
    const betrag = Number(m[1]!.replace(/\./g, ""));
    if (!ERLAUBTE_PREISE.includes(betrag)) b.push({ stufe: "fehler", text: `Preis ${m[0]} passt zu keinem Tarif` });
  }
  if (!text.includes("14 Tage")) b.push({ stufe: "hinweis", text: "kein Aufruf zum kostenlosen Test" });
  return b;
}

function formatArt(f: Format): "feed" | "story" {
  return f === "story_9x16" ? "story" : "feed";
}

/** Am laengsten nicht gezeigte zuerst; nie gezeigte vor allen, Katalog-Reihenfolge als Gleichstand. */
function nachFrische(motive: Motiv[], zuletzt: Map<string, string>): Motiv[] {
  return motive
    .map((m, i) => ({ m, i, d: zuletzt.get(m.id) ?? "" }))
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1))
    .map((x) => x.m);
}

function waehle(motive: Motiv[], anzahl: number): Motiv[] {
  const je = new Map<Saeule, number>();
  const gewaehlt: Motiv[] = [];
  for (const m of motive) {
    if (gewaehlt.length >= anzahl) break;
    if ((je.get(m.saeule) ?? 0) >= MAX_JE_SAEULE) continue;
    gewaehlt.push(m);
    je.set(m.saeule, (je.get(m.saeule) ?? 0) + 1);
  }
  // Reicht die Mischung nicht, wird mit den naechstfrischen aufgefuellt.
  for (const m of motive) if (gewaehlt.length < anzahl && !gewaehlt.includes(m)) gewaehlt.push(m);
  return gewaehlt;
}

export function baueWochenplan(
  katalog: Motiv[],
  opt: { jetzt: Date; verlauf?: { motivId: string; datum: string }[] },
): Wochenplan {
  const montag = naechsterMontag(opt.jetzt);
  const { jahr, kw } = isoWoche(montag);
  const zuletzt = new Map<string, string>();
  for (const v of opt.verlauf ?? []) if ((zuletzt.get(v.motivId) ?? "") < v.datum) zuletzt.set(v.motivId, v.datum);

  const feed = waehle(nachFrische(katalog.filter((m) => formatArt(m.format) === "feed"), zuletzt), FEED_TAGE.length);
  const storys = waehle(nachFrische(katalog.filter((m) => formatArt(m.format) === "story"), zuletzt), STORY_TAGE.length);

  const eintrag = (m: Motiv, versatz: number): PlanEintrag => {
    const tag = new Date(montag.getTime() + versatz * TAG);
    const art = formatArt(m.format);
    const beitragstext = art === "feed" ? `${m.text}\n\n${AUFRUF}\n\n${HASHTAGS.join(" ")}` : `${m.text}\n\n14 Tage kostenlos testen.`;
    return {
      datum: isoTag(tag),
      wochentag: WOCHENTAGE[versatz]!,
      uhrzeit: UHRZEIT_ANNAHME,
      art,
      motiv: m,
      beitragstext,
      link: utmLink(m.id, jahr, kw, art),
      befunde: pruefeText(beitragstext),
    };
  };

  const eintraege = [
    ...feed.map((m, i) => eintrag(m, FEED_TAGE[i]!)),
    ...storys.map((m, i) => eintrag(m, STORY_TAGE[i]!)),
  ].sort((a, b) => a.datum.localeCompare(b.datum));

  const warnungen: string[] = [];
  if (feed.length < FEED_TAGE.length) warnungen.push(`Nur ${feed.length} Feed-Motive im Katalog, geplant wären ${FEED_TAGE.length}.`);
  const wiederholt = eintraege.filter((e) => zuletzt.has(e.motiv.id));
  if (wiederholt.length) warnungen.push(`Wiederholung: ${wiederholt.map((e) => e.motiv.titel).join(", ")} (Katalog erweitern).`);
  const fehler = eintraege.filter((e) => e.befunde.some((x) => x.stufe === "fehler"));
  if (fehler.length) warnungen.push(`${fehler.length} Beitrag/Beiträge verletzen Markenregeln.`);

  return { jahr, kw, montag: isoTag(montag), eintraege, warnungen };
}

/** Ein Freigabe-Vorschlag fuer die ganze Woche. */
export function wochenplanFreigabe(p: Wochenplan): ApprovalInput {
  const kw = String(p.kw).padStart(2, "0");
  return {
    goalId: `growth:content:ig-${p.jahr}-kw${kw}`,
    title: `Instagram-Wochenplan KW ${kw}: ${p.eintraege.filter((e) => e.art === "feed").length} Posts, ${p.eintraege.filter((e) => e.art === "story").length} Storys`,
    description: `Ab ${p.montag}. ${p.eintraege.map((e) => `${e.wochentag.slice(0, 2)} ${e.motiv.titel}`).join(" · ")}. Veröffentlicht wird erst nach Freigabe.${p.warnungen.length ? " Achtung: " + p.warnungen.join(" ") : ""}`,
    businessImpact: 5,
    revenueImpact: 4,
    customerValue: 5,
    risk: "MEDIUM",
    priorityScore: 55,
    files: [],
    estimatedEffort: "Freigabe lesen, ca. 5 Minuten",
  };
}

export function renderWochenplan(p: Wochenplan): string {
  const kw = String(p.kw).padStart(2, "0");
  const z: string[] = [`# Instagram-Wochenplan KW ${kw} (${p.jahr})`, "", `Woche ab ${p.montag}. **Entwurf, nichts ist veröffentlicht.** Uhrzeiten sind eine Annahme, bis eigene Insights vorliegen.`, ""];
  if (p.warnungen.length) z.push("## Achtung", ...p.warnungen.map((w) => `- ${w}`), "");
  for (const e of p.eintraege) {
    z.push(`## ${e.wochentag} ${e.datum}, ${e.uhrzeit} · ${e.art === "feed" ? "Post" : "Story"} · ${e.motiv.titel}`);
    z.push(`- Motiv: ${e.motiv.schlagzeile}`);
    z.push(`- Bild: Artboard \`${e.motiv.quelle.artboard}\` in ${e.motiv.quelle.canvas}`);
    z.push(`- Link (Bio bzw. Story-Link): ${e.link}`);
    for (const b of e.befunde) z.push(`- ${b.stufe === "fehler" ? "FEHLER" : "Hinweis"}: ${b.text}`);
    z.push("", "```", e.beitragstext, "```", "");
  }
  return z.join("\n");
}
