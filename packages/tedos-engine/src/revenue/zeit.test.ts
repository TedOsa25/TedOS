import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { berlinZeit, berlinDatum } from "./zeit.js";

describe("berlinZeit", () => {
  test("rechnet Sommerzeit korrekt um (+2)", () => {
    // Die reale Abmeldung: gespeichert 10:04 UTC, in Berlin 12:04 CEST.
    const s = berlinZeit("2026-08-13T10:04:09.743094+00:00");
    assert.match(s, /13\.08\.2026/);
    assert.match(s, /12:04/);
    assert.match(s, /MESZ|CEST|GMT\+2/);
  });

  test("rechnet Winterzeit korrekt um (+1)", () => {
    // Fester Offset waere hier falsch — deshalb Zeitzonendatenbank.
    const s = berlinZeit("2026-01-15T10:04:00.000Z");
    assert.match(s, /11:04/);
    assert.match(s, /MEZ|CET|GMT\+1/);
  });

  test("Tageswechsel wird mitgenommen", () => {
    // 22:30 UTC ist in Berlin bereits der Folgetag.
    assert.match(berlinDatum("2026-08-13T22:30:00.000Z"), /14\.08\.2026/);
  });

  test("unbrauchbare Eingaben stuerzen nicht ab", () => {
    assert.equal(berlinZeit(undefined), "—");
    assert.equal(berlinZeit("kein datum"), "kein datum");
  });
});
