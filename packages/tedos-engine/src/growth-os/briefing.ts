// Growth OS: taegliches Management-Briefing (Orchestrator, Stufe 1).
//
// Rein: bekommt, was die Quellen geliefert haben, und baut daraus
//   1. das Briefing (Kennzahlen mit Quelle und Stand, Warnungen, Luecken),
//   2. Vorschlaege fuer die bestehende ApprovalQueue (nie direkt ausgefuehrt),
//   3. GrowthSignals fuer das gemeinsame Protokoll.
//
// Regeln:
// - Keine erfundenen Zahlen: fehlt eine Quelle, steht "nicht verfuegbar".
// - Ein Free-Nutzer ist kein Kunde: "zahlend" kommt nur aus dem
//   AktivierungsSignal (Stripe-Abo), nie aus Registrierungen.
// - Alles, was nach aussen wirkt, ist ein Vorschlag (approval_required).

import type { ApprovalInput, ApprovalStats } from "../approval-queue.js";
import { signal, type Beleg, type GrowthSignal } from "./signal.js";

/** Teilmenge von AktivierungsSignal v1 (heyaudit-dashboard lib/growth/aktivierung.ts). */
export interface AktivierungsSignalV1 {
  version: 1;
  organizationId: string;
  name: string | null;
  tarif: "free" | "trial" | "zahlend" | "abgelaufen" | "unbekannt";
  stufe: "registriert" | "einrichtung" | "eingerichtet" | "aktiviert" | "regelmaessig" | "zahlend";
  score: number;
  upgradeSignale: string[];
  tageSeitRegistrierung: number;
  journey: string;
  begruendung: string;
  /** Kanal der Registrierung (UTM des ersten Nutzers). Fehlt bei aelteren Exporten. */
  herkunft?: { quelle: string; kampagne: string | null } | null;
}

export interface BriefingQuellen {
  /**
   * Mail-Vorschlaege (Upgrade, Reaktivierung, Aktivierung) erzeugen?
   * Aus seit 2026-11-11: Mails an registrierte Firmen macht der Gruender
   * selbst (trial-lifecycle, onboarding-emails). Das Briefing zeigt nur Zahlen.
   */
  mailVorschlaege?: boolean;
  jetzt: Date;
  aktivierung?: { berechnetAm: string; quelle: string; signale: AktivierungsSignalV1[] };
  outbound?: {
    stand: string;
    lifecycle: Record<string, number>;
    letzterVersandtag: string | null;
    versandJobGeladen: boolean | null; // null = unbekannt
  };
  meta?: {
    stand: string;
    kontoId: string;
    zeitraum: string;
    ausgabenEur: number | null;
    impressionen: number | null;
    klicks: number | null;
    leads: number | null;
    /** Alle Pixel-Ereignisse der Website, nur Besucher mit Marketing-Einwilligung. */
    pixel?: { signupAufrufe: number; registrierungBegonnen: number; registrierungen: number } | null;
  };
  /** Befunde des Meta-Ads-Agenten (eingang/meta-ads.json). */
  metaAds?: { stand: string; befunde: string[] };
  freigaben: { stats: ApprovalStats; offen: { goalId: string; title: string; createdAt: string }[] };
}

export interface Kennzahl {
  label: string;
  wert: string; // formatiert, oder "nicht verfügbar"
  beleg: Beleg | null;
}

export interface Briefing {
  datum: string; // YYYY-MM-DD (Europe/Berlin)
  abschnitte: { titel: string; kennzahlen: Kennzahl[]; notizen: string[] }[];
  warnungen: string[];
  vorschlaege: ApprovalInput[];
}

/** Nach so vielen Stunden gilt eine Datenquelle als veraltet. */
export const VERALTET_NACH_STUNDEN = 36;
/** So viele Einzelvorschlaege (je Firma) hoechstens pro Briefing. */
export const MAX_EINZELVORSCHLAEGE = 10;

const NV = "nicht verfügbar";

