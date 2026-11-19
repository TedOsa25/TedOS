// Content-Agent: Wochenplan, Markenpruefung, Freigabe. Offline, feste Uhr.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ApprovalQueue } from "../approval-queue.js";
import { InMemoryStorage } from "../storage.js";
import { KATALOG } from "./content-katalog.js";
import {
  MAX_JE_SAEULE,
  baueWochenplan,
  isoWoche,
  naechsterMontag,
  pruefeText,
  renderWochenplan,
  utmLink,
  wochenplanFreigabe,
} from "./content-plan.js";
import { verlaufAus } from "./content-run.js";

const JETZT = new Date("2026-11-11T08:00:00Z"); // Mittwoch, KW 46

describe("Kalender", () => {
  test("ISO-Kalenderwoche, auch am Jahreswechsel", () => {
    assert.deepEqual(isoWoche(new Date("2026-11-16T00:00:00Z")), { jahr: 2026, kw: 47 });
    assert.deepEqual(isoWoche(new Date("2026-01-01T00:00:00Z")), { jahr: 2026, kw: 1 });
    assert.deepEqual(isoWoche(new Date("2027-01-01T00:00:00Z")), { jahr: 2026, kw: 53 });
  });

  test("Geplant wird immer die kommende Woche", () => {
    assert.equal(naechsterMontag(JETZT).toISOString().slice(0, 10), "2026-11-16");
    assert.equal(naechsterMontag(new Date("2026-11-16T09:00:00Z")).toISOString().slice(0, 10), "2026-11-23");
  });
});

describe("Wochenplan", () => {
  const plan = baueWochenplan(KATALOG, { jetzt: JETZT });

  test("4 Posts und 2 Storys in KW 47, nach Datum sortiert", () => {
    assert.equal(plan.kw, 47);
    assert.equal(plan.eintraege.filter((e) => e.art === "feed").length, 4);
    assert.equal(plan.eintraege.filter((e) => e.art === "story").length, 2);
    const daten = plan.eintraege.map((e) => e.datum);
    assert.deepEqual(daten, [...daten].sort());
    assert.equal(daten[0], "2026-11-16");
  });

  test("Höchstens zwei Posts je Säule", () => {
    const je = new Map<string, number>();
    for (const e of plan.eintraege.filter((x) => x.art === "feed")) je.set(e.motiv.saeule, (je.get(e.motiv.saeule) ?? 0) + 1);
    assert.ok([...je.values()].every((n) => n <= MAX_JE_SAEULE));
  });

  test("Alle Katalogtexte bestehen die Markenprüfung", () => {
    for (const e of plan.eintraege) assert.deepEqual(e.befunde.filter((b) => b.stufe === "fehler"), [], e.motiv.id);
    assert.equal(plan.warnungen.length, 0);
  });

  test("Zuletzt gezeigte Motive kommen später wieder dran", () => {
    const naechste = baueWochenplan(KATALOG, { jetzt: new Date("2026-11-18T08:00:00Z"), verlauf: verlaufAus([plan]) });
    const vorher = new Set(plan.eintraege.map((e) => e.motiv.id));
    assert.ok(naechste.eintraege.filter((e) => e.art === "feed").every((e) => !vorher.has(e.motiv.id)));
  });

  test("Link mit UTM je Motiv und Woche", () => {
    assert.equal(
      utmLink("krank", 2026, 47, "feed"),
      "https://app.heyaudit.de/signup?utm_source=instagram&utm_medium=organic_feed&utm_campaign=ig-2026-kw47-krank&utm_content=krank",
    );
    assert.ok(plan.eintraege.every((e) => e.link.includes(`utm_content=${e.motiv.id}`)));
  });

  test("Plan als Text nennt Entwurf, Bildquelle und Link", () => {
    const t = renderWochenplan(plan);
    assert.match(t, /nichts ist veröffentlicht/);
    assert.match(t, /Artboard `Post[A-Za-z]*\.dc\.html`/);
    assert.match(t, /utm_campaign=ig-2026-kw47/);
  });
});

describe("Markenprüfung", () => {
  test("Siezen, Superlative, erfundene Zahlen und falsche Preise", () => {
    const fehler = (t: string) => pruefeText(t).filter((b) => b.stufe === "fehler").map((b) => b.text);
    assert.ok(fehler("Testen Sie HeyAudit 14 Tage").some((x) => x.includes("Siezen")));
    assert.ok(fehler("Die beste Software, 14 Tage").some((x) => x.includes("Superlativ")));
    assert.ok(fehler("Spart 30 % Zeit, 14 Tage").some((x) => x.includes("Wirkungszahl")));
    assert.ok(fehler("Ab 59 € im Monat, 14 Tage").some((x) => x.includes("59 €")));
    assert.deepEqual(fehler("Ab 39 € im Monat bei jährlicher Zahlung, 14 Tage"), []);
  });
});

describe("Katalog", () => {
  test("Jeder Katalogtext besteht die Markenprüfung, IDs eindeutig", () => {
    for (const m of KATALOG) {
      const fehler = pruefeText(`${m.schlagzeile}\n${m.text}\n14 Tage kostenlos testen.`).filter((b) => b.stufe === "fehler");
      assert.deepEqual(fehler, [], m.id);
    }
    assert.equal(new Set(KATALOG.map((m) => m.id)).size, KATALOG.length);
  });
});

describe("Freigabe", () => {
  test("Ein Vorschlag je Woche, auch bei zweitem Lauf", () => {
    const q = new ApprovalQueue(new InMemoryStorage(), undefined, () => JETZT.toISOString());
    const p = baueWochenplan(KATALOG, { jetzt: JETZT });
    q.enqueue(wochenplanFreigabe(p));
    q.enqueue(wochenplanFreigabe(baueWochenplan(KATALOG, { jetzt: JETZT })));
    assert.equal(q.pending().length, 1);
    assert.equal(q.pending()[0]!.goalId, "growth:content:ig-2026-kw47");
    assert.equal(q.pending()[0]!.risk, "MEDIUM");
  });
});
