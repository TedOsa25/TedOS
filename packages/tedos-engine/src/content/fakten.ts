// Belegte HeyAudit-Produktaussagen. Inhalte dürfen Produkt, Preis, Tarif und
// Grenzen NUR über diese IDs nennen. Alles andere ist ein Platzhalter [[…]].
//
// Quelle: HeyAudit-App, Live-Linie feat/monat-schichtdauer.
//   app/llms.txt/route.ts  — "nur, was im Produkt belegt ist" (eigene Regel der Datei)
//   lib/billing/plans.ts   — Single Source of Truth für Preise/Limits
// Geprüft am 2026-11-22 gegen Commit 3933b4ea (Dateistand b321a4ff, 2026-11-19).
// Ändert sich dort etwas, muss dieser Katalog nachgezogen werden (Test prüft das Datum).

export const FAKTEN_STAND = "2026-11-22";
export const FAKTEN_QUELLE = "~/dev/heyaudit @3933b4ea: app/llms.txt/route.ts, lib/billing/plans.ts";

export interface Fakt { id: string; aussage: string; quelle: string; grenze?: string }

const LLMS = "app/llms.txt/route.ts";
const PLANS = "lib/billing/plans.ts";

export const FAKTEN: readonly Fakt[] = [
  { id: "F-BROWSER", aussage: "Zugang im Browser am Handy und am Rechner, ohne Installation.", quelle: LLMS },
  { id: "F-SPRACHEN", aussage: "Die Mitarbeiter-App gibt es in mehreren Sprachen.", quelle: "lib/marketing/sprachen.ts (SPRACHEN_SATZ)", grenze: "Genaue Zahl nur aus SPRACHEN_SATZ übernehmen; übersetzt wird die Oberfläche, nicht eure eigenen Aufgabentexte." },
  { id: "F-FREE", aussage: "Free: dauerhaft kostenlos für bis zu 3 Mitarbeiter und 5 Objekte, mit Zeiterfassung, Schichtplanung und Objektverwaltung. Ohne Kreditkarte.", quelle: `${PLANS} (FREE_CLAIM, FREE_PERSON_LIMIT, FREE_OBJECT_LIMIT)`, grenze: "Gezählt werden alle Rollen zusammen. Nicht in Free: siehe FREE_NICHT_ENTHALTEN." },
  { id: "F-TEST", aussage: "Bezahlte Tarife 14 Tage kostenlos testen, bis Testende kostenlos kündbar.", quelle: `${PLANS} (TRIAL_DAYS)` },
  { id: "F-PREISE", aussage: "Starter 49 € im Monat (39 € bei Jahreszahlung), Business 79 € (69 €), Pro 179 € (149 €), jeweils netto; Enterprise individuell.", quelle: PLANS },
  { id: "F-STARTER-GRENZE", aussage: "Dem Starter fehlen Abrechnung, Steuerberater-Zugang, Auswertungen und Audit-Berichte.", quelle: PLANS },
  { id: "F-KI-PRO", aussage: "KI-Funktionen (Assistent Helio, Diktat, KI im Audit) gibt es nur im Pro-Tarif, mit festem Monatskontingent; Starter und Business enthalten keine KI.", quelle: LLMS },
  { id: "F-HELIO", aussage: "Helio beantwortet Bedienfragen, erklärt den Objektstatus und fehlende Nachweise. Mangel melden und Maßnahmen anlegen nur als Vorschlag, gespeichert erst nach Klick der Person.", quelle: LLMS, grenze: "Keine Rechtsberatung. Verarbeitung über OpenAI (USA) — bei Datenschutz-Themen nennen." },
  { id: "F-QR", aussage: "Der Objekt-QR öffnet Zugeordneten nach der Anmeldung die Objektzentrale (Arbeitszeit starten, Aufgaben, Mangel mit Foto).", quelle: LLMS, grenze: "Der Scan bucht keine Zeit und speichert keinen Standort." },
  { id: "F-SOLL-IST", aussage: "Soll und Ist je Objekt: geplant, anwesend, fehlt, Vertretung, bestätigt abwesend.", quelle: LLMS },
  { id: "F-HANDLUNG", aussage: "Handlungsbedarf: offene Fälle aus Schichtplan, Zeiterfassung, Mängeln, Maßnahmen und Abrechnung in einer Liste nach Dringlichkeit, je Fall Ursache, Frist und ein nächster Schritt.", quelle: LLMS, grenze: "Nicht für Mitarbeitende sichtbar." },
  { id: "F-FIXIERUNG", aussage: "Schichten oder Zuordnungen lassen sich mit Grund fixieren; Wochenplan-Lauf und Schichttausch ändern sie dann nicht.", quelle: LLMS },
  { id: "F-STUNDENKONTO", aussage: "Stundenkonto mit Buchungen samt Herkunft; Korrekturen nur mit Grund, nicht löschbar; Mitarbeitende sehen die Aufschlüsselung ihres Stands.", quelle: LLMS },
  { id: "F-NACHWEIS", aussage: "Nachweisbericht als PDF je Objekt für bis zu einem Jahr, Fotos und Unterschriften als nummerierte Anlagen.", quelle: LLMS, grenze: "Keine Zertifizierung, keine Revisionssicherheit nach einem Standard." },
  { id: "F-OBJEKTAKTE", aussage: "Objektakte: Chronik je Objekt mit Schichten, Zeiten, Aufgaben, Kontrollen, Fotos, Mängeln und Arbeitsscheinen; Nachweise und abgeschlossene Kontrollen sind nicht löschbar.", quelle: LLMS },
  { id: "F-AUDIT", aussage: "Checklisten mit Versionen, Fotos und Unterschriften; Abweichungen als Mängel, Maßnahmen mit Zuständigkeit und Frist.", quelle: LLMS, grenze: "Keine ISO-Zertifikate, keine Normkonformität zugesagt." },
  { id: "F-SCHICHT", aussage: "Schichtplanung je Objekt mit Verfügbarkeiten und Ausfällen.", quelle: `${LLMS} (Seite /schichtplanung-gebaeudereinigung)` },
  { id: "F-ZEIT", aussage: "Zeiterfassung am Handy, je Objekt.", quelle: `${LLMS} (Seite /zeiterfassung-reinigungskraefte)` },
  { id: "F-PERSONAL", aussage: "Mitarbeiterverwaltung: Personalakte, Dokumente mit Ablaufdatum, Abwesenheiten.", quelle: `${LLMS} (Seite /mitarbeiterverwaltung-reinigungsfirma)` },
  { id: "F-HAUSMEISTER", aussage: "Für Hausmeisterservice: flexible Einsatztage (gelten nie als verspätet), Aufgaben, Mängel, Arbeitsscheine.", quelle: LLMS },
  { id: "F-ARBEITSSCHEIN", aussage: "Digitale Arbeitsscheine.", quelle: `${LLMS} (Seite /digitale-arbeitsscheine-reinigung)` },
  { id: "F-ERECHNUNG", aussage: "XRechnung und ZUGFeRD aus Arbeitsschein und Auftrag, ab Business.", quelle: LLMS, grenze: "Kein Buchhaltungssystem, kein Versand über Peppol oder Behördenportale." },
  { id: "F-LOHN-GRENZE", aussage: "Die Abrechnung rechnet brutto. Lohnsteuer, Sozialversicherung und Nettolohn bleiben bei DATEV, Lexware oder der Steuerberatung.", quelle: LLMS },
  { id: "F-STANDORT", aussage: "Anwendung und Datenbank laufen in Frankfurt am Main.", quelle: LLMS, grenze: "KI-Verarbeitung (Pro) über OpenAI in den USA." },
  { id: "F-DEMO", aussage: "Ted zeigt HeyAudit in einer Online-Demo; Termin über die Buchungsseite oder das Demo-Formular auf heyaudit.de/demo.", quelle: "src/sales/drafts.ts (DEMO_BOOKING_URL), ~/dev/heyaudit app/demo", grenze: "Dauer „20 Minuten“ ist Teds eigenes Angebot aus den DM-Entwürfen — vor Nennung bestätigen." },
];

const NACH_ID = new Map(FAKTEN.map((f) => [f.id, f]));
export const fakt = (id: string): Fakt | undefined => NACH_ID.get(id);

/** Platzhalter sind [[…]]. Sie müssen vor der Freigabe ersetzt sein. */
export const PLATZHALTER = /\[\[[^\]]+\]\]/g;
export const offenePlatzhalter = (text: string): string[] => [...text.matchAll(PLATZHALTER)].map((m) => m[0]);
