// HeyAudit Ideen- und Skriptgenerator.
//
// Deterministisch: aus einem Ideen-Samen (konkrete Alltagssituation, Hook,
// First Frame, belegte Fakten) entsteht eine vollständige Idee mit
// Skriptgerüst, CTA, Faktencheck, Referenzmustern und Plattformvarianten.
// Der Generator erfindet keine Zahlen, Zitate, Kundenergebnisse oder Features:
// Sprechertexte sind Platzhalter [[…]], Produktaussagen kommen nur aus
// fakten.ts. Ideen, die einen echten Fall oder eine Kundenfreigabe brauchen,
// sind gesperrt, bis diese Voraussetzung belegt ist.

import { pruefeText } from "../growth-os/content-plan.js";
import { fakt, offenePlatzhalter } from "./fakten.js";
import type { Funnel, Plattform } from "./modell.js";
import { PLATTFORMEN } from "./modell.js";

export type Format =
  | "pov_alltag" | "problembeobachtung" | "mythos_realitaet" | "checkliste" | "fehlerliste"
  | "mini_demo" | "frage_antwort" | "ehrliche_grenze" | "vorher_nachher_echt" | "kundengeschichte";

/** Abstrakte Muster, die in Referenzvideos beobachtet werden. Nie ein konkretes fremdes Video. */
export const MUSTER: Record<string, string> = {
  "P-POV": "Ich-/POV-Perspektive in einer Alltagsszene, Uhrzeit oder Ort als Einblendung",
  "P-MYTHOS": "Behauptung einblenden, dann Gegenbild aus der Praxis",
  "P-LISTE": "Nummerierte Liste mit 3–5 Punkten, ein Schnitt je Punkt",
  "P-SCREEN": "Bildschirmaufnahme am Handy, Finger führt durch 3 Schritte",
  "P-FRAGE": "Frage groß einblenden, direkt und kurz beantworten",
  "P-KONTRAST": "Problem-Bild und ruhiges Gegenbild im direkten Schnitt",
  "P-EHRLICH": "Offen sagen, was das Produkt NICHT kann",
  "P-PREIS": "Preise offen und ohne Umweg erklären",
};

export interface Same {
  key: string;
  funnel: Funnel;
  format: Format;
  thema: string;
  unterthema: string;
  zielgruppe: string;
  schmerz: string;
  lernziel: string;
  hook: string;
  firstFrame: string;
  kern: string;
  punkte?: string[];
  fakten: string[];
  muster: string[];
  unterschied: string;
  relevanz: string;
  /** Zielpfad auf heyaudit.de (UTM kommt im Wochenplan dazu). */
  ziel: string;
  laengeSek: number;
  voraussetzung?: string;
}

const IO = "Inhaber:in / Objektleitung einer Gebäudereinigung (5–250 Mitarbeitende)";
const DISPO = "Disposition / Einsatzplanung in Reinigung und Facility Service";
const HM = "Inhaber:in eines Hausmeisterservice";

