// Content-Katalog des Growth OS: die fertigen HeyAudit-Motive mit Texten.
//
// Quelle der Motive: die Design-Canvases des Gruenders auf claude.ai
//   "HeyAudit Story-Anzeige"      https://claude.ai/artifact/LBt1qJhoQ254girtbYuK9b
//   "HeyAudit Insta-Post Umstieg" https://claude.ai/artifact/Fe3jJnxBSE9c19Zht6JS6n
// Je Motiv: Artboard, Format, Schlagzeile (wie im Design) und ein
// Beitragstext-ENTWURF. Die Texte duzen wie die bestehenden Instagram-Anzeigen
// und behaupten nur, was Design, Anzeigen oder Produkt schon zeigen.
// Neue Motive: hier eintragen, der Wochenplan nimmt sie automatisch auf.

export type Format = "feed_1x1" | "feed_4x5" | "story_9x16";

/** Wofuer ein Beitrag steht. Der Plan mischt die Saeulen. */
export type Saeule = "schmerz" | "funktion" | "umstieg" | "vertrauen";

export interface Motiv {
  id: string;
  titel: string;
  format: Format;
  saeule: Saeule;
  /** Canvas-Link und Artboard-Datei, aus der das Bild exportiert wird. */
  quelle: { canvas: string; artboard: string };
  schlagzeile: string;
  /** Beitragstext ohne Link und Hashtags; die setzt der Plan. */
  text: string;
}

const STORY = "https://claude.ai/artifact/LBt1qJhoQ254girtbYuK9b";
const UMSTIEG = "https://claude.ai/artifact/Fe3jJnxBSE9c19Zht6JS6n";

