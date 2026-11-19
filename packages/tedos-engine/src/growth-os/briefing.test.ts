// Growth-Briefing + Signalprotokoll. Deterministisch, offline, feste Uhr.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApprovalQueue } from "../approval-queue.js";
import { InMemoryStorage } from "../storage.js";
import { baueBriefing, briefingSignale, renderBriefing, type AktivierungsSignalV1, type BriefingQuellen } from "./briefing.js";
import { NurLeseSpeicher, SignalLog, signal } from "./signal.js";

const JETZT = new Date("2026-11-11T07:00:00Z"); // 08:00 Berlin

const firma = (over: Partial<AktivierungsSignalV1> & Pick<AktivierungsSignalV1, "organizationId">): AktivierungsSignalV1 => ({
  version: 1,
  name: over.organizationId,
  tarif: "free",
  stufe: "registriert",
  score: 17,
  upgradeSignale: [],
  tageSeitRegistrierung: 1,
  journey: "keine",
  begruendung: "",
  ...over,
});

const leereFreigaben: BriefingQuellen["freigaben"] = {
  stats: { openApprovals: 0, avgBusinessImpactPending: 0, avgApprovalDurationMs: null, totalDecided: 0 },
  offen: [],
};

const quellen = (over: Partial<BriefingQuellen> = {}): BriefingQuellen => ({
  jetzt: JETZT,
  freigaben: leereFreigaben,
  mailVorschlaege: true,
  aktivierung: {
    berechnetAm: "2026-11-11T06:30:00Z",
    quelle: "lokal",
    signale: [
      firma({ organizationId: "a" }),
      firma({ organizationId: "b", stufe: "einrichtung", journey: "erstes_objekt", tageSeitRegistrierung: 3 }),
      firma({ organizationId: "c", stufe: "regelmaessig", score: 100, journey: "upgrade_angebot", upgradeSignale: ["objekt_limit_erreicht"], begruendung: "aktiv" }),
      firma({ organizationId: "d", tarif: "zahlend", stufe: "zahlend", score: 100, tageSeitRegistrierung: 40 }),
    ],
  },
  ...over,
});

const wert = (b: ReturnType<typeof baueBriefing>, label: string) =>
  b.abschnitte.flatMap((a) => a.kennzahlen).find((k) => k.label === label)?.wert;