/** Redaktioneller Vorrat. Hooks sind eigene Formulierungen, keine Übernahmen. */
export const SAMEN: readonly Same[] = [
  // ── TOFU: Reichweite über wiedererkennbare Alltagssituationen ─────────
  { key: "t-krank-0545", funnel: "TOFU", format: "pov_alltag", thema: "Ausfälle", unterthema: "Krankmeldung früh morgens", zielgruppe: DISPO,
    schmerz: "Kurz vor Schichtbeginn fällt jemand aus, Ersatz wird per Telefon und Chat gesucht.", lernziel: "Wiedererkennen: Ausfälle sind Planungs-, nicht Charakterproblem.",
    hook: "5:45 Uhr. Die erste Krankmeldung kommt als Sprachnachricht.", firstFrame: "Handy auf dem Küchentisch, Display leuchtet, Uhrzeit 05:45 groß eingeblendet.",
    kern: "Wer um 5:45 Ersatz sucht, braucht sofort den Überblick: wer ist frei, wer kennt das Objekt.", fakten: [], muster: ["P-POV"],
    unterschied: "Keine Comedy-Übertreibung, sondern ruhiger Ablauf einer echten Disponentenminute; Fokus auf die Frage „wer kennt das Objekt“.",
    relevanz: "Kurzfristige Ausfälle sind in der Gebäudereinigung täglich; Disponenten erkennen die Situation sofort.", ziel: "/schichtplanung-gebaeudereinigung", laengeSek: 20 },
  { key: "t-stundenzettel", funnel: "TOFU", format: "problembeobachtung", thema: "Zeiterfassung", unterthema: "Papier-Stundenzettel", zielgruppe: IO,
    schmerz: "Am Monatsende werden handschriftliche Zettel abgetippt, Rückfragen kosten Tage.", lernziel: "Kosten von Papierzetteln sichtbar machen, ohne Zahlen zu erfinden.",
    hook: "Monatsende heißt hier: Handschrift entziffern.", firstFrame: "Stapel zerknitterter Stundenzettel, ein Finger zeigt auf eine unleserliche Zahl.",
    kern: "Jede unleserliche Zeile ist eine Rückfrage — und Rückfragen landen immer beim Büro.", fakten: [], muster: ["P-KONTRAST"],
    unterschied: "Zeigt die Rückfrage-Kette statt eines Vorher/Nachher-Versprechens.",
    relevanz: "Viele kleine Reinigungsfirmen erfassen Zeiten noch auf Papier oder per Foto.", ziel: "/zeiterfassung-reinigungskraefte", laengeSek: 18 },
  { key: "t-schluessel", funnel: "TOFU", format: "pov_alltag", thema: "Objektverwaltung", unterthema: "Schlüssel und Zugänge", zielgruppe: IO,
    schmerz: "Niemand weiß sicher, wer den Schlüssel oder Code für ein Objekt hat.", lernziel: "Zugangsinfos gehören zum Objekt, nicht in Köpfe.",
    hook: "Eine Frage, die jede Objektleitung kennt: Wo ist der Schlüssel?", firstFrame: "Leeres Schlüsselbrett mit beschrifteten Haken, ein Haken fehlt.",
    kern: "Zugang, Alarmcode, Ansprechpartner: Wenn das nur eine Person weiß, steht das Objekt still, sobald sie fehlt.", fakten: [], muster: ["P-POV"],
    unterschied: "Thema ist Wissensabhängigkeit von einzelnen Personen, nicht Chaos-Humor.",
    relevanz: "Objektwechsel und Vertretungen scheitern oft an Zugangsinfos.", ziel: "/objektverwaltung-gebaeudereinigung", laengeSek: 20 },
  { key: "t-reklamation-freitag", funnel: "TOFU", format: "problembeobachtung", thema: "Qualität", unterthema: "Reklamation ohne Beleg", zielgruppe: IO,
    schmerz: "Der Kunde behauptet, es sei nicht gereinigt worden; es gibt keinen Beleg.", lernziel: "Nachweise sind Kundenbindung, nicht Bürokratie.",
    hook: "Der Kunde sagt: Freitag war niemand da. Was kannst du zeigen?", firstFrame: "E-Mail-Betreff „Reinigung Freitag ausgefallen?“ auf einem Laptop, Cursor blinkt.",
    kern: "Ohne Zeit, Foto oder Unterschrift steht Aussage gegen Aussage.", fakten: [], muster: ["P-FRAGE"],
    unterschied: "Endet bewusst mit der offenen Frage an Zuschauer statt mit Produkt.",
    relevanz: "Reklamationen sind für Gebäudereiniger ein direktes Vertragsrisiko.", ziel: "/objektakte-gebaeudereinigung", laengeSek: 20 },
  { key: "t-mythos-excel", funnel: "TOFU", format: "mythos_realitaet", thema: "Planung", unterthema: "Excel-Dienstplan", zielgruppe: IO,
    schmerz: "Der Excel-Plan funktioniert, bis Vertretungen und Versionen dazukommen.", lernziel: "Grenze von Tabellen erkennen, ohne Excel schlechtzureden.",
    hook: "„Excel reicht doch.“ Bis zur ersten Vertretung.", firstFrame: "Tabelle mit farbigen Zellen, Dateiname „Plan_final_NEU_2.xlsx“.",
    kern: "Excel ist gut für einen Plan. Schwierig wird es, wenn viele Leute gleichzeitig ändern und Bescheid wissen müssen.", fakten: [], muster: ["P-MYTHOS"],
    unterschied: "Respektiert Excel ausdrücklich, zeigt nur den Kipppunkt Vertretung/Versionen.",
    relevanz: "Excel ist laut Website-Positionierung die häufigste Alternative.", ziel: "/gebaeudereinigung", laengeSek: 22 },
  { key: "t-gruppenchat", funnel: "TOFU", format: "problembeobachtung", thema: "Kommunikation", unterthema: "Schichtänderung im Gruppenchat", zielgruppe: DISPO,
    schmerz: "Änderungen gehen im Gruppenchat unter, die Betroffenen lesen sie nicht.", lernziel: "Änderungen brauchen einen Adressaten, nicht ein Publikum.",
    hook: "Schichtänderung in die Gruppe gepostet. Gelesen hat sie genau die Falsche.", firstFrame: "Gruppenchat scrollt schnell, eine Nachricht „Morgen Objekt Süd statt Nord!“ rutscht nach oben weg.",
    kern: "Eine Änderung ist erst angekommen, wenn die betroffene Person sie sieht — nicht, wenn sie gepostet ist.", fakten: [], muster: ["P-KONTRAST"],
    unterschied: "Fokus auf „Adressat statt Publikum“, keine Messenger-Kritik.",
    relevanz: "Gruppenchats sind in Reinigungsteams der Standardkanal.", ziel: "/schichtplanung-gebaeudereinigung", laengeSek: 18 },
  { key: "t-erster-tag", funnel: "TOFU", format: "checkliste", thema: "Einarbeitung", unterthema: "Erster Arbeitstag", zielgruppe: IO,
    schmerz: "Neue Kräfte stehen am falschen Eingang oder kennen die Raumfolge nicht.", lernziel: "Drei Infos, die eine neue Kraft vor dem ersten Einsatz braucht.",
    hook: "Erster Arbeitstag, falscher Eingang. Muss nicht sein.", firstFrame: "Person mit Reinigungswagen vor einer verschlossenen Glastür, schaut aufs Handy.",
    kern: "Adresse mit Eingang, Zugang, Leistungsumfang — vor dem ersten Einsatz, nicht danach.", punkte: ["Adresse und welcher Eingang", "Zugang und Ansprechpartner vor Ort", "Was genau gereinigt wird (Raumliste/Checkliste)"],
    fakten: [], muster: ["P-LISTE"], unterschied: "Konkrete Checkliste statt allgemeiner Onboarding-Tipps.",
    relevanz: "Hohe Fluktuation macht Einarbeitung zum Dauerthema.", ziel: "/objektverwaltung-gebaeudereinigung", laengeSek: 25 },
  { key: "t-viele-sprachen", funnel: "TOFU", format: "problembeobachtung", thema: "Kommunikation", unterthema: "Mehrsprachige Teams", zielgruppe: IO,
    schmerz: "Anweisungen hängen auf Deutsch aus, das Team spricht viele Sprachen.", lernziel: "Verständlichkeit ist Qualitätssicherung.",
    hook: "Die Anweisung hängt auf Deutsch. Dein Team spricht viele Sprachen.", firstFrame: "Laminierter Aushang „Reinigungsplan“ an einer Kammertür, kleine Schrift.",
    kern: "Wenn eine Anweisung nicht verstanden wird, ist das kein Fehler der Kraft.", fakten: [], muster: ["P-POV"],
    unterschied: "Perspektive der Mitarbeitenden statt der Chefetage.",
    relevanz: "Mehrsprachige Teams sind in der Gebäudereinigung die Regel.", ziel: "/gebaeudereinigung", laengeSek: 18 },
  { key: "t-objekt-kippt", funnel: "TOFU", format: "checkliste", thema: "Qualität", unterthema: "Frühwarnzeichen", zielgruppe: IO,
    schmerz: "Ein Objekt verschlechtert sich schleichend, bis der Kunde kündigt.", lernziel: "Frühwarnzeichen benennen, bevor der Kunde anruft.",
    hook: "Drei Zeichen, dass ein Objekt kippt — bevor der Kunde anruft.", firstFrame: "Hand wischt über eine staubige Fensterbank, Finger in Nahaufnahme.",
    kern: "Qualität bricht selten plötzlich ein; die Zeichen sind vorher da.", punkte: ["Rückfragen aus dem Objekt häufen sich", "Ist-Zeiten weichen dauerhaft vom Plan ab", "Kontrollen finden nicht mehr statt"],
    fakten: [], muster: ["P-LISTE"], unterschied: "Fachliche Frühwarnliste statt Motivationssprüche.",
    relevanz: "Kundenverlust durch schleichende Qualität ist das Kernrisiko im Objektgeschäft.", ziel: "/checklisten-facility-management", laengeSek: 28 },
  { key: "t-august-urlaub", funnel: "TOFU", format: "pov_alltag", thema: "Abwesenheiten", unterthema: "Sommerurlaub", zielgruppe: DISPO,
    schmerz: "Alle wollen zur selben Zeit Urlaub, die Objekte laufen weiter.", lernziel: "Urlaubsplanung früh sichtbar machen.",
    hook: "Juli. Alle wollen im August frei. Wer reinigt dann?", firstFrame: "Wandkalender, August komplett mit Namen beschriftet.",
    kern: "Urlaub ist planbar — Konflikte sieht man nur, wenn alle Anträge an einem Ort liegen.", fakten: [], muster: ["P-POV"],
    unterschied: "Saisonaler Aufhänger, ohne Mitarbeitende schlecht dastehen zu lassen.",
    relevanz: "Urlaubsplanung trifft jede Reinigungsfirma jedes Jahr.", ziel: "/mitarbeiterverwaltung-reinigungsfirma", laengeSek: 18 },
  { key: "t-hausmeister-diese-woche", funnel: "TOFU", format: "problembeobachtung", thema: "Planung", unterthema: "Flexible Einsatztage", zielgruppe: HM,
    schmerz: "Pünktlichkeitslogik aus der Reinigung passt nicht auf Hausmeistertouren.", lernziel: "Hausmeisterarbeit hat eigene Planungslogik.",
    hook: "Beim Hausmeister zählt nicht die Minute. Es zählt die Woche.", firstFrame: "Transporter-Tür geht auf, Werkzeugkiste, Wochenliste auf Klemmbrett.",
    kern: "Bei Hausmeistertouren zählt, ob die Aufgabe in der Woche erledigt ist — nicht die Minute.", fakten: [], muster: ["P-KONTRAST"],
    unterschied: "Spricht explizit Hausmeisterdienste an, nicht Reinigung.",
    relevanz: "Hausmeisterservice ist eine eigene Zielgruppe mit eigener Seite auf heyaudit.de.", ziel: "/software-hausmeisterservice", laengeSek: 18 },
  { key: "t-uebergabe-fehler", funnel: "TOFU", format: "fehlerliste", thema: "Einarbeitung", unterthema: "Objektübergabe", zielgruppe: IO,
    schmerz: "Bei Personalwechsel geht Objektwissen verloren.", lernziel: "Typische Übergabefehler vermeiden.",
    hook: "Vier Fehler bei der Objektübergabe an eine neue Kraft.", firstFrame: "Zwei Hände, eine übergibt einen Schlüsselbund an die andere.",
    kern: "Übergabe ist der Moment, in dem Qualität verloren geht — oder bleibt.", punkte: ["Nur mündlich übergeben", "Sonderwünsche des Kunden nicht notiert", "Kein gemeinsamer erster Durchgang", "Ansprechpartner vor Ort nicht vorgestellt"],
    fakten: [], muster: ["P-LISTE"], unterschied: "Fehlerliste aus Sicht der Objektleitung, keine Produktnennung.",
    relevanz: "Personalwechsel sind in der Branche häufig.", ziel: "/objektverwaltung-gebaeudereinigung", laengeSek: 28 },

  // ── MOFU: Vertrauen — wie es in HeyAudit aussieht, nur belegte Funktionen ──
  { key: "m-qr-objekt", funnel: "MOFU", format: "mini_demo", thema: "Objektverwaltung", unterthema: "Objekt-QR", zielgruppe: IO,
    schmerz: "Kräfte vor Ort finden Aufgaben und Mängelmeldung nicht schnell.", lernziel: "Was der QR am Objekt tut — und was nicht.",
    hook: "Was passiert, wenn deine Kraft den QR-Code am Objekt scannt?", firstFrame: "Handy-Kamera richtet sich auf einen QR-Aufkleber neben einer Bürotür.",
    kern: "Der QR öffnet die Objektzentrale. Er bucht keine Zeit und speichert keinen Standort.", punkte: ["QR scannen und anmelden", "Objektzentrale: Arbeitszeit starten, Aufgaben", "Mangel mit Foto melden"],
    fakten: ["F-QR"], muster: ["P-SCREEN", "P-EHRLICH"], unterschied: "Kombiniert Mini-Demo mit klarer Grenze (kein Standort-Tracking).",
    relevanz: "Datenschutz-Sorgen der Mitarbeitenden sind ein häufiger Einwand gegen Apps.", ziel: "/objektakte-gebaeudereinigung", laengeSek: 30 },
  { key: "m-soll-ist", funnel: "MOFU", format: "mini_demo", thema: "Ausfälle", unterthema: "Soll/Ist am Morgen", zielgruppe: DISPO,
    schmerz: "Morgens ist unklar, ob alle Objekte besetzt sind.", lernziel: "Soll/Ist je Objekt auf einen Blick.",
    hook: "Wer ist da, wer fehlt, wer vertritt? Ein Blick, ein Objekt.", firstFrame: "Handy in der Hand, Objektansicht mit Status-Farben, Daumen scrollt.",
    kern: "Soll und Ist je Objekt: geplant, anwesend, fehlt, Vertretung, bestätigt abwesend.",
    fakten: ["F-SOLL-IST", "F-BROWSER"], muster: ["P-SCREEN"], unterschied: "Zeigt einen einzigen Bildschirm statt Feature-Tour.",
    relevanz: "Direkte Antwort auf das TOFU-Thema Krankmeldung früh morgens.", ziel: "/schichtplanung-gebaeudereinigung", laengeSek: 25 },
  { key: "m-handlungsbedarf", funnel: "MOFU", format: "mini_demo", thema: "Organisation", unterthema: "Handlungsbedarf", zielgruppe: IO,
    schmerz: "Offene Punkte stecken in Mails, Chats und Zetteln.", lernziel: "Eine Liste mit Ursache, Frist und nächstem Schritt.",
    hook: "Morgens eine Liste statt zehn Rückfragen.", firstFrame: "Übersicht „Handlungsbedarf“ am Laptop, oberster Fall rot markiert.",
    kern: "Offene Fälle aus Plan, Zeiten, Mängeln und Abrechnung nach Dringlichkeit — je Fall ein nächster Schritt.",
    fakten: ["F-HANDLUNG"], muster: ["P-SCREEN", "P-KONTRAST"], unterschied: "Kontrast Zettelchaos → eine Liste, ohne Zeitersparnis-Zahl.",
    relevanz: "Inhaber kleiner Firmen sind Disponent, Buchhalter und Qualität in einer Person.", ziel: "/gebaeudereinigung", laengeSek: 25 },
  { key: "m-nachweis-pdf", funnel: "MOFU", format: "mini_demo", thema: "Qualität", unterthema: "Nachweisbericht", zielgruppe: IO,
    schmerz: "Bei Reklamationen fehlt ein sauberer Nachweis.", lernziel: "Nachweisbericht je Objekt als PDF.",
    hook: "Reklamation auf dem Tisch? Zeig den Nachweis als PDF.", firstFrame: "PDF öffnet sich am Laptop, Titel „Nachweisbericht“, Fotoanlagen nummeriert.",
    kern: "PDF je Objekt für einen Zeitraum bis zu einem Jahr, Fotos und Unterschriften als nummerierte Anlagen.",
    fakten: ["F-NACHWEIS", "F-OBJEKTAKTE"], muster: ["P-SCREEN"], unterschied: "Löst die Frage aus dem TOFU-Video „Freitag war niemand da“ auf.",
    relevanz: "Leistungsnachweise sind für Auftraggeber und Hausverwaltungen wichtig.", ziel: "/reinigung-fuer-hausverwaltungen", laengeSek: 25 },
  { key: "m-mangel-foto", funnel: "MOFU", format: "mini_demo", thema: "Qualität", unterthema: "Mangel → Maßnahme", zielgruppe: IO,
    schmerz: "Gemeldete Mängel versanden ohne Zuständigkeit.", lernziel: "Vom Foto zur Maßnahme mit Frist.",
    hook: "Vom Foto bis zum erledigten Mangel: drei Schritte.", firstFrame: "Daumen tippt auf Kamera-Symbol, Foto eines tropfenden Wasserhahns.",
    kern: "Mangel mit Foto, Maßnahme mit Zuständigkeit und Frist, Erledigung nachvollziehbar.", punkte: ["Mangel mit Foto melden", "Maßnahme mit Zuständigkeit und Frist", "Erledigt und im Objekt dokumentiert"],
    fakten: ["F-AUDIT", "F-QR"], muster: ["P-SCREEN", "P-LISTE"], unterschied: "Ablauf in drei Schritten, ohne Versprechen zur Reaktionszeit.",
    relevanz: "Mängelmanagement entscheidet über Auftragsverlängerungen.", ziel: "/checklisten-facility-management", laengeSek: 30 },
  { key: "m-stundenkonto", funnel: "MOFU", format: "frage_antwort", thema: "Zeiterfassung", unterthema: "Stundenkonto-Streit", zielgruppe: IO,
    schmerz: "Mitarbeitende bezweifeln ihren Stundenstand.", lernziel: "Nachvollziehbares Stundenkonto beendet Diskussionen.",
    hook: "„Mir fehlen Stunden.“ So klärst du das ohne Diskussion.", firstFrame: "Sprechblase mit dem Satz „Mir fehlen Stunden.“ über einem Handy-Bildschirm.",
    kern: "Jede Buchung mit Herkunft, Korrekturen nur mit Grund; Mitarbeitende sehen ihre eigene Aufschlüsselung.",
    fakten: ["F-STUNDENKONTO"], muster: ["P-FRAGE", "P-SCREEN"], unterschied: "Startet mit dem Satz der Mitarbeitenden, nicht mit dem Feature.",
    relevanz: "Stundenstreit ist ein häufiger Kündigungs- und Konfliktgrund.", ziel: "/zeiterfassung-reinigungskraefte", laengeSek: 28 },
  { key: "m-fixierung", funnel: "MOFU", format: "mini_demo", thema: "Planung", unterthema: "Feste Zuordnungen", zielgruppe: DISPO,
    schmerz: "Automatische Planung wirft bewährte Zuordnungen um.", lernziel: "Feste Einsätze schützen.",
    hook: "Manche Einsätze dürfen sich nie ändern. Dann fixier sie.", firstFrame: "Schicht im Plan, Schloss-Symbol erscheint daneben.",
    kern: "Fixierte Schichten ändern Wochenplan-Lauf und Schichttausch nicht; aufheben nur mit Grund.",
    fakten: ["F-FIXIERUNG"], muster: ["P-SCREEN"], unterschied: "Ein einziges Detail-Feature statt Überblick.",
    relevanz: "Kunden wünschen oft feste Kräfte im Objekt.", ziel: "/schichtplanung-gebaeudereinigung", laengeSek: 20 },
  { key: "m-app-sprache", funnel: "MOFU", format: "mini_demo", thema: "Kommunikation", unterthema: "Mitarbeiter-App mehrsprachig", zielgruppe: IO,
    schmerz: "Kräfte verstehen die App-Oberfläche nicht.", lernziel: "Die Mitarbeiter-App in der eigenen Sprache.",
    hook: "Deine Kraft liest die App in ihrer Sprache.", firstFrame: "Zwei Handys nebeneinander, gleiche Ansicht in zwei Sprachen.",
    kern: "Die Mitarbeiter-App gibt es in [[Zahl aus SPRACHEN_SATZ]] Sprachen; eure eigenen Aufgabentexte bleiben, wie ihr sie schreibt.",
    fakten: ["F-SPRACHEN"], muster: ["P-KONTRAST", "P-EHRLICH"], unterschied: "Nennt die Grenze (eigene Texte werden nicht übersetzt) ausdrücklich.",
    relevanz: "Antwort auf das TOFU-Thema mehrsprachige Teams.", ziel: "/gebaeudereinigung", laengeSek: 20 },
  { key: "m-checkliste-version", funnel: "MOFU", format: "frage_antwort", thema: "Qualität", unterthema: "Leistungsverzeichnis ändert sich", zielgruppe: IO,
    schmerz: "Nach Vertragsänderung ist unklar, welche Checkliste wann galt.", lernziel: "Versionierte Checklisten.",
    hook: "Der Kunde ändert das Leistungsverzeichnis. Welche Checkliste gilt ab wann?", firstFrame: "Zwei Ausdrucke eines Leistungsverzeichnisses, eines durchgestrichen.",
    kern: "Checklisten mit Versionen: nachvollziehbar, was zu welchem Zeitpunkt galt.",
    fakten: ["F-AUDIT"], muster: ["P-FRAGE"], unterschied: "Fachfrage aus dem Vertragsalltag statt Produkt-Pitch.",
    relevanz: "Leistungsverzeichnisse ändern sich bei Vertragsverlängerungen regelmäßig.", ziel: "/checklisten-facility-management", laengeSek: 25 },
  { key: "m-mythos-zu-klein", funnel: "MOFU", format: "mythos_realitaet", thema: "Einstieg", unterthema: "Software für kleine Firmen", zielgruppe: IO,
    schmerz: "Kleine Firmen halten Software für zu groß oder zu teuer.", lernziel: "Free-Tarif als Einstieg.",
    hook: "„Für so kleine Firmen gibt’s nichts Passendes.“ Stimmt nicht.", firstFrame: "Kleines Büro, ein Schreibtisch, ein Ordner „Dienstplan“.",
    kern: "Free kostet nichts und läuft nicht ab: bis zu 3 Mitarbeiter und 5 Objekte, mit Zeiterfassung, Schichtplanung und Objektverwaltung.",
    fakten: ["F-FREE"], muster: ["P-MYTHOS"], unterschied: "Mythos-Format mit belegtem Free-Limit statt „günstig“-Behauptung.",
    relevanz: "Viele Gründer:innen in der Reinigung starten mit sehr kleinen Teams.", ziel: "/software-kleine-reinigungsfirmen", laengeSek: 22 },
  { key: "m-dokumente-ablauf", funnel: "MOFU", format: "mini_demo", thema: "Personal", unterthema: "Dokumente mit Ablaufdatum", zielgruppe: IO,
    schmerz: "Ablaufende Unterlagen von Mitarbeitenden werden zu spät bemerkt.", lernziel: "Personalakte mit Ablaufdaten.",
    hook: "Welche Unterlage läuft nächsten Monat ab? Ohne Ordner zu wälzen.", firstFrame: "Aktenordner wird zugeklappt, Schnitt auf Handy mit Personalakte.",
    kern: "Personalakte mit Dokumenten und Ablaufdatum, Abwesenheiten an einem Ort.",
    fakten: ["F-PERSONAL"], muster: ["P-KONTRAST", "P-SCREEN"], unterschied: "Kein konkreter Dokumenttyp als Rechtspflicht behauptet.",
    relevanz: "Fristen bei Personalunterlagen sind ein stilles Risiko für Arbeitgeber.", ziel: "/mitarbeiterverwaltung-reinigungsfirma", laengeSek: 22 },

  // ── BOFU: Kauf-/Demoabsicht — Preise, Grenzen, Umstieg, Demo ───────────
  { key: "b-umstieg-woche1", funnel: "BOFU", format: "checkliste", thema: "Umstieg", unterthema: "Erste Woche", zielgruppe: IO,
    schmerz: "Der Umstieg wirkt groß und unklar.", lernziel: "Konkrete erste Schritte.",
    hook: "Umstieg von Excel: Was du in Woche 1 wirklich tun musst.", firstFrame: "Checkliste mit drei leeren Kästchen auf einem Klemmbrett.",
    kern: "Klein anfangen: ein Objekt, ein Team, ein Plan.", punkte: ["Objekte mit Zugangsinfos anlegen", "Mitarbeitende einladen", "Ersten Wochenplan bauen"],
    fakten: ["F-BROWSER", "F-TEST"], muster: ["P-LISTE"], unterschied: "Nennt keine Zeitdauer für den Umstieg (nicht belegt).",
    relevanz: "Umstiegsaufwand ist der häufigste Grund, nicht zu wechseln.", ziel: "/signup", laengeSek: 30 },
  { key: "b-preise", funnel: "BOFU", format: "frage_antwort", thema: "Preis", unterthema: "Tarife erklärt", zielgruppe: IO,
    schmerz: "Preise sind bei Branchensoftware oft versteckt.", lernziel: "Tarife offen verstehen.",
    hook: "Was kostet HeyAudit — und was fehlt im Starter?", firstFrame: "Drei Karten nebeneinander: Starter, Business, Pro.",
    kern: "Starter 49 € (39 € jährlich), Business 79 € (69 €), Pro 179 € (149 €), netto. Im Starter fehlen Abrechnung, Steuerberater-Zugang, Auswertungen und Audit-Berichte.",
    fakten: ["F-PREISE", "F-STARTER-GRENZE"], muster: ["P-PREIS", "P-EHRLICH"], unterschied: "Nennt die Lücke des Starters offen.",
    relevanz: "Wettbewerber nennen oft keine Preise; Transparenz ist ein Unterscheidungsmerkmal.", ziel: "/reinigungssoftware", laengeSek: 30 },
  { key: "b-free-oder-test", funnel: "BOFU", format: "frage_antwort", thema: "Einstieg", unterthema: "Free vs. Test", zielgruppe: IO,
    schmerz: "Unklar, welcher Einstieg passt.", lernziel: "Free und 14-Tage-Test unterscheiden.",
    hook: "Free oder 14 Tage testen? Der Unterschied in 30 Sekunden.", firstFrame: "Zwei Wege-Schilder: „Free“ und „14 Tage testen“.",
    kern: "Free endet nicht (bis 3 Mitarbeiter, 5 Objekte). Der Test gilt für die bezahlten Tarife, 14 Tage, bis Testende kündbar.",
    fakten: ["F-FREE", "F-TEST"], muster: ["P-FRAGE"], unterschied: "Entscheidungshilfe statt Werbung.",
    relevanz: "Der doppelte Einstieg verwirrt sonst Interessenten kurz vor der Registrierung.", ziel: "/signup", laengeSek: 30 },
  { key: "b-demo-ablauf", funnel: "BOFU", format: "frage_antwort", thema: "Demo", unterthema: "Was in der Demo passiert", zielgruppe: IO,
    schmerz: "Demos wirken wie Verkaufsdruck.", lernziel: "Ablauf der Demo transparent.",
    hook: "Was in der Demo passiert — und was nicht.", firstFrame: "Laptop mit geöffnetem Videocall, Bildschirmfreigabe von HeyAudit.",
    kern: "Ted zeigt HeyAudit an eurem Ablauf: [[Ablauf der Demo in Teds Worten, Dauer bestätigen]].",
    fakten: ["F-DEMO"], muster: ["P-FRAGE", "P-EHRLICH"], unterschied: "Nimmt Druck raus; Ablauf kommt von Ted, nicht vom Generator.",
    relevanz: "Demo-Anfragen sind der direkteste Weg in die Sales-Pipeline.", ziel: "/demo", laengeSek: 25 },
  { key: "b-erechnung", funnel: "BOFU", format: "mini_demo", thema: "Abrechnung", unterthema: "E-Rechnung aus Arbeitsschein", zielgruppe: IO,
    schmerz: "E-Rechnung ist Pflichtthema, der Weg vom Einsatz zur Rechnung ist manuell.", lernziel: "XRechnung/ZUGFeRD ab Business — und die Grenzen.",
    hook: "Vom Arbeitsschein zur E-Rechnung: für wen das passt.", firstFrame: "Arbeitsschein mit Unterschrift, Schnitt auf Rechnungs-PDF.",
    kern: "XRechnung und ZUGFeRD aus Arbeitsschein und Auftrag, ab Business. Kein Buchhaltungssystem, kein Peppol-Versand.",
    fakten: ["F-ERECHNUNG", "F-ARBEITSSCHEIN"], muster: ["P-SCREEN", "P-EHRLICH"], unterschied: "Keine Rechtsfrist-Behauptung im Video; Frist nur mit amtlicher Quelle aus der Website.",
    relevanz: "E-Rechnung betrifft alle B2B-Reinigungsfirmen.", ziel: "/xrechnung-reinigungsfirma", laengeSek: 30 },
  { key: "b-lohn-grenze", funnel: "BOFU", format: "ehrliche_grenze", thema: "Abrechnung", unterthema: "Lohnabrechnung", zielgruppe: IO,
    schmerz: "Erwartung, dass Software die Lohnabrechnung ersetzt.", lernziel: "Klare Aufgabenteilung HeyAudit vs. Steuerberatung.",
    hook: "Ersetzt HeyAudit deine Lohnabrechnung? Nein. Das macht es stattdessen.", firstFrame: "Großes „Nein“ eingeblendet über einem Lohnzettel.",
    kern: "HeyAudit rechnet brutto vor; Lohnsteuer, Sozialversicherung und Nettolohn bleiben bei DATEV, Lexware oder der Steuerberatung.",
    fakten: ["F-LOHN-GRENZE", "F-STARTER-GRENZE"], muster: ["P-EHRLICH"], unterschied: "Ehrliche Grenze als Kaufargument.",
    relevanz: "Klärt einen häufigen Fehlkauf-Grund vor der Demo.", ziel: "/reinigungssoftware", laengeSek: 22 },
  { key: "b-helio", funnel: "BOFU", format: "mini_demo", thema: "KI", unterthema: "Assistent Helio", zielgruppe: IO,
    schmerz: "Angst, dass KI eigenmächtig Daten ändert.", lernziel: "Helio schlägt vor, die Person entscheidet.",
    hook: "Helio speichert nichts, bevor du klickst.", firstFrame: "Chatfenster „Helio“, darunter Knopf „Vorschlag übernehmen“.",
    kern: "Helio (nur Pro) beantwortet Bedienfragen und erklärt fehlende Nachweise; Mängel und Maßnahmen nur als Vorschlag.",
    fakten: ["F-HELIO", "F-KI-PRO"], muster: ["P-SCREEN", "P-EHRLICH"], unterschied: "Zeigt Kontrolle statt KI-Magie; nennt Pro-Bindung.",
    relevanz: "KI-Skepsis ist bei Inhaber:innen hoch; Kontrolle ist das Argument.", ziel: "/objektakte-gebaeudereinigung", laengeSek: 28 },
  { key: "b-datenstandort", funnel: "BOFU", format: "frage_antwort", thema: "Datenschutz", unterthema: "Wo liegen die Daten", zielgruppe: IO,
    schmerz: "Unsicherheit, wo Mitarbeiterdaten gespeichert werden.", lernziel: "Standort und Ausnahme KI offen nennen.",
    hook: "Wo liegen die Daten deiner Mitarbeitenden?", firstFrame: "Karte von Deutschland, Pin auf Frankfurt am Main.",
    kern: "Anwendung und Datenbank laufen in Frankfurt am Main. KI-Funktionen (Pro) laufen über OpenAI in den USA.",
    fakten: ["F-STANDORT", "F-KI-PRO"], muster: ["P-FRAGE", "P-EHRLICH"], unterschied: "Nennt die USA-Ausnahme selbst, statt sie zu verschweigen.",
    relevanz: "Datenschutz ist ein typischer Einwand in der Kaufphase.", ziel: "/gebaeudereinigung", laengeSek: 22 },
  { key: "b-hausmeister-fit", funnel: "BOFU", format: "frage_antwort", thema: "Passung", unterthema: "Hausmeisterservice", zielgruppe: HM,
    schmerz: "Unklar, ob Reinigungssoftware für Hausmeister taugt.", lernziel: "Was für Hausmeisterdienste konkret passt.",
    hook: "Kleiner Hausmeisterservice: Passt das überhaupt?", firstFrame: "Werkzeugkoffer auf dem Boden, Handy mit Aufgabenliste daneben.",
    kern: "Flexible Einsatztage, Aufgaben, Mängel, Arbeitsscheine; Einstieg mit Free möglich.",
    fakten: ["F-HAUSMEISTER", "F-FREE"], muster: ["P-FRAGE"], unterschied: "Eigenes Segment, eigene Landingpage.",
    relevanz: "Hausmeisterservice ist Zielgruppe mit eigener Seite.", ziel: "/software-hausmeisterservice", laengeSek: 25 },
  { key: "b-vorher-nachher", funnel: "BOFU", format: "vorher_nachher_echt", thema: "Umstieg", unterthema: "Echter Vorher/Nachher-Fall", zielgruppe: IO,
    schmerz: "[[Echter Ausgangszustand des Betriebs]]", lernziel: "Ein echter Umstieg, nachvollziehbar.",
    hook: "[[Hook aus dem echten Fall, mit Zustimmung]]", firstFrame: "[[Echtes Vorher-Bild aus dem Betrieb, freigegeben]]",
    kern: "[[Ergebnis nur mit belegten Zahlen des Betriebs]]", fakten: [], muster: ["P-KONTRAST"],
    unterschied: "Nur mit echtem Fall; der Generator setzt nichts ein.", relevanz: "Belegte Fälle sind das stärkste BOFU-Argument.",
    ziel: "/demo", laengeSek: 35, voraussetzung: "Echter Fall mit schriftlicher Freigabe des Betriebs; Kunden starten laut Gründer erst ab 01.01.2027." },
  { key: "b-kundengeschichte", funnel: "BOFU", format: "kundengeschichte", thema: "Referenz", unterthema: "Kundengeschichte", zielgruppe: IO,
    schmerz: "[[Ausgangslage in Worten des Kunden]]", lernziel: "Vertrauen durch echte Nutzer.",
    hook: "[[Wörtliches Kundenzitat, freigegeben]]", firstFrame: "[[Kunde im eigenen Objekt, Bildfreigabe liegt vor]]",
    kern: "[[Was sich geändert hat, in Worten des Kunden]]", fakten: [], muster: ["P-POV"],
    unterschied: "Nur mit Freigabe; keine nachgestellte Geschichte.", relevanz: "Referenzen fehlen bisher öffentlich (OMR: 0 Bewertungen am 17.11.).",
    ziel: "/demo", laengeSek: 40, voraussetzung: "Schriftliche Freigabe für Name, Zitat und Bild; frühestens nach Kundenstart 01.01.2027." },
];

