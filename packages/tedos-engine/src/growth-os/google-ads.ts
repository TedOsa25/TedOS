// Google-Suchanzeigen: ENTWURF einer Suchkampagne fuer HeyAudit. Rein, kein Netz.
// Schaltet nichts. Der Entwurf geht als ein Vorschlag in die Freigabe; angelegt
// wird die Kampagne erst danach (Google Ads ist noch nicht angebunden).
//
// Grenzen von Google fuer responsive Suchanzeigen: Anzeigentitel <= 30 Zeichen
// (3 bis 15 Stueck), Beschreibungen <= 90 Zeichen (2 bis 4 Stueck).
// Aussagen nur, was Instagram-Format und App belegen (format-katalog.ts).

import type { ApprovalInput } from "../approval-queue.js";
import { ERLAUBTE_PREISE, kampagnenLink, type Befund } from "./content-plan.js";

export const MAX_TITEL = 30;
export const MAX_BESCHREIBUNG = 90;

export interface Anzeigengruppe {
  id: string;
  name: string;
  /** Wortgruppe ("…") und genau passend ([…]). Kein weitgehend passend: zu teuer fuer den Start. */
  keywords: string[];
}

export interface SuchEntwurf {
  kampagne: string;
  tagesbudgetEuro: number;
  maxCpcEuro: number;
  standorte: string[];
  sprache: string;
  gruppen: (Anzeigengruppe & { link: string })[];
  titel: string[];
  beschreibungen: string[];
  ausschluesse: string[];
  befunde: Befund[];
}

const GRUPPEN: Anzeigengruppe[] = [
  { id: "software", name: "Software Gebäudereinigung", keywords: ['"software gebäudereinigung"', '"reinigungssoftware"', '"app für reinigungsfirma"', "[software für reinigungsfirmen]", '"programm gebäudereinigung"'] },
  { id: "zeiterfassung", name: "Zeiterfassung Reinigung", keywords: ['"zeiterfassung gebäudereinigung"', '"zeiterfassung reinigungskräfte"', '"zeiterfassung app reinigung"', '"zeiterfassung reinigungsfirma"'] },
  { id: "planung", name: "Einsatz- und Schichtplanung", keywords: ['"einsatzplanung gebäudereinigung"', '"dienstplan reinigungsfirma"', '"schichtplan reinigungskräfte"', '"objektplanung reinigung"'] },
  { id: "datev", name: "Lohnexport DATEV", keywords: ['"zeiterfassung datev export"', '"stunden export datev lohn"', '"zeiterfassung lexware export"'] },
];

export const TITEL = [
  "Software für Gebäudereinigung",
  "Zeiterfassung per App",
  "14 Tage kostenlos testen",
  "Ab 39 € im Monat",
  "Ohne Installation starten",
  "Mitarbeiter-App, 15 Sprachen",
  "Schichtplan für Reinigung",
  "Export für DATEV und Lexware",
  "Leistungsnachweis mit Fotos",
  "Ohne Demo-Termin testen",
  "Einsatzplanung per App",
  "Krankmeldung direkt im Plan",
  "Reinigungsfirma digital führen",
  "Qualitätskontrolle mit Fotos",
  "HeyAudit für Reinigungsfirmen",
];

export const BESCHREIBUNGEN = [
  "Einsätze planen, Zeiten erfassen, Nachweise mit Fotos. Alles in einer App für dein Team.",
  "14 Tage kostenlos testen. Im Browser starten, ohne Installation und ohne Demo-Termin.",
  "Monatsstunden je Mitarbeiter als Export für DATEV Lohn und Gehalt oder Lexware.",
  "Mitarbeiter-App in 15 Sprachen. Krankmeldung, Urlaub und Schichtplan an einem Ort.",
];

/** Suchanfragen von Jobsuchenden und Privatleuten ausschliessen. */
export const AUSSCHLUESSE = ["job", "jobs", "stellenangebot", "stellenangebote", "minijob", "ausbildung", "gehalt", "lohn reinigungskraft", "putzfrau", "privat", "haushalt", "reinigungsmittel", "reinigungsmaschine", "kostenlos download", "excel vorlage"];