export const KATALOG: Motiv[] = [
  {
    id: "zettelchaos",
    titel: "Ohne Zettelchaos und WhatsApp",
    format: "feed_1x1",
    saeule: "schmerz",
    quelle: { canvas: STORY, artboard: "Post.dc.html" },
    schlagzeile: "Gebäudereinigung ohne Zettelchaos und WhatsApp.",
    text: "Schichtplan in Excel, Absprachen über WhatsApp, Stundenzettel auf Papier?\n\nMit HeyAudit hast du Schichtplan, Zeiterfassung und Leistungsnachweis in einer App. Dein Team nutzt sie im Browser auf dem Handy, ohne Installation.",
  },
  {
    id: "einsatz",
    titel: "Wer reinigt wo",
    format: "feed_1x1",
    saeule: "funktion",
    quelle: { canvas: STORY, artboard: "PostEinsatz.dc.html" },
    schlagzeile: "Wer reinigt heute welches Objekt?",
    text: "Ein Blick reicht: Wer ist heute wo eingeteilt, wer hat schon gestempelt, welcher Einsatz ist noch offen.\n\nNeue Einsätze gehen direkt aufs Handy deiner Leute, mit Adresse, Hinweisen vor Ort und Aufgaben.",
  },
  {
    id: "krank",
    titel: "Krankmeldung",
    format: "feed_1x1",
    saeule: "schmerz",
    quelle: { canvas: STORY, artboard: "PostKrank.dc.html" },
    schlagzeile: "Krankmeldung kurz vor der Schicht?",
    text: "Um 5:30 Uhr kommt die Krankmeldung, um 6 Uhr beginnt die Schicht.\n\nIn HeyAudit meldet sich dein Team in der App krank. Die Meldung steht sofort im Plan, du siehst die offene Schicht und planst direkt eine Vertretung ein.",
  },
  {
    id: "stunden",
    titel: "Stundenzettel",
    format: "feed_1x1",
    saeule: "schmerz",
    quelle: { canvas: STORY, artboard: "PostStunden.dc.html" },
    schlagzeile: "Stundenzettel am Monatsende abtippen?",
    text: "Am Monatsende Stundenzettel einsammeln, entziffern und abtippen kostet Abende.\n\nMit HeyAudit stempelt dein Team am Handy, je Objekt. Du prüfst die Zeiten und gibst sie frei. Die Abrechnung ist vorbereitet, wenn der Monat endet.",
  },
  {
    id: "nachweis",
    titel: "Leistungsnachweis",
    format: "feed_1x1",
    saeule: "vertrauen",
    quelle: { canvas: STORY, artboard: "PostNachweis.dc.html" },
    schlagzeile: "Kunde fragt, ob wirklich gereinigt wurde?",
    text: "Wenn der Kunde fragt, ob gereinigt wurde, hilft kein Bauchgefühl.\n\nMit HeyAudit hast du für jeden Einsatz den Nachweis: wer da war, wie lange, welche Checkliste abgehakt wurde, mit Fotos.",
  },
  {
    id: "mangel",
    titel: "Mängel & Maßnahmen",
    format: "feed_1x1",
    saeule: "vertrauen",
    quelle: { canvas: STORY, artboard: "PostMangel.dc.html" },
    schlagzeile: "Mangel gemeldet – und dann passiert nichts?",
    text: "Ein Mangel landet im Chat und geht unter.\n\nIn HeyAudit meldet dein Team Mängel mit Foto direkt vom Objekt. Die Objektleitung sieht sie sofort, legt eine Maßnahme fest und hakt sie ab, wenn sie erledigt ist.",
  },
  {
    id: "sprachen",
    titel: "Mehrsprachig",
    format: "feed_1x1",
    saeule: "funktion",
    quelle: { canvas: STORY, artboard: "PostSprachen.dc.html" },
    schlagzeile: "Dein Team spricht nicht nur Deutsch?",
    text: "In vielen Reinigungsteams wird Polnisch, Türkisch, Rumänisch oder Ukrainisch gesprochen.\n\nDie Mitarbeiter-App von HeyAudit gibt es in 15 Sprachen. Jeder sieht Einsätze, Aufgaben und Checklisten in seiner Sprache, du planst weiter auf Deutsch.",
  },
  {
    id: "urlaub",
    titel: "Urlaubsanträge",
    format: "feed_1x1",
    saeule: "schmerz",
    quelle: { canvas: STORY, artboard: "PostUrlaub.dc.html" },
    schlagzeile: "Urlaubsanträge noch auf dem Zettel?",
    text: "Urlaubsanträge per Zettel oder Nachricht gehen verloren und tauchen im Schichtplan nicht auf.\n\nIn HeyAudit beantragt dein Team Urlaub in der App. Du genehmigst ihn dort, und der Urlaub steht direkt im Plan.",
  },
  {
    id: "rechnung",
    titel: "Rechnung aus dem Einsatz",
    format: "feed_1x1",
    saeule: "funktion",
    quelle: { canvas: STORY, artboard: "PostRechnung.dc.html" },
    schlagzeile: "Rechnungen schreiben nach Feierabend?",
    text: "Erledigte Einsätze nach Feierabend in Rechnungen übertragen muss nicht sein.\n\nIn HeyAudit entsteht die Rechnung aus den erfassten Leistungen, auch als E-Rechnung.",
  },
  {
    id: "zeit",
    titel: "Zeiterfassung am Handy",
    format: "feed_1x1",
    saeule: "funktion",
    quelle: { canvas: STORY, artboard: "PostZeit.dc.html" },
    schlagzeile: "Ohne Stundenzettel: Dein Team stempelt am Handy.",
    text: "Kommen, Pause, Gehen: Dein Team stempelt am Handy, je Objekt. Du siehst die Zeiten sofort und gibst sie frei.",
  },
  {
    id: "objekte",
    titel: "Objektverwaltung",
    format: "feed_1x1",
    saeule: "funktion",
    quelle: { canvas: STORY, artboard: "PostObjekte.dc.html" },
    schlagzeile: "Jedes Objekt mit allem, was dazugehört.",
    text: "Adresse, Kunde, Bereiche, Zugang und Verlauf: In HeyAudit liegt alles zu einem Objekt an einer Stelle statt in fünf Ordnern.",
  },
  {
    id: "planung",
    titel: "Schichtplanung",
    format: "feed_1x1",
    saeule: "funktion",
    quelle: { canvas: STORY, artboard: "PostPlanung.dc.html" },
    schlagzeile: "Offene Schichten siehst du sofort.",
    text: "Wochenplan je Objekt, Urlaub und Krankmeldungen stehen schon drin. Offene Schichten fallen sofort auf, nicht erst, wenn der Kunde anruft.",
  },
  {
    id: "qualitaet",
    titel: "Checklisten & Mängel",
    format: "feed_1x1",
    saeule: "vertrauen",
    quelle: { canvas: STORY, artboard: "PostQualitaet.dc.html" },
    schlagzeile: "Mängel mit Foto statt langer Diskussion.",
    text: "Checklisten vor Ort abhaken, Mängel mit Foto melden. Die Objektleitung bekommt sie direkt und kann reagieren, bevor der Kunde sich beschwert.",
  },
  {
    id: "umstieg",
    titel: "Umstieg ohne Abtippen",
    format: "feed_4x5",
    saeule: "umstieg",
    quelle: { canvas: UMSTIEG, artboard: "Main.dc.html" },
    schlagzeile: "Software wechseln. Nichts abtippen.",
    text: "Der Wechsel scheitert oft am Abtippen: Kunden, Objekte, Ansprechpartner, Preise.\n\nBei HeyAudit übernehmen wir den Import für dich. Schick uns deine Listen, egal ob Excel, CSV oder PDF.",
  },
  {
    id: "umstieg_dateien",
    titel: "Umstieg: Dateien zu App",
    format: "feed_4x5",
    saeule: "umstieg",
    quelle: { canvas: UMSTIEG, artboard: "Minimal.dc.html" },
    schlagzeile: "Software wechseln. Nichts abtippen.",
    text: "Preisliste als PDF, Objekte als CSV, Kunden in Excel? Schick uns deine Daten, wir übernehmen den Import. Ab Tag 1 siehst du Stunden je Objekt.",
  },
  {
    id: "story_start",
    titel: "Story: Ohne Zettelchaos",
    format: "story_9x16",
    saeule: "schmerz",
    quelle: { canvas: STORY, artboard: "Main.dc.html" },
    schlagzeile: "Gebäudereinigung ohne Zettelchaos und WhatsApp.",
    text: "Schichtplan, Zeiterfassung und Leistungsnachweis in einer App.",
  },
  {
    id: "story_stundenzettel",
    titel: "Story: Stundenzettel einsammeln",
    format: "story_9x16",
    saeule: "schmerz",
    quelle: { canvas: STORY, artboard: "StoryStundenzettel.dc.html" },
    schlagzeile: "„Stundenzettel aus jedem Objekt einsammeln?“",
    text: "Dein Team erfasst die Zeit am Handy, direkt am Objekt. Du siehst alles sofort.",
  },
];

/** Hashtags aus den bestehenden HeyAudit-Anzeigen. */
export const HASHTAGS = [
  "#gebäudereinigung",
  "#reinigungsfirma",
  "#reinigungsunternehmen",
  "#facilitymanagement",
  "#schichtplanung",
  "#zeiterfassung",
  "#digitalisierung",
  "#heyaudit",
];