// ── Generator ────────────────────────────────────────────────────────────
export interface Beat { nr: number; sek: string; sprecher: string; bild: string }
export interface PlattformVariante { plattform: Plattform; anzeigetext: string; caption: string; titel?: string; hashtags: string[]; manuell: string[]; befunde: string[] }

export interface Idee {
  id: string;
  key: string;
  funnel: Funnel;
  format: Format;
  thema: string;
  unterthema: string;
  zielgruppe: string;
  schmerz: string;
  lernziel: string;
  relevanz: string;
  hook: string;
  firstFrame: string;
  laengeSek: number;
  skript: Beat[];
  cta: { text: string; ziel: string };
  faktencheck: Array<{ id: string; aussage: string; quelle: string; grenze?: string }>;
  offen: string[];
  muster: Array<{ id: string; beschreibung: string }>;
  unterschied: string;
  untertitel: string;
  varianten: PlattformVariante[];
  status: "entwurf" | "gesperrt";
  sperrgrund?: string;
}

export const CTA: Record<Funnel, string> = {
  TOFU: "Folg für mehr Praxis aus der Gebäudereinigung.",
  MOFU: "Kostenlos ausprobieren: Free bis 3 Mitarbeiter und 5 Objekte — Link in der Bio.",
  BOFU: "Lass dir HeyAudit an deinem Ablauf zeigen — Demo über den Link in der Bio.",
};
const CTA_FAKTEN: Record<Funnel, string[]> = { TOFU: [], MOFU: ["F-FREE"], BOFU: ["F-DEMO"] };

