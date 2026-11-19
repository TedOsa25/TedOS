// Instagram-Akquise: Chargen, Grenzen, einmalige Nachricht. Offline.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dankNachricht, faelligeNachrichten, folgenRest, JE_CHARGE, neueCharge, zurueckGefolgt, type Bestand, type Kandidat } from "./ig-akquise.js";

const kand = (n: number): Kandidat[] => Array.from({ length: n }, (_, i) => ({ handle: `@Firma${i}`, name: `Firma ${i}`, grund: "Gebäudereinigung" }));

describe("Instagram-Akquise", () => {
  test("Charge: höchstens 15, ohne Doppelte, auch nicht aus früheren Chargen", () => {
    const b: Bestand = { kontakte: {} };
    const c1 = neueCharge(kand(20), b, "2026-11-12", "morgen");
    assert.equal(c1.length, JE_CHARGE);
    assert.equal(c1[0]!.handle, "firma0");
    for (const k of c1) b.kontakte[k.handle] = k;
    const c2 = neueCharge(kand(20), b, "2026-11-12", "abend");
    assert.deepEqual(c2.map((k) => k.handle), ["firma15", "firma16", "firma17", "firma18", "firma19"]);
  });

  test("Tageslimit 30 Folgen", () => {
    const b: Bestand = { kontakte: {} };
    for (const k of neueCharge(kand(15), b, "2026-11-12", "morgen")) b.kontakte[k.handle] = { ...k, status: "gefolgt", gefolgtAm: "2026-11-12T07:00:00Z" };
    assert.equal(folgenRest(b, "2026-11-12"), 15);
    assert.equal(folgenRest(b, "2026-11-13"), 30);
  });

  test("Nur wer zurückfolgt, bekommt die Nachricht, und nur einmal", () => {
    const b: Bestand = { kontakte: {} };
    for (const k of neueCharge(kand(3), b, "2026-11-12", "abend")) b.kontakte[k.handle] = { ...k, status: "gefolgt" };
    assert.deepEqual(zurueckGefolgt(b, ["@FIRMA1", "fremd"], "t"), ["firma1"]);
    assert.deepEqual(faelligeNachrichten(b, "2026-11-12").map((k) => k.handle), ["firma1"]);
    b.kontakte.firma1!.status = "angeschrieben";
    assert.deepEqual(zurueckGefolgt(b, ["firma1"], "t"), []);
    assert.deepEqual(faelligeNachrichten(b, "2026-11-12"), []);
  });

  test("Nachricht: Free-Angebot wie in der App, Link mit Tracking", () => {
    const t = dankNachricht();
    assert.match(t, /bis zu 3 Mitarbeiter und 5 Objekte/);
    assert.match(t, /heyaudit\.de\/gratis$/);
    assert.match(t, /E-Rechnung/);
    assert.ok(t.length < 1000);
  });
});
