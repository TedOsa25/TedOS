// LinkedIn-Plan, Google-Entwurf, Tracking-Links, DATEV-Motive. Offline.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { beitragsKampagne, kampagnenLink } from "./content-plan.js";
import { FORMAT_KATALOG } from "./format-katalog.js";
import { baueSuchEntwurf, pruefeSuchanzeige } from "./google-ads.js";
import { baueLinkedinPlan, linkedinFreigabe } from "./linkedin.js";
import { baueTagesplan } from "./tagesplan.js";

const ig = baueTagesplan({ jetzt: new Date("2026-11-11T08:00:00Z") });

describe("Tracking-Link", () => {
  test("Beitrag steckt in utm_campaign (das speichert die App)", () => {
    const l = new URL(kampagnenLink({ quelle: "linkedin", medium: "organic", kampagne: beitragsKampagne("li", 2026, 48, "f_datev") }));
    assert.equal(l.origin + l.pathname, "https://app.heyaudit.de/signup");
    assert.equal(l.searchParams.get("utm_source"), "linkedin");
    assert.equal(l.searchParams.get("utm_campaign"), "li-2026-kw48-f_datev");
  });
  test("utm_campaign höchstens 80 Zeichen (Grenze der Datenbank)", () => {
    const l = new URL(kampagnenLink({ quelle: "x", medium: "y", kampagne: "a".repeat(120) }));
    assert.equal(l.searchParams.get("utm_campaign")!.length, 80);
  });
  test("Instagram-Plan: jeder Post mit eigener Kampagne", () => {
    assert.ok(ig.eintraege.every((e) => e.link.includes(`utm_campaign=ig-2026-kw47-${e.motiv.id}`)));
  });
});

describe("LinkedIn", () => {
  const li = baueLinkedinPlan(ig);
  test("Di bis Do, 08:30, gleiche Motive wie Instagram", () => {
    assert.deepEqual(li.eintraege.map((e) => e.datum), ["2026-11-17", "2026-11-18", "2026-11-19"]);
    assert.deepEqual(li.eintraege.map((e) => e.motivId), ig.eintraege.slice(1, 4).map((e) => e.motiv.id));
    assert.ok(li.eintraege.every((e) => e.uhrzeit === "08:30"));
  });
  test("Text: klickbarer Tracking-Link, 3 Hashtags, keine Regelverstöße", () => {
    for (const e of li.eintraege) {
      assert.ok(e.text.includes(e.link), e.motivId);
      assert.match(e.link, /utm_source=linkedin/);
      assert.equal((e.text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length, 3, e.motivId);
      assert.deepEqual(e.befunde.filter((b) => b.stufe === "fehler"), [], e.motivId);
    }
  });
  test("Ein Vorschlag je Woche", () => {
    assert.equal(linkedinFreigabe(li).goalId, "growth:content:li-2026-kw47");
  });
});

describe("Google-Suchanzeigen", () => {
  const e = baueSuchEntwurf();
  test("Entwurf hält Googles Grenzen und Markenregeln ein", () => {
    assert.deepEqual(e.befunde, []);
    assert.ok(e.titel.length <= 15 && e.beschreibungen.length <= 4);
  });
  test("Prüfung findet zu lange Titel, falsche Preise und Siezen", () => {
    const b = pruefeSuchanzeige(["Ein viel zu langer Anzeigentitel hier", "Nur 25 € im Monat", "Testen Sie jetzt"], ["a", "b"]);
    assert.equal(b.filter((x) => x.stufe === "fehler").length, 3);
  });
  test("Ziel-URL je Gruppe mit eigener Kampagne", () => {
    for (const g of e.gruppen) assert.match(g.link, new RegExp(`utm_source=google&utm_medium=cpc&utm_campaign=gads-suche-reinigung-${g.id}`));
  });
});

describe("DATEV-Motive", () => {
  test("Nur belegte Aussagen: DATEV Lohn und Gehalt, brutto, Steuerbüro bleibt", () => {
    for (const id of ["f_datev", "f_steuerbuero"]) {
      const m = FORMAT_KATALOG.find((x) => x.id === id)!;
      assert.ok(m.text.includes("DATEV Lohn und Gehalt"), id);
      assert.doesNotMatch(m.text, /LODAS|Nettolohn berechnet|Lohnsteuer berechnet/i, id);
    }
  });
});

describe("Vorschlag nur einmal vorlegen", () => {
  test("Abgelehnt oder freigegeben: kein neuer offener Vorschlag", async () => {
    const { vorlegen } = await import("./vorlegen.js");
    const eintraege: { goalId: string; status: string }[] = [{ goalId: "growth:meta:start:1", status: "rejected" }];
    const queue = { all: () => eintraege as never[], enqueue: (v: { goalId: string }) => { eintraege.push({ goalId: v.goalId, status: "pending" }); return v as never; } };
    assert.equal(vorlegen(queue, { goalId: "growth:meta:start:1" } as never), false);
    assert.equal(vorlegen(queue, { goalId: "growth:meta:start:2" } as never), true);
    assert.equal(eintraege.length, 2);
  });
});
