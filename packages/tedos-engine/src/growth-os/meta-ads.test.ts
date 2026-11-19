// Meta-Ads-Agent: Befunde und Vorschlaege aus eigenen Kontozahlen. Offline.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { PAUSE_FAKTOR, analysiere, aufRegistrierung, holeMetaKonto, type MetaKonto } from "./meta-ads.js";
import type { Abrufer } from "./meta-insights.js";

const REG_GRUPPE = { optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: { custom_event_type: "COMPLETE_REGISTRATION" }, status: "ACTIVE" };

// Nachgebildet nach dem echten Konto (11.11.2026): Boosts auf Link-Klicks, Registrierungs-Kampagne pausiert.
const konto = (): MetaKonto => ({
  stand: "2026-11-11T08:00:00Z",
  zeitraumTage: 30,
  kampagnen: [
    { id: "boost", name: "Instagram-Beitrag: Mit HeyAudit organisierst du...", objective: "LINK_CLICKS", status: "PAUSED", effective_status: "PAUSED", daily_budget: "1000" },
    { id: "reg", name: "HeyAudit_Leads_Sep26", objective: "OUTCOME_LEADS", status: "PAUSED", effective_status: "PAUSED", daily_budget: "2000" },
    { id: "carbo", name: "HeyCarbo Traffic", objective: "OUTCOME_TRAFFIC", status: "PAUSED", effective_status: "PAUSED" },
  ],
  gruppen: [
    { id: "g1", name: "Boost", campaign_id: "boost", optimization_goal: "LINK_CLICKS", status: "ACTIVE" },
    { id: "g2", name: "Registrierung", campaign_id: "reg", ...REG_GRUPPE },
    { id: "g3", name: "Carbo", campaign_id: "carbo", optimization_goal: "LANDING_PAGE_VIEWS", status: "ACTIVE" },
  ],
  anzeigen: [
    { ad_id: "a1", ad_name: "Mit HeyAudit organisierst du...", campaign_id: "boost", spend: "5.76", impressions: "547", inline_link_clicks: "17" },
    { ad_id: "a2", ad_name: "Gebäudereinigung ohne...", campaign_id: "boost", spend: "13.33", impressions: "1180", inline_link_clicks: "119" },
    { ad_id: "c1", ad_name: "Carbo", campaign_id: "carbo", spend: "50", impressions: "5000", inline_link_clicks: "900" },
  ],
});

describe("Meta-Ads-Agent", () => {
  test("Erkennt Registrierungs-Gruppen", () => {
    assert.equal(aufRegistrierung({ id: "x", name: "x", campaign_id: "c", ...REG_GRUPPE }), true);
    assert.equal(aufRegistrierung({ id: "x", name: "x", campaign_id: "c", optimization_goal: "LINK_CLICKS", status: "ACTIVE" }), false);
  });

  test("Klick-Kampagne als Befund, pausierte Registrierungs-Kampagne als Start-Vorschlag (HIGH)", () => {
    const a = analysiere(konto());
    assert.ok(a.befunde.some((b) => b.includes("19,09 €") && b.includes("nicht auf Registrierung")));
    assert.deepEqual(a.vorschlaege.map((v) => [v.goalId, v.risk]), [["growth:meta:start:reg", "HIGH"]]);
    assert.match(a.vorschlaege[0]!.description, /20,00 €/);
    assert.equal(a.kostenJeRegistrierung, null);
  });

  test("Fremde Marke im Konto wird nicht bewertet", () => {
    const a = analysiere(konto());
    assert.ok(!a.befunde.some((b) => b.includes("Carbo")));
    assert.ok(a.befunde.some((b) => b.startsWith("Beste Link-Klickrate: „Gebäudereinigung ohne...“")));
  });

  test("Aktive Anzeige ohne Registrierung über dem Mehrfachen der eigenen Kosten: Pause (MEDIUM)", () => {
    const k = konto();
    k.kampagnen[1]!.effective_status = "ACTIVE";
    k.anzeigen.push(
      { ad_id: "r1", ad_name: "A_Nachweis", campaign_id: "reg", spend: "10", impressions: "800", inline_link_clicks: "20", actions: [{ action_type: "offsite_conversion.fb_pixel_complete_registration", value: "2" }] },
      { ad_id: "r2", ad_name: "B_Zettel", campaign_id: "reg", spend: String(PAUSE_FAKTOR * 25), impressions: "900", inline_link_clicks: "15" },
    );
    const a = analysiere(k);
    assert.ok(a.kostenJeRegistrierung !== null);
    const pause = a.vorschlaege.filter((v) => v.goalId.startsWith("growth:meta:pause:"));
    assert.deepEqual(pause.map((v) => [v.goalId, v.risk]), [["growth:meta:pause:r2", "MEDIUM"]]);
  });

  test("Abruf nur lesend, Fehler ohne Schlüssel", async () => {
    const urls: string[] = [];
    const ok: Abrufer = async (u) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    };
    const k = await holeMetaKonto("EAAgeheim", 30, new Date("2026-11-11T08:00:00Z"), ok);
    assert.equal(urls.length, 3);
    assert.ok(urls.every((u) => u.startsWith("https://graph.facebook.com/") && u.includes("act_1081387852541408")));
    assert.deepEqual([k.kampagnen, k.gruppen, k.anzeigen], [[], [], []]);
    const kaputt: Abrufer = async () => ({ ok: false, status: 400, json: async () => ({}) });
    await assert.rejects(holeMetaKonto("EAAgeheim", 30, new Date(), kaputt), (e: Error) => !e.message.includes("EAAgeheim"));
  });
});
