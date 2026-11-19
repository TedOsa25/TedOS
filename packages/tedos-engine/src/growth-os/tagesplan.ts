// Taeglicher Instagram-Plan: jeden Morgen ein Post im Format vom 04.11.
// Rein: keine Uhr, kein Netz. Ergebnis hat denselben Typ wie der alte
// Wochenplan, damit Freigabe, Ausfuehrer und Briefing unveraendert bleiben.
//
// Je Wochentag ein Thema (THEMA_JE_TAG). Aus den Motiven des Themas wird das
// am laengsten nicht gezeigte genommen; ohne Verlauf das erste.

import { FORMAT_KATALOG, THEMA_JE_TAG, type FormatMotiv } from "./format-katalog.js";
import { isoWoche, naechsterMontag, pruefeText, utmLink, type PlanEintrag, type Wochenplan } from "./content-plan.js";

export const TAGES_UHRZEIT = "07:30";
const TAG = 86_400_000;
const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export function baueTagesplan(
  opt: { jetzt: Date; verlauf?: { motivId: string; datum: string }[] },
  katalog: FormatMotiv[] = FORMAT_KATALOG,
): Wochenplan {
  const montag = naechsterMontag(opt.jetzt);
  const { jahr, kw } = isoWoche(montag);
  const zuletzt = new Map<string, string>();
  for (const v of opt.verlauf ?? []) if ((zuletzt.get(v.motivId) ?? "") < v.datum) zuletzt.set(v.motivId, v.datum);

  const warnungen: string[] = [];
  const eintraege: PlanEintrag[] = [];
  THEMA_JE_TAG.forEach((thema, versatz) => {
    const kandidaten = katalog
      .map((m, i) => ({ m, i, d: zuletzt.get(m.id) ?? "" }))
      .filter((x) => x.m.thema === thema)
      .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1));
    const wahl = kandidaten[0]?.m;
    if (!wahl) {
      warnungen.push(`Kein Motiv für Thema „${thema}“ (${WOCHENTAGE[versatz]}).`);
      return;
    }
    if (zuletzt.has(wahl.id)) warnungen.push(`Wiederholung am ${WOCHENTAGE[versatz]}: ${wahl.titel} (Katalog für „${thema}“ erweitern).`);
    const tag = new Date(montag.getTime() + versatz * TAG);
    eintraege.push({
      datum: tag.toISOString().slice(0, 10),
      wochentag: WOCHENTAGE[versatz]!,
      uhrzeit: TAGES_UHRZEIT,
      art: "feed",
      motiv: wahl,
      beitragstext: wahl.text,
      link: utmLink(wahl.id, jahr, kw, "feed"),
      befunde: pruefeText(wahl.text),
    });
  });
  const fehler = eintraege.filter((e) => e.befunde.some((b) => b.stufe === "fehler"));
  if (fehler.length) warnungen.push(`${fehler.length} Beitrag/Beiträge verletzen Markenregeln.`);
  return { jahr, kw, montag: montag.toISOString().slice(0, 10), eintraege, warnungen };
}
