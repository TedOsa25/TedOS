// Tages-Motive im Format des Posts vom 04.11.2026 ("Gebaeudereinigung ohne
// Zettelchaos", 0,11 € pro Link-Klick). Der Gruender will dieses Format
// beibehalten: Bild = Logo, Headline mit gelber Markierung, Handy-Screen
// rechts, gelbe Ringe, Button "14 Tage kostenlos testen", "Ab 39 € / Monat".
// Text = Hook mit Emoji, "Mit HeyAudit …:", ✓-Liste, Absatz, fester Schluss,
// heyaudit.de, 12 Hashtags.
//
// Jeder Wochentag hat ein Thema; je Thema mindestens zwei Motive, damit sich
// zwei Wochen lang nichts wiederholt. Behauptet wird nur, was der Gruender
// selbst schon in Anzeigen oder Design zeigt (Funktionsliste vom 04.11.).
// Abgrenzung zur Konkurrenz (Meta-Werbebibliothek, 11.11.2026): PlanD siezt,
// nennt keinen Preis und verlangt einen Demo-Termin. HeyAudit duzt, zeigt den
// Preis und laesst sofort selbst testen.

import type { Motiv, Saeule } from "./content-katalog.js";

export type Thema = "planung" | "zeit" | "abwesenheit" | "qualitaet" | "nachweis" | "team" | "umstieg";

/** Montag = 0 … Sonntag = 6. */
export const THEMA_JE_TAG: Thema[] = ["planung", "zeit", "abwesenheit", "qualitaet", "nachweis", "team", "umstieg"];

export interface FormatMotiv extends Motiv {
  thema: Thema;
  bild: { vor: string; mark: string; nach: string; unterzeile: string; screen: string };
  text_: { hook: string; einleitung: string; punkte: string[]; absatz: string; tags: string[] };
}

export const BASIS_TAGS = ["#gebäudereinigung", "#reinigungsfirma", "#reinigungsunternehmen", "#gebäudereiniger", "#facilitymanagement", "#reinigungsbranche", "#objektleitung"];
export const END_TAGS = ["#reinigungssoftware", "#heyaudit"];
export const SCHLUSS = "Einfach im Browser starten – ohne Installation.\nTeste HeyAudit 14 Tage kostenlos.\n\nMehr Überblick für deinen Reinigungsalltag: heyaudit.de";

/** Beitragstext im Format vom 04.11. */
export function formatText(t: FormatMotiv["text_"]): string {
  return [t.hook, "", t.einleitung, "", ...t.punkte.map((p) => `✓ ${p}`), "", t.absatz, "", SCHLUSS, "", [...BASIS_TAGS, ...t.tags, ...END_TAGS].join(" ")].join("\n");
}

// --- Bausteine fuer den Handy-Screen (gleiches Design wie Post.dc.html) ---
const A = "#F7D447", HELL = "#FCEDB0", INK = "#0f1115", GRAU = "#44403C", G2 = "#57534E";
const karte = (inhalt: string, extra = "") => `<div style="background:#fff;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:8px;${extra}">${inhalt}</div>`;
const chip = (t: string, bg = HELL, col = INK) => `<span style="align-self:flex-start;display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:9999px;background:${bg};color:${col};font-size:13px;font-weight:600;white-space:nowrap">${t}</span>`;
const GRUEN = (t: string) => chip(t, "#DCFCE7", "#166534");
const ROT = (t: string) => chip(t, "#FEE2E2", "#991B1B");
const haken = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>`;
const box = (t: string, an: boolean, tag = "") =>
  `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #F5F4F2;font-size:15px;line-height:20px">${
    an
      ? `<span style="flex:none;width:20px;height:20px;border-radius:4px;background:${INK};display:inline-flex;align-items:center;justify-content:center">${haken}</span>`
      : `<span style="flex:none;box-sizing:border-box;width:20px;height:20px;border-radius:4px;border:1.5px solid ${G2}"></span>`
  }<span style="flex:1">${t}</span>${tag ? `<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:9999px;background:#EBE9E4;font-size:12px;font-weight:500">${tag}</span>` : ""}</div>`;
const knopf = (t: string, gelb = false) => `<span style="margin-top:auto;display:inline-flex;align-items:center;justify-content:center;height:52px;border-radius:14px;background:${gelb ? A : INK};color:${gelb ? INK : "#fff"};font-size:16px;font-weight:500">${t}</span>`;
const kopf = (klein: string, gross: string) => `<div style="padding:0 4px"><div style="font-size:14px;line-height:20px;color:${G2}">${klein}</div><div style="font-size:26px;line-height:32px;font-weight:600;letter-spacing:-.01em">${gross}</div></div>`;
const foto = (farbe: string, breite = "flex:1") => `<div style="${breite};height:64px;border-radius:10px;background:${farbe}"></div>`;
const zeile = (links: string, rechts: string, fett = false) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #F5F4F2;font-size:15px"><span>${links}</span><span style="${fett ? "font-weight:600;" : ""}">${rechts}</span></div>`;
const titel = (t: string) => `<div style="font-size:15px;font-weight:600;padding-bottom:2px">${t}</div>`;
const gross = (t: string, sub: string) => `<div style="font-size:22px;line-height:28px;font-weight:600">${t}</div><div style="font-size:15px;color:${GRAU}">${sub}</div>`;
const meldung = (t: string, sub: string) =>
  karte(`<div style="display:flex;align-items:center;gap:10px"><span style="flex:none;width:34px;height:34px;border-radius:10px;background:${A};display:inline-flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></span><div><div style="font-size:16px;font-weight:600">${t}</div><div style="font-size:14px;color:${GRAU}">${sub}</div></div></div>`);