describe("Briefing", () => {
  test("Datum in Berliner Zeit", () => {
    assert.equal(baueBriefing(quellen({ jetzt: new Date("2026-11-10T23:30:00Z") })).datum, "2026-11-11");
  });

  test("Zahlend nur aus Stripe-Tarif, Free-to-Paid gegen alle Firmen", () => {
    const b = baueBriefing(quellen());
    assert.equal(wert(b, "Zahlend (Stripe-Abo)"), "1");
    assert.equal(wert(b, "Free-to-Paid (zahlend / alle Firmen)"), "25 %");
    assert.equal(wert(b, "Aktiviert (mind. eine Zeiterfassung)"), "2 (50 %)");
  });

  test("Fehlende Quellen: nicht verfügbar statt erfundener Zahlen", () => {
    const b = baueBriefing({ jetzt: JETZT, freigaben: leereFreigaben });
    const text = renderBriefing(b, 0);
    assert.match(text, /Funnel: nicht verfügbar/);
    assert.match(text, /Meta Ads[\s\S]*nicht verfügbar: noch nicht angebunden/);
    assert.ok(b.warnungen.some((w) => w.includes("Keine Aktivierungsdaten")));
    assert.equal(b.vorschlaege.length, 0);
  });

  test("Veraltete Aktivierungsdaten werden gewarnt und niedrig bewertet", () => {
    const q = quellen();
    q.aktivierung!.berechnetAm = "2026-11-09T06:00:00Z";
    const b = baueBriefing(q);
    assert.ok(b.warnungen.some((w) => w.includes("älter als")));
    assert.equal(b.abschnitte[0]!.kennzahlen[0]!.beleg!.konfidenz, "niedrig");
  });

  test("Vorschläge: Upgrade je Firma + eine Journey je Lücke, alle MEDIUM", () => {
    const b = baueBriefing(quellen());
    const ids = b.vorschlaege.map((v) => v.goalId);
    assert.deepEqual(ids, ["growth:upgrade_angebot:c", "growth:journey:erstes_objekt"]);
    assert.ok(b.vorschlaege.every((v) => v.risk === "MEDIUM"));
  });

  test("Ohne Schalter keine Mail-Vorschläge (Gründer macht Mails selbst)", () => {
    const { mailVorschlaege: _aus, ...ohneSchalter } = quellen();
    const b = baueBriefing(ohneSchalter);
    assert.equal(b.vorschlaege.length, 0);
    assert.equal(wert(b, "Zahlend (Stripe-Abo)"), "1");
  });

  test("Herkunft je Kanal, nur wenn der Export sie enthält", () => {
    assert.ok(!baueBriefing(quellen()).abschnitte.some((x) => x.titel.startsWith("Herkunft")));
    const q = quellen();
    q.aktivierung!.signale[2]!.herkunft = { quelle: "instagram", kampagne: "ig-2026-kw47" };
    q.aktivierung!.signale[0]!.herkunft = null;
    const b = baueBriefing(q);
    assert.equal(wert(b, "instagram / ig-2026-kw47"), "1 Firmen, 1 aktiviert, 0 zahlend");
    assert.equal(wert(b, "ohne Kampagne"), "3 Firmen, 1 aktiviert, 1 zahlend");
  });

  test("Gleiche Vorschläge landen nur einmal in der ApprovalQueue", () => {
    const queue = new ApprovalQueue(new InMemoryStorage(), undefined, () => JETZT.toISOString());
    for (let lauf = 0; lauf < 2; lauf++) for (const v of baueBriefing(quellen()).vorschlaege) queue.enqueue(v);
    assert.equal(queue.pending().length, 2);
  });

  test("Gestoppter Versand wird genannt, nicht neu gestartet", () => {
    const b = baueBriefing(
      quellen({
        outbound: {
          stand: "2026-10-08T09:00:00Z",
          lifecycle: { sent: 90, replied: 4, "demo-booked": 1, unsubscribed: 5, bounced: 0 },
          letzterVersandtag: "2026-10-08",
          versandJobGeladen: false,
        },
      }),
    );
    const text = renderBriefing(b, 0);
    assert.match(text, /Versand ist gestoppt/);
    assert.equal(wert(b, "Kontaktiert"), "100");
    assert.equal(wert(b, "Abmeldungen"), "5 (5 %)");
    assert.ok(!b.vorschlaege.some((v) => v.goalId.includes("versand")));
  });

  test("Meta: Kosten pro Registrierung nur mit Registrierungen, Pixel, Alter", () => {
    const meta = { stand: JETZT.toISOString(), kontoId: "1081387852541408", zeitraum: "7 Tage", ausgabenEur: 20, impressionen: 1000, klicks: 30, leads: 0 };
    assert.equal(wert(baueBriefing(quellen({ meta })), "Kosten pro Registrierung"), "nicht verfügbar");
    assert.match(renderBriefing(baueBriefing(quellen({ meta })), 0), /keine Registrierung einer Anzeige zugeordnet/);
    assert.equal(wert(baueBriefing(quellen({ meta: { ...meta, leads: 4 } })), "Kosten pro Registrierung"), "5 €");
    const mitPixel = baueBriefing(quellen({ meta: { ...meta, pixel: { signupAufrufe: 10, registrierungBegonnen: 1, registrierungen: 2 } } }));
    assert.equal(wert(mitPixel, "Website: Registrierung abgeschlossen"), "2");
    const alt = baueBriefing(quellen({ meta: { ...meta, stand: "2026-11-09T06:00:00Z" } }));
    assert.ok(alt.warnungen.some((w) => w.startsWith("Meta-Zahlen sind älter")));
  });

  test("Signale: ein Briefing-Signal + ein approval_required je Vorschlag", () => {
    const s = briefingSignale(baueBriefing(quellen()), JETZT);
    assert.equal(s[0]!.art, "briefing.erstellt");
    assert.equal(s[0]!.modus, "execute_safe");
    assert.deepEqual(s.slice(1).map((x) => [x.von, x.modus]), [
      ["conversion", "approval_required"],
      ["lifecycle", "approval_required"],
    ]);
    assert.equal(new Set(s.map((x) => x.id)).size, s.length);
  });
});

describe("Signalprotokoll", () => {
  test("Anhängen und gefiltert lesen", () => {
    const dir = mkdtempSync(join(tmpdir(), "growth-signale-"));
    try {
      const log = new SignalLog(join(dir, "signale.jsonl"));
      log.anhaengen([signal({ von: "analytics", art: "kpi.aktualisiert", modus: "observe", betreff: "x", daten: {}, belege: [] }, JETZT)]);
      log.anhaengen(briefingSignale(baueBriefing(quellen()), JETZT));
      assert.equal(log.lesen().length, 4);
      assert.equal(log.lesen({ art: "vorschlag" }).length, 2);
      assert.equal(log.lesen({ von: "analytics" }).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NurLeseSpeicher verbietet Schreiben", () => {
    const innen = new InMemoryStorage();
    innen.save("k", 1);
    const s = new NurLeseSpeicher(innen);
    assert.equal(s.load<number>("k"), 1);
    assert.throws(() => s.save(), /verboten/);
  });
});