const SKRIPT: Record<Format, (s: Same) => Array<[string, string]>> = {
  pov_alltag: (s) => [["[[Situation in eigenen Worten, 1 Satz]]", s.firstFrame], ["[[Was in dem Moment passiert / was du denkst]]", "Nahaufnahme Hände/Handy, Uhrzeit oder Ort bleibt eingeblendet"], ["[[Kernsatz]]: " + s.kern, "Text-Overlay mit dem Kernsatz"], ["[[Frage an die Zuschauer]]", "Blick in die Kamera oder ruhiges Schlussbild"]],
  problembeobachtung: (s) => [["[[Beobachtung, 1 Satz]]", s.firstFrame], ["[[Warum das jedes Mal passiert]]", "B-Roll aus dem Büro- oder Objektalltag (eigene Aufnahmen)"], ["[[Folge für Büro/Objekt]]", "Text-Overlay: " + s.kern], ["[[Wie gehst du damit um? Frage an die Zuschauer]]", "Schlussbild, CTA als Text"]],
  mythos_realitaet: (s) => [["Mythos: [[Behauptung wörtlich wie in der Branche gehört]]", "Tafel „Mythos“, " + s.firstFrame], ["Realität: [[eigene Erfahrung]]", "Tafel „Realität“"], ["[[Kernsatz]]: " + s.kern, "Text-Overlay"], ["[[Was das für dich heißt]]", "Schlussbild, CTA als Text"]],
  checkliste: (s) => [["[[Einleitung, 1 Satz]]", s.firstFrame], ...(s.punkte ?? ["[[Punkt 1]]", "[[Punkt 2]]", "[[Punkt 3]]"]).map((p, i): [string, string] => [`[[Punkt ${i + 1} erklären]]`, `Text-Overlay „${i + 1}. ${p}“`]), ["[[Abschluss]]", "Liste komplett einblenden zum Speichern"]],
  fehlerliste: (s) => [["[[Einleitung, 1 Satz]]", s.firstFrame], ...(s.punkte ?? ["[[Fehler 1]]", "[[Fehler 2]]", "[[Fehler 3]]"]).map((p, i): [string, string] => [`[[Fehler ${i + 1}: warum er passiert, was stattdessen]]`, `Text-Overlay „Fehler ${i + 1}: ${p}“`]), ["[[Abschluss]]", "Liste komplett einblenden zum Speichern"]],
  mini_demo: (s) => [["[[Problem in 1 Satz]]", s.firstFrame], ...(s.punkte ?? ["[[Schritt 1]]", "[[Schritt 2]]"]).map((p, i): [string, string] => [`[[Schritt ${i + 1} kommentieren]]`, `Bildschirmaufnahme (Testdaten, keine echten Namen): ${p}`]), ["[[Kernsatz]]: " + s.kern, "Text-Overlay mit Kernsatz"], ["[[CTA in eigenen Worten]]", "Schlussbild mit Logo"]],
  frage_antwort: (s) => [["[[Frage vorlesen]]", s.firstFrame + " — Frage als großer Text"], ["[[Kurze Antwort, 1 Satz]]", "Sprecher:in in die Kamera"], ["[[Erklärung]]: " + s.kern, "Bildschirmaufnahme oder Text-Overlay"], ["[[CTA in eigenen Worten]]", "Schlussbild"]],
  ehrliche_grenze: (s) => [["[[Frage/Erwartung aussprechen]]", s.firstFrame], ["[[Klares Nein und warum]]", "Text-Overlay „Das macht HeyAudit nicht“"], ["[[Was es stattdessen tut]]: " + s.kern, "Text-Overlay „Das macht HeyAudit“"], ["[[CTA in eigenen Worten]]", "Schlussbild"]],
  vorher_nachher_echt: (s) => [["[[Vorher, echt und freigegeben]]", s.firstFrame], ["[[Was geändert wurde]]", "[[Freigegebene Aufnahmen]]"], ["[[Ergebnis nur mit belegten Zahlen]]", "[[Beleg einblenden]]"]],
  kundengeschichte: (s) => [["[[Kunde stellt sich vor, freigegeben]]", s.firstFrame], ["[[Ausgangslage in Worten des Kunden]]", "[[Freigegebene Aufnahmen]]"], ["[[Was sich geändert hat]]", "[[Freigegebene Aufnahmen]]"]],
};