function berlinDatum(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

function stundenAlt(stand: string, jetzt: Date): number {
  return (jetzt.getTime() - new Date(stand).getTime()) / 3_600_000;
}

function zahl(n: number | null | undefined, einheit = ""): string {
  if (n === null || n === undefined) return NV;
  return `${n.toLocaleString("de-DE")}${einheit}`;
}

function quote(zaehler: number, nenner: number): string {
  if (nenner === 0) return NV;
  return `${(Math.round((zaehler / nenner) * 1000) / 10).toLocaleString("de-DE")} %`;
}

const JOURNEY_TEXT: Record<string, string> = {
  einrichtung_anstossen: "Einrichtung anstoßen (seit Tagen nichts angelegt)",
  erstes_objekt: "Hilfe zum ersten Objekt",
  free_weitermachen: "Kostenlos mit Free weitermachen (Testphase abgelaufen)",
  mitarbeitende_einladen: "Mitarbeitende einladen",
  erste_schicht: "Erste Schicht planen",
  erste_zeiterfassung: "Erste Zeiterfassung",
  nutzung_festigen: "Nutzung festigen",
};

export function baueBriefing(q: BriefingQuellen): Briefing {
  const { jetzt } = q;
  const warnungen: string[] = [];
  const vorschlaege: ApprovalInput[] = [];
  const abschnitte: Briefing["abschnitte"] = [];

  // ── Produkt-Funnel (Free → Paid) ────────────────────────────────────────
  if (q.aktivierung) {
    const a = q.aktivierung;
    const beleg: Beleg = { quelle: `Aktivierung (${a.quelle})`, stand: a.berechnetAm, konfidenz: "hoch" };
    if (stundenAlt(a.berechnetAm, jetzt) > VERALTET_NACH_STUNDEN) {
      warnungen.push(`Aktivierungsdaten sind älter als ${VERALTET_NACH_STUNDEN} h (Stand ${a.berechnetAm}).`);
      beleg.konfidenz = "niedrig";
    }
    const s = a.signale;
    const n = (f: (x: AktivierungsSignalV1) => boolean) => s.filter(f).length;
    const aktiviert = n((x) => ["aktiviert", "regelmaessig", "zahlend"].includes(x.stufe));
    const zahlend = n((x) => x.tarif === "zahlend");
    const neu7 = n((x) => x.tageSeitRegistrierung < 7);
    abschnitte.push({
      titel: "Produkt-Funnel (Free → Paid)",
      kennzahlen: [
        { label: "Firmen gesamt (ohne Testfirmen)", wert: zahl(s.length), beleg },
        { label: "Neu registriert (7 Tage)", wert: zahl(neu7), beleg },
        { label: "Free", wert: zahl(n((x) => x.tarif === "free")), beleg },
        { label: "In Testphase", wert: zahl(n((x) => x.tarif === "trial")), beleg },
        { label: "Zahlend (Stripe-Abo)", wert: zahl(zahlend), beleg },
        { label: "Aktiviert (mind. eine Zeiterfassung)", wert: `${zahl(aktiviert)} (${quote(aktiviert, s.length)})`, beleg },
        { label: "Regelmäßig aktiv", wert: zahl(n((x) => x.stufe === "regelmaessig")), beleg },
        { label: "Free-to-Paid (zahlend / alle Firmen)", wert: quote(zahlend, s.length), beleg },
      ],
      notizen: [],
    });

    // Herkunft je Kanal: welche Kampagne bringt Firmen, Aktivierte, Zahlende.
    if (s.some((x) => x.herkunft !== undefined)) {
      const kanaele = new Map<string, { firmen: number; aktiviert: number; zahlend: number }>();
      for (const x of s) {
        const k = x.herkunft ? [x.herkunft.quelle, x.herkunft.kampagne].filter(Boolean).join(" / ") : "ohne Kampagne";
        const z = kanaele.get(k) ?? { firmen: 0, aktiviert: 0, zahlend: 0 };
        z.firmen++;
        if (["aktiviert", "regelmaessig", "zahlend"].includes(x.stufe)) z.aktiviert++;
        if (x.tarif === "zahlend") z.zahlend++;
        kanaele.set(k, z);
      }
      abschnitte.push({
        titel: "Herkunft der Firmen (UTM)",
        kennzahlen: [...kanaele.entries()]
          .sort((a, b) => b[1].firmen - a[1].firmen || a[0].localeCompare(b[0]))
          .map(([k, z]) => ({ label: k, wert: `${z.firmen} Firmen, ${z.aktiviert} aktiviert, ${z.zahlend} zahlend`, beleg })),
        notizen: ["Zählt nur Registrierungen, die über einen Link mit UTM-Kennung kamen; alle anderen stehen unter „ohne Kampagne“."],
      });
    }

    if (q.mailVorschlaege) {
    // Einzelvorschlaege: Upgrade und Reaktivierung je Firma, beste zuerst.
    const einzeln = s
      .filter((x) => x.journey === "upgrade_angebot" || x.journey === "reaktivierung")
      .sort((x, y) => (x.journey === y.journey ? y.score - x.score : x.journey === "upgrade_angebot" ? -1 : 1))
      .slice(0, MAX_EINZELVORSCHLAEGE);
    for (const x of einzeln) {
      const upgrade = x.journey === "upgrade_angebot";
      vorschlaege.push({
        goalId: `growth:${x.journey}:${x.organizationId}`,
        title: `${upgrade ? "Upgrade-Angebot" : "Reaktivierung"}: ${x.name ?? x.organizationId}`,
        description: `${x.begruendung}. Tarif ${x.tarif}, Stufe ${x.stufe}, Score ${x.score}. Vorgeschlagen vom Conversion-Agenten; Mail wird erst nach Freigabe vom Lifecycle-Agenten entworfen.`,
        businessImpact: upgrade ? 7 : 5,
        revenueImpact: upgrade ? 7 : 4,
        customerValue: 6,
        risk: "MEDIUM",
        priorityScore: upgrade ? 70 + Math.round(x.score / 10) : 50 + Math.round(x.score / 10),
        files: [],
        estimatedEffort: "1 Mail-Entwurf",
      });
    }

    // Sammelvorschlaege: eine Aktivierungs-Journey je Luecke.
    const nachJourney = new Map<string, AktivierungsSignalV1[]>();
    for (const x of s) {
      if (!JOURNEY_TEXT[x.journey]) continue;
      nachJourney.set(x.journey, [...(nachJourney.get(x.journey) ?? []), x]);
    }
    for (const [journey, firmen] of nachJourney) {
      vorschlaege.push({
        goalId: `growth:journey:${journey}`,
        title: `Aktivierungs-Journey "${JOURNEY_TEXT[journey]}" für ${firmen.length} Firma/Firmen`,
        description: `Betroffen: ${firmen.map((f) => f.name ?? f.organizationId).slice(0, 8).join(", ")}${firmen.length > 8 ? " …" : ""}. Lifecycle-Agent entwirft die Mail nach Freigabe; Einwilligung, Abmeldung und Frequenzgrenze werden vor Versand geprüft.`,
        businessImpact: 5,
        revenueImpact: 3,
        customerValue: 7,
        risk: "MEDIUM",
        priorityScore: 40 + Math.min(20, firmen.length * 2),
        files: [],
        estimatedEffort: "1 Mail-Vorlage",
      });
    }
    }
  } else {
    warnungen.push("Keine Aktivierungsdaten. `pnpm growth:aktivierung -- --json` im HeyAudit-Repo liefert sie.");
    abschnitte.push({ titel: "Produkt-Funnel (Free → Paid)", kennzahlen: [], notizen: [`Funnel: ${NV}.`] });
  }

  // ── Outbound (bestehende Revenue Engine, nur beobachtet) ─────────────────
  if (q.outbound) {
    const o = q.outbound;
    const beleg: Beleg = { quelle: "Revenue Engine runtime/heyaudit", stand: o.stand, konfidenz: "hoch" };
    const lc = o.lifecycle;
    const kontaktiert = (lc.sent ?? 0) + (lc.replied ?? 0) + (lc["demo-booked"] ?? 0) + (lc.won ?? 0) + (lc.lost ?? 0) + (lc.bounced ?? 0) + (lc.unsubscribed ?? 0);
    const notizen: string[] = [];
    if (o.versandJobGeladen === false) {
      notizen.push(`Versand ist gestoppt (Job nicht geladen). Letzter Versandtag: ${o.letzterVersandtag ?? NV}. Wiederanlauf nur mit deiner Freigabe.`);
    }
    abschnitte.push({
      titel: "Outbound (E-Mail-Erstkontakt)",
      kennzahlen: [
        { label: "Kontaktiert", wert: zahl(kontaktiert), beleg },
        { label: "Antworten", wert: zahl(lc.replied ?? 0), beleg },
        { label: "Demo gebucht", wert: zahl(lc["demo-booked"] ?? 0), beleg },
        { label: "Gewonnen", wert: zahl(lc.won ?? 0), beleg },
        { label: "Abmeldungen", wert: `${zahl(lc.unsubscribed ?? 0)} (${quote(lc.unsubscribed ?? 0, kontaktiert)})`, beleg },
        { label: "Bounces", wert: `${zahl(lc.bounced ?? 0)} (${quote(lc.bounced ?? 0, kontaktiert)})`, beleg },
      ],
      notizen,
    });
  } else {
    warnungen.push("Outbound-Stand nicht lesbar.");
  }

  // ── Paid Social (Meta) ──────────────────────────────────────────────────
  if (q.meta) {
    const m = q.meta;
    const alt = (jetzt.getTime() - new Date(m.stand).getTime()) / 3_600_000 > VERALTET_NACH_STUNDEN;
    if (alt) warnungen.push(`Meta-Zahlen sind älter als ${VERALTET_NACH_STUNDEN} Stunden (Stand ${m.stand.slice(0, 16).replace("T", " ")}).`);
    const beleg: Beleg = { quelle: `Meta Ads Konto ${m.kontoId}`, stand: m.stand, konfidenz: alt ? "niedrig" : "hoch" };
    const pixelBeleg: Beleg = { quelle: "Meta Pixel (nur mit Marketing-Einwilligung)", stand: m.stand, konfidenz: alt ? "niedrig" : "mittel" };
    const cpl = m.ausgabenEur !== null && m.leads ? Math.round((m.ausgabenEur / m.leads) * 100) / 100 : null;
    const kennzahlen: Kennzahl[] = [
      { label: "Ausgaben", wert: zahl(m.ausgabenEur, " €"), beleg },
      { label: "Impressionen", wert: zahl(m.impressionen), beleg },
      { label: "Klicks", wert: zahl(m.klicks), beleg },
      { label: "Registrierungen über Anzeigen", wert: zahl(m.leads), beleg },
      { label: "Kosten pro Registrierung", wert: zahl(cpl, " €"), beleg },
    ];
    if (m.pixel) {
      kennzahlen.push(
        { label: "Website: Registrierungsseite geöffnet", wert: zahl(m.pixel.signupAufrufe), beleg: pixelBeleg },
        { label: "Website: Registrierung begonnen", wert: zahl(m.pixel.registrierungBegonnen), beleg: pixelBeleg },
        { label: "Website: Registrierung abgeschlossen", wert: zahl(m.pixel.registrierungen), beleg: pixelBeleg },
      );
    }
    const notizen = ["Kosten pro zahlendem Kunden: nicht verfügbar, bis Signups der Kampagne zugeordnet werden (UTM → Firma)."];
    if (m.ausgabenEur && !m.leads) {
      notizen.unshift("Geld ausgegeben, aber keine Registrierung einer Anzeige zugeordnet. Kampagnen-Ziel und Messung prüfen.");
    }
    if (q.metaAds) notizen.push(...q.metaAds.befunde.map((b) => `Agent: ${b}`));
    abschnitte.push({ titel: `Meta Ads (${m.zeitraum})`, kennzahlen, notizen });
  } else {
    abschnitte.push({ titel: "Meta Ads", kennzahlen: [], notizen: [`${NV}: noch nicht angebunden.`] });
  }
  abschnitte.push({ titel: "Google Ads, LinkedIn, Instagram organisch", kennzahlen: [], notizen: [`${NV}: noch nicht angebunden.`] });

  // ── Offene Freigaben ────────────────────────────────────────────────────
  const fs = q.freigaben;
  abschnitte.push({
    titel: "Wartet auf deine Freigabe",
    kennzahlen: [{ label: "Offene Freigaben", wert: zahl(fs.stats.openApprovals), beleg: null }],
    notizen: fs.offen.slice(0, 10).map((e) => `${e.title} (seit ${e.createdAt.slice(0, 10)})`),
  });

  return { datum: berlinDatum(jetzt), abschnitte, warnungen, vorschlaege };
}

export function renderBriefing(b: Briefing, neueVorschlaege: number): string {
  const z: string[] = [`# HeyAudit Growth-Briefing ${b.datum}`, ""];
  if (b.warnungen.length) {
    z.push("## Achtung", ...b.warnungen.map((w) => `- ${w}`), "");
  }
  for (const a of b.abschnitte) {
    z.push(`## ${a.titel}`);
    for (const k of a.kennzahlen) {
      z.push(`- ${k.label}: **${k.wert}**${k.beleg ? `  _(${k.beleg.quelle}, Stand ${k.beleg.stand.slice(0, 16).replace("T", " ")})_` : ""}`);
    }
    for (const n of a.notizen) z.push(`- ${n}`);
    z.push("");
  }
  z.push(`## Neue Vorschläge`, `${neueVorschlaege} neu in der Freigabe-Warteschlange (nichts wurde ausgeführt).`);
  for (const v of b.vorschlaege) z.push(`- ${v.title}`);
  return z.join("\n") + "\n";
}

/** Protokoll-Eintraege fuer diesen Lauf. */
export function briefingSignale(b: Briefing, jetzt: Date): GrowthSignal[] {
  const out: GrowthSignal[] = [
    signal(
      {
        von: "orchestrator",
        art: "briefing.erstellt",
        modus: "execute_safe",
        betreff: `Growth-Briefing ${b.datum}`,
        daten: { warnungen: b.warnungen, abschnitte: b.abschnitte.map((a) => a.titel), vorschlaege: b.vorschlaege.length },
        belege: b.abschnitte.flatMap((a) => a.kennzahlen.map((k) => k.beleg)).filter((x): x is Beleg => !!x).slice(0, 5),
      },
      jetzt,
      0,
    ),
  ];
  b.vorschlaege.forEach((v, i) =>
    out.push(
      signal(
        {
          von: v.goalId.startsWith("growth:journey:") ? "lifecycle" : "conversion",
          an: "orchestrator",
          art: "vorschlag.erstellt",
          modus: "approval_required",
          betreff: v.title,
          daten: { goalId: v.goalId, priorityScore: v.priorityScore },
          belege: [],
        },
        jetzt,
        i + 1,
      ),
    ),
  );
  return out;
}