const QUELLE = { canvas: "Marketing/heyaudit-instagram/motive (format-katalog.ts)", artboard: "" };
const m = (x: Omit<FormatMotiv, "format" | "quelle" | "text" | "schlagzeile"> & { saeule: Saeule }): FormatMotiv => ({
  ...x,
  format: "feed_1x1",
  quelle: { ...QUELLE, artboard: `${x.id}.png` },
  schlagzeile: `${x.bild.vor}${x.bild.mark}${x.bild.nach}`.replace(/­/g, ""),
  text: formatText(x.text_),
});

export const FORMAT_KATALOG: FormatMotiv[] = [
  // ---------- Montag: Planung ----------
  m({
    id: "f_einsatz", titel: "Wer reinigt wo", thema: "planung", saeule: "funktion",
    bild: { vor: "Wer reinigt heute ", mark: "welches Objekt", nach: "?", unterzeile: "Einsätze gehen direkt aufs Handy deiner Leute, mit Adresse, Hinweisen und Aufgaben.",
      screen: kopf("Montag", "Heute") + karte(titel("12 Einsätze · 9 Personen") + zeile("06:00 Büro Köln-Mitte", "Amina K.") + zeile("06:00 Praxis Dr. Weber", "Elif H.") + zeile("14:00 Lager Leverkusen", "Tom S.") + zeile("17:00 Autohaus Brandt", "Marie K.", true), "gap:0") + meldung("Einsatz ans Handy geschickt", "Marie K. · Autohaus Brandt · 17:00") + knopf("Einsatz planen") },
    text_: { hook: "Wer reinigt heute welches Objekt? 📍", einleitung: "Mit HeyAudit siehst du auf einen Blick, wer wo eingeteilt ist:", punkte: ["Schicht- und Einsatzplanung", "Einsätze direkt aufs Handy deiner Leute", "Adresse und Navigation zum Objekt", "Hinweise vor Ort, z. B. Schlüssel und Alarmanlage", "Aufgaben und Checklisten je Objekt", "Digitale Zeiterfassung"], absatz: "Dein Team weiß morgens, wo es hingeht und was vor Ort zu tun ist. Im Büro behältst du den Überblick über alle Objekte.", tags: ["#schichtplanung", "#einsatzplanung", "#zeiterfassung"] },
  }),
  m({
    id: "f_wochenplan", titel: "Wochenplan statt Excel", thema: "planung", saeule: "schmerz",
    bild: { vor: "Schichtplan ", mark: "ohne Excel", nach: ".", unterzeile: "Schichten per Klick planen. Dein Team sieht seinen Plan sofort am Handy.",
      screen: kopf("KW 47", "Schichtplan") + karte(titel("Montag") + zeile("06–09 Praxis Dr. Weber", "Lena B.") + zeile("06–10 Büro Köln-Mitte", "Anna W.") + zeile("17–21 Autohaus Brandt", "Marie K."), "gap:0") + karte(titel("Dienstag") + zeile("06–09 Praxis Dr. Weber", "Murat K.") + zeile("14–18 Kita Sonnenhof", "Jonas M.") + `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:15px"><span>17–21 Bürohaus Hauptstr.</span>${chip("offen", "#FFEDD5", "#9A3412")}</div>`, "gap:0") + knopf("Plan veröffentlichen") },
    text_: { hook: "Schichtplan in Excel, Änderungen per WhatsApp? 📅", einleitung: "Mit HeyAudit planst du Schichten und Objekte an einem Ort:", punkte: ["Schicht- und Einsatzplanung per Klick", "Offene Schichten sofort sichtbar", "Plan direkt am Handy deines Teams", "Objekt- und Mitarbeiterverwaltung", "Abwesenheiten im Plan berücksichtigt", "Digitale Zeiterfassung"], absatz: "Keine Excel-Versionen mehr, die per WhatsApp herumgeschickt werden. Jeder sieht seinen aktuellen Plan.", tags: ["#schichtplanung", "#einsatzplanung", "#digitalisierung"] },
  }),
  // ---------- Dienstag: Zeit ----------
  m({
    id: "f_zeit", titel: "Arbeitszeit ohne Stundenzettel", thema: "zeit", saeule: "funktion",
    bild: { vor: "Arbeitszeit ohne ", mark: "Stundenzettel", nach: ".", unterzeile: "Dein Team stempelt am Objekt auf dem Handy. Du siehst die Zeiten sofort im Büro.",
      screen: kopf("Dienstag", "Zeiterfassung") + karte(`<div style="font-size:15px;color:${GRAU}">Eingestempelt seit 06:00</div><div style="font-size:54px;line-height:1;font-weight:700;letter-spacing:-.02em">02:14:37</div><div style="font-size:16px;font-weight:600">Büro Köln-Mitte</div>`, "gap:10px") + karte(titel("Diese Woche") + zeile("Mo", "7:45 Std.", true) + zeile("Di", "8:00 Std.", true) + zeile("Mi", "7:30 Std.", true), "gap:0") + `<div style="display:flex;gap:10px;margin-top:auto"><span style="flex:1;display:inline-flex;align-items:center;justify-content:center;height:52px;border-radius:14px;background:#fff;font-size:16px;font-weight:500">Pause</span><span style="flex:1;display:inline-flex;align-items:center;justify-content:center;height:52px;border-radius:14px;background:${INK};color:#fff;font-size:16px;font-weight:500">Ausstempeln</span></div>` },
    text_: { hook: "Stundenzettel aus jedem Objekt einsammeln? ⏱️", einleitung: "Mit HeyAudit erfasst dein Team die Arbeitszeit direkt am Handy:", punkte: ["Ein- und Ausstempeln am Objekt", "Pausen direkt in der App", "Zeiten sofort im Büro sichtbar", "Wochenübersicht je Mitarbeiter", "Abrechnungsvorbereitung und Auswertungen", "Mitarbeiter-App in 15 Sprachen"], absatz: "Kein Abtippen am Monatsende, keine unleserlichen Zettel.", tags: ["#zeiterfassung", "#stundenzettel", "#schichtplanung"] },
  }),
  m({
    id: "f_monatsende", titel: "Monatsende ohne Abtippen", thema: "zeit", saeule: "schmerz",
    bild: { vor: "Monatsende ohne ", mark: "Abtippen", nach: ".", unterzeile: "Alle Stunden je Mitarbeiter und Objekt, fertig für die Abrechnung.",
      screen: kopf("November", "Stunden") + karte(titel("Je Mitarbeiter") + zeile("Anna W.", "152,5 Std.", true) + zeile("Lena B.", "98,0 Std.", true) + zeile("Marie K.", "121,5 Std.", true) + zeile("Tom S.", "64,0 Std.", true), "gap:0") + karte(titel("Je Objekt") + zeile("Autohaus Brandt", "86,0 Std.", true) + zeile("Praxis Dr. Weber", "62,5 Std.", true), "gap:0") + knopf("Für Abrechnung exportieren") },
    text_: { hook: "Am Monatsende Stunden abtippen? 🧮", einleitung: "Mit HeyAudit liegen alle Zeiten schon sauber vor:", punkte: ["Digitale Zeiterfassung per App", "Stunden je Mitarbeiter und Objekt", "Abrechnungsvorbereitung und Auswertungen", "Abwesenheiten automatisch berücksichtigt", "Arbeitsscheine und Leistungsnachweise", "Angebote, Rechnungen und E-Rechnungen"], absatz: "Statt Zettel zu sortieren, prüfst du nur noch und gibst frei.", tags: ["#zeiterfassung", "#lohnabrechnung", "#digitalisierung"] },
  }),
  m({
    id: "f_datev", titel: "Stunden an DATEV", thema: "zeit", saeule: "funktion",
    bild: { vor: "Stunden ", mark: "direkt an DATEV", nach: ".", unterzeile: "Monatsstunden je Mitarbeiter als Export für DATEV Lohn und Gehalt oder Lexware.",
      screen: kopf("November", "Lohnexport") + karte(titel("Format") + zeile("DATEV Lohn und Gehalt", GRUEN("Gewählt")) + zeile("Lexware", "") + zeile("CSV oder Excel", ""), "gap:0") + karte(titel("Geprüft") + zeile("Mitarbeiter mit Personalnummer", "24 von 24", true) + zeile("Stunden gesamt", "2.416,5 Std.", true) + zeile("Abwesenheiten", "berücksichtigt", true), "gap:0") + meldung("Export bereit", "Für dein Steuerbüro") + knopf("Export herunterladen", true) },
    text_: { hook: "Stunden für die Lohnabrechnung abtippen? ⌨️", einleitung: "Mit HeyAudit gehen die Monatsstunden fertig an dein Lohnprogramm:", punkte: ["Export für DATEV Lohn und Gehalt", "Export für Lexware, CSV oder Excel", "Stunden je Mitarbeiter, brutto vorbereitet", "Urlaub und Krankheit schon berücksichtigt", "Digitale Zeiterfassung per App", "Mitarbeiter-App in 15 Sprachen"], absatz: "Lohnsteuer und Nettoauszahlung bleiben bei deinem Steuerbüro. Es bekommt nur endlich saubere Zahlen.", tags: ["#datev", "#lohnabrechnung", "#zeiterfassung"] },
  }),
  // ---------- Mittwoch: Abwesenheit ----------
  m({
    id: "f_krank", titel: "Krankmeldung um 5:30", thema: "abwesenheit", saeule: "schmerz",
    bild: { vor: "Krankmeldung um 5:30? ", mark: "Vertretung", nach: " steht trotzdem.", unterzeile: "Dein Team meldet sich in der App krank. Die offene Schicht siehst du sofort im Plan.",
      screen: kopf("Mittwoch", "Abwesenheit melden") + `<div style="display:flex;gap:6px;background:#fff;border-radius:14px;padding:6px">${["Urlaub", "Krank", "Sonstiges"].map((t) => `<span style="flex:1;text-align:center;padding:9px 0;border-radius:10px;font-size:14px;font-weight:600;${t === "Krank" ? `background:${HELL}` : ""}">${t}</span>`).join("")}</div>` + karte(titel("Betroffene Schicht") + gross("Praxis Dr. Weber", "Mi 06:00 bis 09:00")) + meldung("Vertretung eingeplant", "Lena B. übernimmt 06:00") + karte(titel("Schichtplan Mi") + zeile("06:00 Praxis Dr. Weber", "Lena B.") + zeile("14:00 Lager Leverkusen", "Tom S."), "gap:0") + knopf("Krankmeldung senden", true) },
    text_: { hook: "Krankmeldung um 5:30 Uhr, Schichtbeginn um 6? 🤒", einleitung: "Mit HeyAudit hast du Ausfälle sofort im Blick und planst direkt um:", punkte: ["Krankmeldung per App, direkt im Schichtplan", "Offene Schichten sofort sichtbar", "Vertretung einplanen und aufs Handy schicken", "Abwesenheiten und Urlaubsanträge an einem Ort", "Digitale Zeiterfassung", "Mitarbeiter-App in 15 Sprachen"], absatz: "Keine Telefonkette am frühen Morgen, keine Suche in WhatsApp-Gruppen. Das Objekt wird trotzdem gereinigt.", tags: ["#schichtplanung", "#krankmeldung", "#zeiterfassung"] },
  }),
  m({
    id: "f_urlaub", titel: "Urlaubsantrag per App", thema: "abwesenheit", saeule: "funktion",
    bild: { vor: "Urlaubsanträge ", mark: "ohne Zettel", nach: ".", unterzeile: "Antrag am Handy, Freigabe im Büro. Der Plan weiß sofort Bescheid.",
      screen: kopf("Anträge", "Urlaub") + karte(chip("Neu") + gross("Elif H.", "22.12. bis 02.01. · 7 Tage") + `<div style="display:flex;gap:10px;padding-top:4px"><span style="flex:1;display:inline-flex;align-items:center;justify-content:center;height:44px;border-radius:12px;background:#F5F4F2;font-size:15px;font-weight:500">Ablehnen</span><span style="flex:1;display:inline-flex;align-items:center;justify-content:center;height:44px;border-radius:12px;background:${A};font-size:15px;font-weight:600">Genehmigen</span></div>`) + karte(titel("Diesen Monat") + `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #F5F4F2;font-size:15px"><span>Jonas M. · 3 Tage</span>${GRUEN("Genehmigt")}</div><div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:15px"><span>Anna W. · 5 Tage</span>${GRUEN("Genehmigt")}</div>`, "gap:0") + meldung("Plan aktualisiert", "2 Schichten brauchen Vertretung") },
    text_: { hook: "Urlaubsanträge per WhatsApp und Zettel? 🏖️", einleitung: "Mit HeyAudit laufen Abwesenheiten an einem Ort zusammen:", punkte: ["Urlaubsanträge direkt in der App", "Genehmigen mit einem Klick", "Abwesenheiten sofort im Schichtplan", "Offene Schichten auf einen Blick", "Krankmeldungen im selben Ablauf", "Mitarbeiter-App in 15 Sprachen"], absatz: "Du weißt früh, wo eine Vertretung fehlt, und musst nicht mehr nachfragen, wer wann weg ist.", tags: ["#schichtplanung", "#urlaubsplanung", "#personalplanung"] },
  }),
  // ---------- Donnerstag: Qualitaet ----------
  m({
    id: "f_qualitaet", titel: "Qualitätskontrolle mit Fotos", thema: "qualitaet", saeule: "funktion",
    bild: { vor: "", mark: "Qualitäts­kontrolle", nach: " mit Fotos statt Zettel.", unterzeile: "Objekt prüfen, Mängel mit Foto festhalten und direkt als Aufgabe ans Team geben.",
      screen: kopf("Donnerstag", "Kontrolle") + karte(gross("Bürohaus Hauptstr.", "Objektleitung: Tom S.")) + karte(titel("Bereiche") + `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #F5F4F2;font-size:15px"><span>Eingang</span>${GRUEN("In Ordnung")}</div><div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #F5F4F2;font-size:15px"><span>Küche 2. OG</span>${ROT("Mangel")}</div><div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;font-size:15px"><span>Sanitär</span>${GRUEN("In Ordnung")}</div>`, "gap:0") + karte(`<div style="display:flex;gap:10px;align-items:center">${foto("#D6D3CD", "width:64px")}<div><div style="font-size:15px;font-weight:600">Spüle nicht gereinigt</div><div style="font-size:14px;color:${GRAU}">Aufgabe an Elif H.</div></div></div>`) + knopf("Kontrolle abschließen") },
    text_: { hook: "Qualitätskontrolle auf dem Klemmbrett? 📋", einleitung: "Mit HeyAudit prüfst du Objekte direkt am Handy:", punkte: ["Bereiche prüfen und bewerten", "Mängel mit Foto festhalten", "Mangel direkt als Aufgabe ans Team", "Checklisten je Objekt", "Verlauf aller Kontrollen an einem Ort", "Leistungsnachweise für deine Kunden"], absatz: "Was auffällt, wird erledigt, und du siehst, wann.", tags: ["#qualitätskontrolle", "#mängelmanagement", "#zeiterfassung"] },
  }),
  m({
    id: "f_checkliste", titel: "Checkliste je Objekt", thema: "qualitaet", saeule: "funktion",
    bild: { vor: "Jedes Objekt, ", mark: "eigene Checkliste", nach: ".", unterzeile: "Dein Team sieht vor Ort, was zu tun ist, und hakt es direkt am Handy ab.",
      screen: kopf("Praxis Dr. Weber", "Checkliste") + karte(titel("Wartebereich") + box("Böden feucht wischen", true) + box("Stühle abwischen", true) + box("Papierkörbe leeren", false), "gap:2px") + karte(titel("Sanitär") + box("Waschbecken und Armaturen", true) + box("Spender auffüllen", false, "Foto") + box("Boden desinfizieren", false), "gap:2px") + knopf("Einsatz abschließen") },
    text_: { hook: "Neue Kraft im Objekt und keiner weiß, was zu tun ist? ✅", einleitung: "Mit HeyAudit hat jedes Objekt seine eigene Checkliste:", punkte: ["Aufgaben und Checklisten je Objekt", "Abhaken direkt am Handy", "Fotos, wo es darauf ankommt", "Hinweise vor Ort zum Objekt", "Erledigte Leistungen im Büro sichtbar", "Mitarbeiter-App in 15 Sprachen"], absatz: "Auch Vertretungen und neue Leute wissen sofort, was im Objekt zu tun ist.", tags: ["#qualitätskontrolle", "#checkliste", "#einarbeitung"] },
  }),
  // ---------- Freitag: Nachweis ----------
  m({
    id: "f_nachweis", titel: "Leistungsnachweis", thema: "nachweis", saeule: "vertrauen",
    bild: { vor: "Kunde fragt nach? Der ", mark: "Nachweis", nach: " ist schon da.", unterzeile: "Wer war da, wie lange, was wurde erledigt. Mit Checkliste und Fotos je Einsatz.",
      screen: kopf("Dienstag", "Einsatz erledigt") + karte(GRUEN("Erledigt 17:02 bis 20:48") + gross("Autohaus Brandt", "Marie K. · 3 Std. 46 Min.")) + karte(titel("Checkliste") + box("Sanitär EG", true) + box("Ausstellung feucht wischen", true) + box("Müll entsorgt", true), "gap:2px") + karte(titel("Fotos (3)") + `<div style="display:flex;gap:8px">${foto("#D6D3CD")}${foto("#C9C5BE")}${foto("#E2DFD9")}</div>`) + knopf("Leistungsnachweis öffnen") },
    text_: { hook: "Kunde fragt, ob wirklich gereinigt wurde? 🧾", einleitung: "Mit HeyAudit hast du für jeden Einsatz den Nachweis an einem Ort:", punkte: ["Wer war da und wie lange", "Abgehakte Checklisten je Objekt", "Fotos direkt vom Einsatz", "Mängel und Qualitätskontrollen", "Arbeitsscheine und Leistungsnachweise", "Digitale Zeiterfassung"], absatz: "Statt Diskussion mit dem Kunden zeigst du einfach, was erledigt wurde.", tags: ["#leistungsnachweis", "#qualitätskontrolle", "#zeiterfassung"] },
  }),
  m({
    id: "f_rechnung", titel: "Vom Einsatz zur Rechnung", thema: "nachweis", saeule: "funktion",
    bild: { vor: "Vom Einsatz zur ", mark: "Rechnung", nach: ".", unterzeile: "Angebote, Rechnungen und E-Rechnungen aus den erfassten Leistungen.",
      screen: kopf("Rechnungen", "Neue Rechnung") + karte(gross("Autohaus Brandt", "Unterhaltsreinigung November")) + karte(titel("Positionen") + zeile("Unterhaltsreinigung", "20 Einsätze") + zeile("Glasreinigung", "1 Einsatz") + zeile("Sonderreinigung Halle", "1 Einsatz"), "gap:0") + karte(`<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:15px;font-weight:600">Format</span>${chip("E-Rechnung")}</div>`) + knopf("Rechnung erstellen", true) },
    text_: { hook: "Rechnungen aus Stundenzetteln zusammensuchen? 💶", einleitung: "Mit HeyAudit kommt die Rechnung aus den erledigten Leistungen:", punkte: ["Angebote, Rechnungen und E-Rechnungen", "Leistungen direkt aus den Einsätzen", "Arbeitsscheine und Leistungsnachweise", "Objekt- und Kundenverwaltung", "Abrechnungsvorbereitung und Auswertungen", "Digitale Zeiterfassung"], absatz: "Was dein Team erledigt hat, landet nicht mehr auf Zetteln, sondern direkt in der Abrechnung.", tags: ["#erechnung", "#rechnungsstellung", "#digitalisierung"] },
  }),
  m({
    id: "f_steuerbuero", titel: "Saubere Zahlen fürs Steuerbüro", thema: "nachweis", saeule: "vertrauen",
    bild: { vor: "Dein Steuerbüro bekommt ", mark: "saubere Zahlen", nach: ".", unterzeile: "Keine Rückfragen zu Stunden mehr: Export für DATEV oder Lexware, je Mitarbeiter geprüft.",
      screen: kopf("Monatsabschluss", "November") + karte(titel("Vor dem Export") + box("Alle Zeiten freigegeben", true) + box("Personalnummern vollständig", true) + box("Abwesenheiten eingetragen", true), "gap:2px") + karte(titel("Lohnexport") + zeile("Format", "DATEV Lohn und Gehalt", true) + zeile("Mitarbeiter", "24", true), "gap:0") + meldung("Bereit für das Steuerbüro", "Brutto vorbereitet") + knopf("Monat abschließen") },
    text_: { hook: "Rückfragen vom Steuerbüro zu den Stunden? 📑", einleitung: "Mit HeyAudit gibst du einen geprüften Monat weiter:", punkte: ["Zeiten freigeben, bevor exportiert wird", "Personalnummern und Abwesenheiten geprüft", "Export für DATEV Lohn und Gehalt oder Lexware", "Stunden je Mitarbeiter und Objekt", "Arbeitsscheine und Leistungsnachweise", "Digitale Zeiterfassung"], absatz: "HeyAudit rechnet brutto vor. Lohnsteuer und Netto macht weiter dein Steuerbüro, nur ohne Zettel.", tags: ["#datev", "#steuerberater", "#lohnabrechnung"] },
  }),
  // ---------- Samstag: Team ----------
  m({
    id: "f_sprachen", titel: "Mitarbeiter-App in 15 Sprachen", thema: "team", saeule: "funktion",
    bild: { vor: "Dein Team spricht viele Sprachen? ", mark: "Die App auch", nach: ".", unterzeile: "Die Mitarbeiter-App gibt es in 15 Sprachen. Jeder sieht seinen Einsatz in seiner Sprache.",
      screen: kopf("Einstellungen", "Sprache") + karte(["Deutsch", "Türkçe", "Polski", "Română", "Українська", "العربية"].map((s, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;${i < 5 ? "border-bottom:1px solid #F5F4F2;" : ""}font-size:16px"><span>${s}</span>${s === "Türkçe" ? `<span style="width:22px;height:22px;border-radius:50%;background:${INK};display:inline-flex;align-items:center;justify-content:center">${haken}</span>` : ""}</div>`).join(""), "gap:0") + karte(`<div style="font-size:14px;color:${G2}">Bugün 17:00 – 21:00</div><div style="font-size:20px;font-weight:600">Autohaus Brandt</div>`) + knopf("Kaydet") },
    text_: { hook: "Dein Team spricht Türkisch, Polnisch oder Rumänisch? 🌍", einleitung: "Mit HeyAudit sieht jeder seinen Einsatz in seiner Sprache:", punkte: ["Mitarbeiter-App in 15 Sprachen", "Einsätze, Aufgaben und Hinweise verständlich", "Digitale Zeiterfassung", "Checklisten je Objekt", "Krankmeldung und Urlaub per App", "Läuft im Browser, ohne Installation"], absatz: "Weniger Missverständnisse, weniger Rückfragen und weniger Fehler im Objekt.", tags: ["#mitarbeiterapp", "#mehrsprachig", "#zeiterfassung"] },
  }),
  m({
    id: "f_browser", titel: "Ohne Installation", thema: "team", saeule: "umstieg",
    bild: { vor: "Keine App installieren. ", mark: "Link öffnen", nach: ", loslegen.", unterzeile: "Dein Team startet im Browser auf dem Handy. Kein App Store, kein Passwort-Chaos.",
      screen: kopf("Einladung", "Willkommen, Marie") + karte(`<div style="font-size:15px;color:${GRAU}">Du wurdest von deiner Objektleitung eingeladen.</div><div style="font-size:20px;font-weight:600">Reinigung Schmidt GmbH</div>`) + karte(titel("So geht's") + box("Link auf dem Handy öffnen", true) + box("Sprache wählen", true) + box("Ersten Einsatz ansehen", false), "gap:2px") + meldung("Kein Download nötig", "Läuft direkt im Browser") + knopf("Jetzt starten", true) },
    text_: { hook: "Dein Team soll eine App installieren? Muss es nicht. 📱", einleitung: "HeyAudit läuft im Browser auf dem Handy:", punkte: ["Einladungslink öffnen und starten", "Kein App Store, kein Download", "Mitarbeiter-App in 15 Sprachen", "Einsätze, Aufgaben und Hinweise vor Ort", "Digitale Zeiterfassung", "Krankmeldung und Urlaub per App"], absatz: "Auch ältere Handys und wechselnde Aushilfen sind in Minuten startklar.", tags: ["#mitarbeiterapp", "#digitalisierung", "#zeiterfassung"] },
  }),
  // ---------- Sonntag: Umstieg (Abgrenzung: selbst testen statt Demo-Termin, Preis sichtbar) ----------
  m({
    id: "f_selbsttest", titel: "Selbst testen statt Demo-Termin", thema: "umstieg", saeule: "umstieg",
    bild: { vor: "Selbst testen statt ", mark: "Demo-Termin", nach: ".", unterzeile: "Konto anlegen, erstes Objekt eintragen, Team einladen. Heute noch, ohne Verkaufsgespräch.",
      screen: kopf("Los geht's", "In 3 Schritten") + karte(box("Konto anlegen", true) + box("Erstes Objekt eintragen", true) + box("Team per Link einladen", false), "gap:2px") + karte(titel("Dein Tarif") + zeile("Testphase", "14 Tage kostenlos", true) + zeile("Danach", "ab 39 € / Monat", true), "gap:0") + meldung("Kein Termin nötig", "Du entscheidest selbst") + knopf("Kostenlos starten", true) },
    text_: { hook: "Software für deine Reinigungsfirma, aber erst ein Demo-Termin? 🙅", einleitung: "Bei HeyAudit legst du einfach selbst los:", punkte: ["Konto in wenigen Minuten anlegen", "Erstes Objekt und Team eintragen", "14 Tage kostenlos testen", "Preise offen: ab 39 € pro Monat", "Schicht- und Einsatzplanung", "Digitale Zeiterfassung"], absatz: "Du siehst sofort, ob HeyAudit zu deinem Betrieb passt, ohne Verkaufsgespräch.", tags: ["#digitalisierung", "#schichtplanung", "#zeiterfassung"] },
  }),
  m({
    id: "f_whatsapp", titel: "Raus aus der WhatsApp-Gruppe", thema: "umstieg", saeule: "schmerz",
    bild: { vor: "Raus aus der ", mark: "WhatsApp-Gruppe", nach: ".", unterzeile: "Pläne, Änderungen und Hinweise an einem Ort statt in 200 ungelesenen Nachrichten.",
      screen: kopf("Heute", "Mein Arbeitstag") + karte(chip("Heute 17:00 bis 21:00") + gross("Autohaus Brandt", "Industriestraße 14, 50735 Köln")) + karte(titel("Änderung vom Büro") + `<div style="font-size:15px;line-height:22px;color:${GRAU}">Heute zusätzlich Glasreinigung Eingang. Leiter steht im Lager.</div>`) + karte(titel("Aufgaben") + box("Checkliste Sanitär EG", false, "Checkliste") + box("Glasreinigung Eingang", false, "Neu"), "gap:2px") + knopf("Schicht starten") },
    text_: { hook: "200 ungelesene Nachrichten in der Team-Gruppe? 💬", einleitung: "Mit HeyAudit landet alles da, wo es hingehört:", punkte: ["Einsätze und Änderungen direkt am Handy", "Hinweise vor Ort je Objekt", "Aufgaben und Checklisten", "Schicht- und Einsatzplanung", "Digitale Zeiterfassung", "Krankmeldung und Urlaub per App"], absatz: "Keine wichtigen Infos mehr zwischen Sprachnachrichten und Sticker-Bildern.", tags: ["#teamkommunikation", "#schichtplanung", "#digitalisierung"] },
  }),
];

/** Bild als HTML (1080×1080), Layout 1:1 wie Post.dc.html vom 04.11. */
export function formatHtml(mo: FormatMotiv): string {
  const LOGO = `<svg width="52" height="52" viewBox="14 19 119 118"><g fill="${INK}"><path d="M24 25 L16 36 L14 49 L18 62 L27 71 L41 76 L71 76 L71 40 L65 29 L53 20 L36 19 Z"/><path d="M133 19 L97 19 L86 25 L78 36 L76 44 L76 75 L107 76 L121 71 L132 57 Z"/><path d="M71 80 L40 80 L28 84 L18 94 L15 106 L14 137 L49 137 L59 133 L70 119 Z"/><path d="M77 80 L76 112 L81 125 L90 133 L98 137 L111 137 L121 132 L130 122 L133 102 L129 93 L118 83 L108 80 Z"/></g></svg>`;
  const mark = `<span style="position:relative;white-space:nowrap"><span style="position:absolute;left:-6px;right:-6px;bottom:6px;height:.36em;border-radius:4px;background:${A}"></span><span style="position:relative">${mo.bild.mark}</span></span>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap">
<style>html,body{margin:0;width:1080px;height:1080px;overflow:hidden}</style></head><body>
<div style="width:1080px;height:1080px;position:relative;overflow:hidden;background:#F5F4F2;font-family:Figtree,sans-serif;color:${INK}">
<div style="position:absolute;top:-171px;right:-148px;width:600px;height:600px;border-radius:50%;border:100px solid ${A};box-sizing:border-box"><div style="position:absolute;top:192px;left:142px;width:230px;height:230px;border-radius:50%;border:32px solid ${HELL};box-sizing:border-box"></div></div>
<div style="position:absolute;left:62px;top:290px;display:flex;align-items:center;gap:16px">${LOGO}<span style="font-size:46px;line-height:1;font-weight:600;letter-spacing:-.01em">HeyAudit</span></div>
<div style="position:absolute;left:62px;top:404px;width:560px;display:flex;flex-direction:column;gap:28px">
<h1 style="margin:0;font-size:62px;line-height:1.06;font-weight:600;letter-spacing:-.025em">${mo.bild.vor}${mark}${mo.bild.nach}</h1>
<p style="margin:0;font-size:26px;line-height:1.42;color:${GRAU}">${mo.bild.unterzeile}</p>
<span style="align-self:flex-start;display:inline-flex;align-items:center;gap:12px;height:72px;padding:0 34px;border-radius:14px;background:${A};font-size:26px;font-weight:600">14 Tage kostenlos testen <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span>
</div>
<div style="position:absolute;left:79px;top:892px"><div style="font-size:40px;line-height:1.1;font-weight:600;letter-spacing:-.015em">Ab 39 € / Monat</div><div style="font-size:21px;line-height:1.4;color:${GRAU};margin-top:6px">Mitarbeiter-App in 15 Sprachen.</div></div>
<div style="position:absolute;left:640px;top:250px;width:400px;height:800px;box-sizing:border-box;padding:12px;border-radius:56px;background:${INK};box-shadow:0 40px 80px rgba(15,17,21,.22)">
<div style="width:376px;height:776px;box-sizing:border-box;border-radius:44px;overflow:hidden;background:#F5F4F2;padding:44px 18px 18px;display:flex;flex-direction:column;gap:12px">${mo.bild.screen}</div></div>
</div></body></html>`;
}