export function pruefeSuchanzeige(titel: string[], beschreibungen: string[]): Befund[] {
  const b: Befund[] = [];
  if (titel.length < 3 || titel.length > 15) b.push({ stufe: "fehler", text: `${titel.length} Anzeigentitel, erlaubt 3 bis 15` });
  if (beschreibungen.length < 2 || beschreibungen.length > 4) b.push({ stufe: "fehler", text: `${beschreibungen.length} Beschreibungen, erlaubt 2 bis 4` });
  for (const t of titel) if (t.length > MAX_TITEL) b.push({ stufe: "fehler", text: `Titel zu lang (${t.length}/${MAX_TITEL}): ${t}` });
  for (const d of beschreibungen) if (d.length > MAX_BESCHREIBUNG) b.push({ stufe: "fehler", text: `Beschreibung zu lang (${d.length}/${MAX_BESCHREIBUNG}): ${d}` });
  const alle = [...titel, ...beschreibungen];
  if (new Set(titel.map((t) => t.toLowerCase())).size !== titel.length) b.push({ stufe: "fehler", text: "Doppelter Anzeigentitel" });
  for (const t of alle) {
    for (const m of t.matchAll(/(\d{1,3}(?:\.\d{3})*)\s?€/g)) {
      if (!ERLAUBTE_PREISE.includes(Number(m[1]!.replace(/\./g, "")))) b.push({ stufe: "fehler", text: `Preis ${m[0]} passt zu keinem Tarif` });
    }
    if (/garantiert|Nr\.\s*1|beste[nr]? |marktführend|zertifiziert|\d+\s?%/i.test(t)) b.push({ stufe: "fehler", text: `Unbelegte Aussage: ${t}` });
    if (/\b(Sie|Ihnen|Ihr|Ihre)\b/.test(t)) b.push({ stufe: "fehler", text: `Siezen (HeyAudit duzt): ${t}` });
  }
  return b;
}

/**
 * Startvorschlag: kleines Budget, nur Deutschland, nur Suche (kein Display).
 * Zahlen sind Annahmen fuer den Test, keine Erfahrungswerte.
 */
export function baueSuchEntwurf(): SuchEntwurf {
  const kampagne = "gads-suche-reinigung";
  return {
    kampagne,
    tagesbudgetEuro: 10,
    maxCpcEuro: 2.5,
    standorte: ["Deutschland"],
    sprache: "Deutsch",
    gruppen: GRUPPEN.map((g) => ({ ...g, link: kampagnenLink({ quelle: "google", medium: "cpc", kampagne: `${kampagne}-${g.id}`, inhalt: "{creative}" }).replace("%7Bcreative%7D", "{creative}") })),
    titel: TITEL,
    beschreibungen: BESCHREIBUNGEN,
    ausschluesse: AUSSCHLUESSE,
    befunde: pruefeSuchanzeige(TITEL, BESCHREIBUNGEN),
  };
}

export const GOOGLE_GOAL = "growth:google:suche-entwurf-v1";

export function suchFreigabe(e: SuchEntwurf): ApprovalInput {
  return {
    goalId: GOOGLE_GOAL,
    title: `Google-Suchkampagne (Entwurf): ${e.gruppen.length} Anzeigengruppen, ${e.tagesbudgetEuro} € pro Tag`,
    description: `Nur Suche, ${e.standorte.join(", ")}. Gruppen: ${e.gruppen.map((g) => g.name).join(" · ")}. Freigabe heißt: Kampagne PAUSIERT anlegen. Scharf geschaltet wird erst nach einer zweiten Freigabe.`,
    businessImpact: 4,
    revenueImpact: 4,
    customerValue: 3,
    risk: "HIGH",
    priorityScore: 40,
    files: [],
    estimatedEffort: "Entwurf lesen, ca. 5 Minuten",
  };
}

export function renderSuchEntwurf(e: SuchEntwurf): string {
  const z = [
    "# Google-Suchkampagne · Entwurf",
    "",
    "**Nichts ist geschaltet.** Freigabe heißt: Kampagne pausiert anlegen. Scharf erst nach zweiter Freigabe.",
    "",
    `- Kampagne: \`${e.kampagne}\` · nur Suchnetzwerk · ${e.standorte.join(", ")} · ${e.sprache}`,
    `- Budget: ${e.tagesbudgetEuro} € pro Tag (Annahme für den Test) · Gebot: Klicks maximieren, max. CPC ${e.maxCpcEuro.toFixed(2).replace(".", ",")} €`,
    "- Conversion: Registrierung auf app.heyaudit.de (utm_campaign je Anzeigengruppe)",
    "",
  ];
  if (e.befunde.length) z.push("## Befunde", ...e.befunde.map((b) => `- ${b.stufe === "fehler" ? "FEHLER" : "Hinweis"}: ${b.text}`), "");
  z.push("## Anzeigengruppen");
  for (const g of e.gruppen) z.push("", `### ${g.name}`, `- Ziel-URL: ${g.link}`, ...g.keywords.map((k) => `- ${k}`));
  z.push("", `## Anzeigentitel (${e.titel.length}, max. ${MAX_TITEL} Zeichen)`, ...e.titel.map((t) => `- ${t} (${t.length})`));
  z.push("", `## Beschreibungen (${e.beschreibungen.length}, max. ${MAX_BESCHREIBUNG} Zeichen)`, ...e.beschreibungen.map((t) => `- ${t} (${t.length})`));
  z.push("", "## Auszuschließende Suchbegriffe", e.ausschluesse.join(", "), "");
  return z.join("\n");
}
