// Brand Guardian tests — content QA + auto-correction. Deterministic, no AI.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CTAS, checkContent, autoCorrect, rotateCTA, withCalendar } from "./brand-guardian.js";

const has = (issues: ReturnType<typeof checkContent>["issues"], kind: string) => issues.some((i) => i.kind === kind);

describe("Brand Guardian: CTA engine", () => {
  test("rotates through the seven approved CTAs and wraps", () => {
    assert.equal(CTAS.length, 7);
    assert.equal(rotateCTA(0), "Kostenlos testen");
    assert.equal(rotateCTA(7), rotateCTA(0));
    assert.equal(rotateCTA(-1), CTAS[6]);
  });

  test("withCalendar appends a link only when configured", () => {
    assert.equal(withCalendar("Demo buchen"), "Demo buchen");
    assert.equal(withCalendar("Demo buchen", "https://cal.com/heycarbo"), "Demo buchen → https://cal.com/heycarbo");
  });
});

describe("Brand Guardian: auto-correction (mechanical)", () => {
  test("collapses double spaces and repeated hyphens, trims line ends", () => {
    assert.equal(autoCorrect("Hallo  Welt"), "Hallo Welt");
    assert.equal(autoCorrect("Test --- text"), "Test - text");
    assert.equal(autoCorrect("line   \nzwei"), "line\nzwei");
  });

  test("checkContent flags the mechanical issues as auto-fixed and corrects them", () => {
    const r = checkContent("Strom  sparen -- Demo buchen")
    assert.ok(has(r.issues, "double-space"));
    assert.ok(has(r.issues, "double-hyphen"));
    assert.equal(r.corrected, "Strom sparen - Demo buchen");
    assert.ok(r.ok, "mechanical fixes do not block");
  });
});

describe("Brand Guardian: semantic checks", () => {
  test("blocks greenwashing / unverifiable claims (ok = false)", () => {
    const r = checkContent("HeyCarbo macht dich 100% klimaneutral. Jetzt starten");
    assert.ok(has(r.issues, "greenwashing"));
    assert.equal(r.ok, false);
  });

  test("warns on AI-filler phrases", () => {
    const r = checkContent("Lassen Sie uns eintauchen in nahtlose Lösungen. Demo buchen");
    assert.ok(has(r.issues, "ai-filler"));
    assert.ok(r.ok, "warnings do not block");
  });

  test("warns when no approved CTA is present, passes when one is", () => {
    assert.ok(has(checkContent("Ein Beitrag ohne Handlungsaufforderung.").issues, "missing-cta"));
    assert.ok(!has(checkContent("Scope-3 in Minuten. Scope-3 analysieren").issues, "missing-cta"));
  });

  test("clean on-brand copy passes with no blocking issues", () => {
    const r = checkContent("Scope 3 muss nicht kompliziert sein.\nLade deine Daten hoch und sieh deine Hotspots.\nKostenlos testen")
    assert.equal(r.ok, true);
    assert.equal(r.issues.filter((i) => i.severity === "block").length, 0);
  });
});