function beats(s: Same): Beat[] {
  const roh = SKRIPT[s.format](s);
  const hookBeat: Beat = { nr: 1, sek: "0–2", sprecher: `Hook: „${s.hook}“`, bild: `First Frame: ${s.firstFrame} Hook als Text-Overlay in den ersten 2 Sekunden.` };
  const rest = roh.map(([sprecher, bild], i) => ({ nr: i + 2, sek: "", sprecher, bild }));
  const spanne = Math.max(1, s.laengeSek - 2);
  rest.forEach((b, i) => {
    const von = 2 + Math.round((spanne * i) / rest.length);
    const bis = 2 + Math.round((spanne * (i + 1)) / rest.length);
    b.sek = `${von}–${bis}`;
  });
  return [hookBeat, ...rest];
}

const BASIS_TAGS = ["#gebäudereinigung", "#reinigungsfirma", "#facilitymanagement", "#objektleitung", "#dienstplan", "#zeiterfassung", "#hausmeisterservice", "#reinigungsbranche"];

function tags(s: Same, n: number): string[] {
  const thema = "#" + s.thema.toLowerCase().replace(/[^a-zäöüß]/g, "");
  return [...new Set([thema, ...BASIS_TAGS])].slice(0, n);
}

/** Plattformvariante: nur Text-/Caption-Anpassung; manuelle Schritte stehen getrennt. */
function variante(s: Same, p: Plattform, cta: string): PlattformVariante {
  const manuellBasis = ["Untertitel einbrennen (aus finalem Sprechertext)", "Nur eigene oder lizenzfreie Musik; kein Trend-Audio ohne Lizenzprüfung in der App", "Keine Mitarbeiter-/Kundenaufnahmen ohne schriftliche Freigabe"];
  let v: Omit<PlattformVariante, "befunde">;
  switch (p) {
    case "instagram":
      // Instagram: höchstens 5 Hashtags (Plattformgrenze seit 12/2025, Metricool-Hilfe "schedule-and-post-on-instagram").
      v = { plattform: p, anzeigetext: s.hook, caption: `${s.hook}\n\n${s.kern}\n\n${cta}\n\n${tags(s, 5).join(" ")}`, hashtags: tags(s, 5), manuell: [...manuellBasis, "Cover-Bild im 9:16-Reel mit 4:5-Ausschnitt prüfen", "Audio nur aus der Instagram-Bibliothek, wenn kommerziell freigegeben"] };
      break;
    case "tiktok":
      // TikTok über Metricool: keine Zeilenumbrüche in der Caption.
      v = { plattform: p, anzeigetext: s.hook, caption: `${s.hook} ${cta} ${tags(s, 4).join(" ")}`.replace(/\s*\n\s*/g, " "), hashtags: tags(s, 4), manuell: [...manuellBasis, "Nur Sounds aus der Commercial Music Library (Geschäftskonto)", "Link in der Bio prüfen (UTM tt-…)"] };
      break;
    case "youtube": {
      const titel = `${s.hook} #shorts`.slice(0, 100);
      v = { plattform: p, anzeigetext: s.hook, titel, caption: `${s.kern}\n\n${cta.replace("Link in der Bio", "Link in der Beschreibung")}`, hashtags: ["#shorts"], manuell: [...manuellBasis, "Titel ≤ 100 Zeichen prüfen", "Link in Beschreibung/angepinntem Kommentar"] };
      break;
    }
    case "facebook":
      v = { plattform: p, anzeigetext: s.hook, caption: `${s.hook}\n\n${s.kern}\n\n${cta.replace("Link in der Bio", "Link im Kommentar")}`, hashtags: tags(s, 3), manuell: [...manuellBasis, "Link als erster Kommentar setzen"] };
      break;
    case "linkedin":
      v = { plattform: p, anzeigetext: s.hook, caption: `${s.hook}\n\n${s.schmerz}\n\n${s.kern}\n\n${cta.replace("Link in der Bio", "Link im Kommentar")}`, hashtags: tags(s, 3), manuell: [...manuellBasis, "Hochformat-Video als natives Video hochladen, nicht als Link"] };
      break;
  }
  const befunde = pruefeText(v.caption).filter((b) => b.stufe === "fehler").map((b) => b.text);
  return { ...v, befunde };
}

