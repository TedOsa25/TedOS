// Zeitdarstellung für Operator-Ausgaben.
//
// Gespeichert wird konsequent UTC (ISO 8601 mit Offset) — das ist richtig und
// bleibt so. Gelesen werden die Berichte aber in Berlin, und eine Uhrzeit ohne
// Zeitzone wird als Ortszeit gelesen: Eine Abmeldung um 10:04 UTC als "10:04"
// auszuweisen, verschiebt sie im Kopf des Lesers um zwei Stunden. Im Sommer
// (CEST) sind das +2, im Winter (CET) +1 — deshalb wird die Umrechnung der
// Zeitzonendatenbank überlassen und nicht mit einem festen Offset gerechnet.

const TZ = "Europe/Berlin";

/** "13.08.2026, 12:04 (CEST)" — für Zeitpunkte in Berichten. */
export function berlinZeit(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const datum = new Intl.DateTimeFormat("de-DE", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
  const kuerzel = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, timeZoneName: "short" })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${datum}${kuerzel ? ` (${kuerzel})` : ""}`;
}

/** "13.08.2026" — wenn nur der Tag zählt. */
export function berlinDatum(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
