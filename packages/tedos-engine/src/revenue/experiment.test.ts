// Tests der A/B-Zuteilung. Der wichtigste Punkt ist nicht die Gleichverteilung,
// sondern die STABILITÄT: derselbe Lead muss über Läufe hinweg denselben Arm
// bekommen, sonst käme die Nachfassmail in anderer Tonalität als der
// Erstkontakt und die Auswertung wäre wertlos.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { assignArm, assignExperiment, experimentConfig, describeExperiment, ALL_VARIANTS } from "./experiment.js";

describe("assignArm", () => {
  test("ist deterministisch", () => {
    for (const id of ["HCG001", "HCH999", "HCR003"]) {
      assert.equal(assignArm(id, ALL_VARIANTS, "variant"), assignArm(id, ALL_VARIANTS, "variant"));
    }
  });

  test("verteilt über 1000 Ids halbwegs gleichmässig", () => {
    const c: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const a = assignArm(`L${i}`, ALL_VARIANTS, "variant");
      c[a] = (c[a] ?? 0) + 1;
    }
    for (const v of ALL_VARIANTS) {
      assert.ok((c[v] ?? 0) > 130, `${v} nur ${c[v]}× — Erwartung ~200`);
      assert.ok((c[v] ?? 0) < 270, `${v} ganze ${c[v]}× — Erwartung ~200`);
    }
  });

  test("verschiedene Salts entkoppeln die Achsen", () => {
    // Sonst bekäme jeder Lead mit Tonalität A immer denselben Betreff und die
    // beiden Effekte wären nicht auseinanderzuhalten.
    let gleich = 0;
    for (let i = 0; i < 200; i++) {
      const a = assignArm(`L${i}`, [0, 1, 2], "variant");
      const b = assignArm(`L${i}`, [0, 1, 2], "subject");
      if (a === b) gleich += 1;
    }
    assert.ok(gleich < 120, `${gleich}/200 identisch — Achsen sind gekoppelt`);
  });

  test("ein einzelner Arm ist immer die Antwort", () => {
    assert.equal(assignArm("X", ["E"], "variant"), "E");
  });
});

describe("experimentConfig", () => {
  test("ohne Konfiguration laufen ALLE Arme", () => {
    // Der Fehler, der behoben wurde: Number("") ist 0, nicht NaN — eine leere
    // Variable fror den Betreff-Test still auf "nur Variante 0" ein.
    const cfg = experimentConfig({} as NodeJS.ProcessEnv);
    assert.equal(cfg.variants.length, 5);
    assert.deepEqual(cfg.subjects, [0, 1, 2]);
  });

  test("lässt sich auf einen Gewinner einfrieren", () => {
    const cfg = experimentConfig({ REVENUE_TEST_VARIANTS: "E", REVENUE_TEST_SUBJECTS: "1" } as NodeJS.ProcessEnv);
    assert.deepEqual(cfg.variants, ["E"]);
    assert.deepEqual(cfg.subjects, [1]);
    assert.match(describeExperiment(cfg), /kein Test aktiv/);
  });

  test("ignoriert Unsinn statt zu raten", () => {
    const cfg = experimentConfig({ REVENUE_TEST_VARIANTS: "Z,Q", REVENUE_TEST_SUBJECTS: "abc" } as NodeJS.ProcessEnv);
    assert.equal(cfg.variants.length, 5);
    assert.deepEqual(cfg.subjects, [0, 1, 2]);
  });
});

describe("assignExperiment", () => {
  test("liefert gültige Werte und bleibt stabil", () => {
    const a = assignExperiment("HCG742");
    const b = assignExperiment("HCG742");
    assert.deepEqual(a, b);
    assert.ok(ALL_VARIANTS.includes(a.variant));
    assert.ok([0, 1, 2].includes(a.subjectIndex));
  });
});