/** Normalisierte Wortmenge für die Hook-Dublettenprüfung. */
function woerter(t: string): Set<string> {
  const stop = new Set(["der", "die", "das", "und", "ist", "ein", "eine", "du", "dein", "deine", "in", "im", "mit", "was", "wer", "wie", "zu", "von", "für", "bis", "nicht", "es", "an", "am", "auf", "so"]);
  return new Set(t.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
}

export function hookAehnlichkeit(a: string, b: string): number {
  const x = woerter(a), y = woerter(b);
  if (!x.size || !y.size) return 0;
  let schnitt = 0;
  for (const w of x) if (y.has(w)) schnitt++;
  return schnitt / (x.size + y.size - schnitt);
}

export const HOOK_SCHWELLE = 0.5;

/** Paare zu ähnlicher Hooks (Jaccard über Inhaltswörter). */
export function hookDubletten(samen: readonly Same[]): Array<[string, string, number]> {
  const out: Array<[string, string, number]> = [];
  for (let i = 0; i < samen.length; i++) for (let j = i + 1; j < samen.length; j++) {
    const a = samen[i]!, b = samen[j]!;
    if (a.hook.startsWith("[[") || b.hook.startsWith("[[")) continue;
    const s = hookAehnlichkeit(a.hook, b.hook);
    if (s >= HOOK_SCHWELLE) out.push([a.key, b.key, Math.round(s * 100) / 100]);
  }
  return out;
}

export function ideeId(s: Same): string {
  return `idee-${s.key}`;
}

export function generiereIdee(s: Same, plattformen: readonly Plattform[] = PLATTFORMEN): Idee {
  const unbekannt = [...s.fakten, ...CTA_FAKTEN[s.funnel]].filter((f) => !fakt(f));
  if (unbekannt.length) throw new Error(`${s.key}: unbekannte Fakten-ID ${unbekannt.join(", ")}`);
  const faktIds = [...new Set([...s.fakten, ...CTA_FAKTEN[s.funnel]])];
  const skript = beats(s);
  const cta = CTA[s.funnel];
  const alle = [s.hook, s.firstFrame, s.kern, s.schmerz, ...skript.flatMap((b) => [b.sprecher, b.bild])].join("\n");
  const offen = [...new Set(offenePlatzhalter(alle))];
  return {
    id: ideeId(s), key: s.key, funnel: s.funnel, format: s.format, thema: s.thema, unterthema: s.unterthema,
    zielgruppe: s.zielgruppe, schmerz: s.schmerz, lernziel: s.lernziel, relevanz: s.relevanz,
    hook: s.hook, firstFrame: s.firstFrame, laengeSek: s.laengeSek, skript,
    cta: { text: cta, ziel: s.ziel },
    faktencheck: faktIds.map((id) => { const f = fakt(id)!; return { id, aussage: f.aussage, quelle: f.quelle, ...(f.grenze ? { grenze: f.grenze } : {}) }; }),
    offen,
    muster: s.muster.map((id) => ({ id, beschreibung: MUSTER[id] ?? "unbekanntes Muster" })),
    unterschied: s.unterschied,
    untertitel: `Entwurf: „${s.hook}“ / „${s.kern}“ — final aus dem gesprochenen Text erzeugen.`,
    varianten: plattformen.map((p) => variante(s, p, cta)),
    status: s.voraussetzung ? "gesperrt" : "entwurf",
    ...(s.voraussetzung ? { sperrgrund: s.voraussetzung } : {}),
  };
}

export function generiereVorrat(samen: readonly Same[] = SAMEN): { ideen: Idee[]; dubletten: Array<[string, string, number]>; verteilung: Record<Funnel, number> } {
  const ideen = samen.map((s) => generiereIdee(s));
  const verteilung = { TOFU: 0, MOFU: 0, BOFU: 0 } as Record<Funnel, number>;
  for (const i of ideen) if (i.status !== "gesperrt") verteilung[i.funnel]++;
  return { ideen, dubletten: hookDubletten(samen), verteilung };
}

export function renderIdee(i: Idee): string {
  const l = [
    `### ${i.id} — ${i.funnel} · ${i.format} · ${i.thema}/${i.unterthema}${i.status === "gesperrt" ? " · GESPERRT" : ""}`,
    i.sperrgrund ? `> Gesperrt: ${i.sperrgrund}` : "",
    `- **Zielgruppe:** ${i.zielgruppe}`,
    `- **Schmerzpunkt:** ${i.schmerz}`,
    `- **Lernziel:** ${i.lernziel}`,
    `- **Warum relevant:** ${i.relevanz}`,
    `- **Hook:** ${i.hook}`,
    `- **First Frame:** ${i.firstFrame}`,
    `- **Länge:** ~${i.laengeSek} s · **CTA:** ${i.cta.text} → ${i.cta.ziel}`,
    "",
    "| # | Sek. | Sprechertext (Platzhalter) | Bild / On-Screen |", "|---|---|---|---|",
    ...i.skript.map((b) => `| ${b.nr} | ${b.sek} | ${b.sprecher.replace(/\|/g, "/")} | ${b.bild.replace(/\|/g, "/")} |`),
    "",
    `**Faktencheck:** ${i.faktencheck.length ? "" : "keine Produktaussage im Video."}`,
    ...i.faktencheck.map((f) => `- [ ] ${f.id}: ${f.aussage} _(Quelle: ${f.quelle}${f.grenze ? `; Grenze: ${f.grenze}` : ""})_`),
    i.offen.length ? `**Offene Platzhalter (${i.offen.length}):** ${i.offen.join(" · ")}` : "**Offene Platzhalter:** nur Sprechertexte",
    `**Referenzmuster:** ${i.muster.map((m) => `${m.id} (${m.beschreibung})`).join("; ")}`,
    `**Unterschied zu Referenzen:** ${i.unterschied}`,
    `**Untertitel:** ${i.untertitel}`,
  ];
  return l.filter((x) => x !== "").join("\n");
}
