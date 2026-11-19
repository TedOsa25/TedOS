// Tagesplan: jeden Morgen ein Post im Format vom 04.11. Offline, feste Uhr.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { FORMAT_KATALOG, SCHLUSS, THEMA_JE_TAG, formatHtml } from "./format-katalog.js";
import { wochenplanFreigabe } from "./content-plan.js";
import { baueTagesplan } from "./tagesplan.js";

const JETZT = new Date("2026-11-11T08:00:00Z");

describe("Format-Katalog", () => {
  test("Jedes Thema hat mindestens zwei Motive, IDs eindeutig", () => {
    for (const t of new Set(THEMA_JE_TAG)) assert.ok(FORMAT_KATALOG.filter((m) => m.thema === t).length >= 2, t);
    assert.equal(new Set(FORMAT_KATALOG.map((m) => m.id)).size, FORMAT_KATALOG.length);
  });

  test("Text im Format vom 04.11.: Hook, ✓-Liste, fester Schluss, 12 Hashtags", () => {
    for (const m of FORMAT_KATALOG) {
      assert.ok(m.text.includes("\n✓ "), m.id);
      assert.ok(m.text.includes(SCHLUSS), m.id);
      assert.equal((m.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length, 12, m.id);
    }
  });

  test("Bild enthält die festen Format-Elemente", () => {
    const h = formatHtml(FORMAT_KATALOG[0]!);
    for (const s of ["HeyAudit", "14 Tage kostenlos testen", "Ab 39 € / Monat", "Mitarbeiter-App in 15 Sprachen.", "1080px"]) assert.ok(h.includes(s), s);
  });
});

describe("Tagesplan", () => {
  const plan = baueTagesplan({ jetzt: JETZT });

  test("7 Posts, Mo bis So der kommenden Woche, 07:30, Thema je Tag", () => {
    assert.equal(plan.kw, 47);
    assert.deepEqual(plan.eintraege.map((e) => e.datum), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    assert.ok(plan.eintraege.every((e) => e.art === "feed" && e.uhrzeit === "07:30"));
    assert.deepEqual(plan.eintraege.map((e) => (e.motiv as { thema?: string }).thema), THEMA_JE_TAG);
  });

  test("Keine Markenregel verletzt, keine Warnungen", () => {
    assert.deepEqual(plan.eintraege.flatMap((e) => e.befunde), []);
    assert.deepEqual(plan.warnungen, []);
  });

  test("Folgewoche nimmt die anderen Motive, erst danach Wiederholung", () => {
    const verlauf = plan.eintraege.map((e) => ({ motivId: e.motiv.id, datum: e.datum }));
    const w2 = baueTagesplan({ jetzt: new Date("2026-11-18T08:00:00Z"), verlauf });
    assert.equal(w2.kw, 48);
    for (const e of w2.eintraege) assert.ok(!verlauf.some((v) => v.motivId === e.motiv.id), e.motiv.id);
    assert.deepEqual(w2.warnungen, []);
    const w3 = baueTagesplan({ jetzt: new Date("2026-11-25T08:00:00Z"), verlauf: [...verlauf, ...w2.eintraege.map((e) => ({ motivId: e.motiv.id, datum: e.datum }))] });
    // Themen mit drei Motiven (zeit, nachweis: DATEV) zeigen erst das dritte, die anderen wiederholen Woche 1.
    assert.deepEqual(w3.eintraege.map((e) => e.motiv.id), plan.eintraege.map((e) => ({ f_zeit: "f_datev", f_nachweis: "f_steuerbuero" })[e.motiv.id] ?? e.motiv.id));
    assert.ok(w3.warnungen.some((w) => w.startsWith("Wiederholung")));
  });

  test("Ein Freigabe-Vorschlag je Woche", () => {
    const f = wochenplanFreigabe(plan);
    assert.equal(f.goalId, "growth:content:ig-2026-kw47");
    assert.match(f.title, /7 Posts, 0 Storys/);
  });
});
