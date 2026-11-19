// Ausfuehrer: nur Freigegebenes, nur heute, je Beitrag einmal. Offline.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ApprovalEntry } from "../approval-queue.js";
import { faelligeBeitraege, faelligeMetaAktionen, fuehreMetaAus, instagramKonto, postSchluessel, veroeffentliche } from "./ausfuehren.js";
import { KATALOG } from "./content-katalog.js";
import { baueWochenplan, wochenplanFreigabe } from "./content-plan.js";
import type { Abrufer } from "./meta-insights.js";

const plan = baueWochenplan(KATALOG, { jetzt: new Date("2026-11-11T08:00:00Z") }); // KW 47 ab 16.11.
const eintrag = (goalId: string, status: ApprovalEntry["status"]): ApprovalEntry => ({
  ...wochenplanFreigabe(plan),
  goalId,
  status,
  createdAt: "2026-11-11T08:00:00Z",
});
const MONTAG_8 = new Date("2026-11-16T07:00:00Z"); // 08:00 Berlin

describe("Fällige Instagram-Beiträge", () => {
  test("Nur aus freigegebenen Plänen, nur der heutige Tag", () => {
    assert.deepEqual(faelligeBeitraege([plan], [eintrag("growth:content:ig-2026-kw47", "pending")], {}, MONTAG_8).heute, []);
    const f = faelligeBeitraege([plan], [eintrag("growth:content:ig-2026-kw47", "approved")], {}, MONTAG_8);
    assert.deepEqual(f.heute.map((e) => e.datum), ["2026-11-16"]);
    assert.equal(f.verpasst.length, 0);
  });

  test("Schon veröffentlicht: nicht nochmal; vergangene Tage: verpasst, nicht nachgeholt", () => {
    const frei = [eintrag("growth:content:ig-2026-kw47", "approved")];
    const montag = plan.eintraege[0]!;
    assert.deepEqual(faelligeBeitraege([plan], frei, { [postSchluessel(montag)]: { mediaId: "1", zeit: "x" } }, MONTAG_8).heute, []);
    const mittwoch = faelligeBeitraege([plan], frei, { [postSchluessel(montag)]: { mediaId: "1", zeit: "x" } }, new Date("2026-11-18T07:00:00Z"));
    assert.deepEqual(mittwoch.heute.map((e) => e.datum), ["2026-11-18"]);
    assert.deepEqual(mittwoch.verpasst.map((e) => e.datum), ["2026-11-17"]);
  });

  test("Berliner Tag zählt, nicht UTC", () => {
    const f = faelligeBeitraege([plan], [eintrag("growth:content:ig-2026-kw47", "approved")], {}, new Date("2026-11-15T23:30:00Z"));
    assert.deepEqual(f.heute.map((e) => e.datum), ["2026-11-16"]);
  });
});

describe("Meta-Aktionen", () => {
  test("Nur freigegebene Start- und Pause-Vorschläge", () => {
    const a = faelligeMetaAktionen([
      eintrag("growth:meta:start:111", "approved"),
      eintrag("growth:meta:pause:222", "approved"),
      eintrag("growth:meta:start:333", "pending"),
      eintrag("growth:meta:start:444", "implemented"),
      eintrag("growth:meta:budget:555", "approved"),
    ]);
    assert.deepEqual(a, [
      { goalId: "growth:meta:start:111", art: "start", objektId: "111" },
      { goalId: "growth:meta:pause:222", art: "pause", objektId: "222" },
    ]);
  });
});

describe("Graph-Aufrufe", () => {
  const aufzeichnen = (antworten: Record<string, unknown>[]) => {
    const aufrufe: { url: string; body?: string }[] = [];
    const abruf: Abrufer = async (url, init) => {
      aufrufe.push({ url, ...(init ? { body: init.body } : {}) });
      const a = antworten.shift() ?? {};
      return { ok: !("error" in a), status: "error" in a ? 400 : 200, json: async () => a };
    };
    return { aufrufe, abruf };
  };

  test("Feed: Container mit Bild und Text, dann veröffentlichen", async () => {
    const { aufrufe, abruf } = aufzeichnen([{ id: "c1" }, { id: "m1" }]);
    const id = await veroeffentliche(plan.eintraege[0]!, "ig9", "https://bilder.example/social/", "EAAx", abruf);
    assert.equal(id, "m1");
    assert.match(aufrufe[0]!.url, /\/ig9\/media$/);
    const b = new URLSearchParams(aufrufe[0]!.body);
    assert.equal(b.get("image_url"), `https://bilder.example/social/${plan.eintraege[0]!.motiv.id}.png`);
    assert.equal(b.get("caption"), plan.eintraege[0]!.beitragstext);
    assert.equal(new URLSearchParams(aufrufe[1]!.body).get("creation_id"), "c1");
  });

  test("Story: media_type STORIES, kein Text", async () => {
    const story = plan.eintraege.find((e) => e.art === "story")!;
    const { aufrufe, abruf } = aufzeichnen([{ id: "c2" }, { id: "m2" }]);
    await veroeffentliche(story, "ig9", "https://b", "EAAx", abruf);
    const b = new URLSearchParams(aufrufe[0]!.body);
    assert.equal(b.get("media_type"), "STORIES");
    assert.equal(b.get("caption"), null);
  });

  test("Meta: Start aktiviert, Pause pausiert; Fehler von Meta wird gemeldet", async () => {
    const { aufrufe, abruf } = aufzeichnen([{ success: true }, { error: { message: "Keine Berechtigung" } }]);
    await fuehreMetaAus({ goalId: "g", art: "start", objektId: "111" }, "EAAx", abruf);
    assert.equal(new URLSearchParams(aufrufe[0]!.body).get("status"), "ACTIVE");
    await assert.rejects(fuehreMetaAus({ goalId: "g", art: "pause", objektId: "222" }, "EAAx", abruf), /Keine Berechtigung/);
    assert.equal(new URLSearchParams(aufrufe[1]!.body).get("status"), "PAUSED");
  });

  test("Ohne verbundenes Instagram-Konto: klare Fehlermeldung", async () => {
    const { abruf } = aufzeichnen([{ id: "seite" }]);
    await assert.rejects(instagramKonto("EAAx", abruf), /Kein Instagram-Konto/);
  });
});
