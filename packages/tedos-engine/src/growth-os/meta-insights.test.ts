// Meta-Anschluss: Antworten der Graph API -> Briefing-Quelle. Offline, feste Uhr.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { META_KONTO, holeMetaQuelle, metaQuelleAus, type Abrufer } from "./meta-insights.js";
import { tokenAus } from "./meta-run.js";

const JETZT = new Date("2026-11-11T07:00:00Z");

const INSIGHTS = {
  data: [
    {
      spend: "19.72",
      impressions: "1787",
      clicks: "146",
      actions: [
        { action_type: "link_click", value: "120" },
        { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "2" },
        { action_type: "complete_registration", value: "2" },
      ],
    },
  ],
};
const PIXEL = {
  data: [
    { data: [{ value: "PageView", count: 14 }, { value: "CompleteRegistration", count: 1 }] },
    { data: [{ value: "SignupAufgerufen", count: 3 }, { value: "RegistrierungBegonnen", count: 1 }] },
    { data: [{ value: "CompleteRegistration", count: 1 }, { value: "SignupAufgerufen", count: 7 }] },
  ],
};

describe("Meta-Anschluss", () => {
  test("Kennzahlen und Registrierungen, doppelte Aktionsnamen nicht addiert", () => {
    const q = metaQuelleAus(INSIGHTS, PIXEL, 7, JETZT);
    assert.equal(q.kontoId, META_KONTO);
    assert.equal(q.ausgabenEur, 19.72);
    assert.equal(q.klicks, 146);
    assert.equal(q.leads, 2);
    assert.deepEqual(q.pixel, { signupAufrufe: 10, registrierungBegonnen: 1, registrierungen: 2 });
  });

  test("Nichts ausgeliefert: echte Nullen; ohne Pixel-Recht: pixel null", () => {
    const q = metaQuelleAus({ data: [] }, null, 7, JETZT);
    assert.deepEqual([q.ausgabenEur, q.impressionen, q.klicks, q.leads, q.pixel], [0, 0, 0, 0, null]);
  });

  test("Nur GET-Lesezugriffe; Pixel-Fehler kippt den Lauf nicht; Fehler ohne Token", async () => {
    const urls: string[] = [];
    const ok: Abrufer = async (url) => {
      urls.push(url);
      if (url.includes("/stats")) return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => INSIGHTS };
    };
    const q = await holeMetaQuelle("EAAgeheim", 7, JETZT, ok);
    assert.equal(q.leads, 2);
    assert.equal(q.pixel, null);
    assert.ok(urls.every((u) => u.startsWith("https://graph.facebook.com/")));
    assert.ok(urls[0]!.includes(`act_${META_KONTO}/insights`));

    const kaputt: Abrufer = async () => ({ ok: false, status: 400, json: async () => ({}) });
    await assert.rejects(holeMetaQuelle("EAAgeheim", 7, JETZT, kaputt), (e: Error) => !e.message.includes("EAAgeheim"));
  });

  test("Token roh oder base64", () => {
    assert.equal(tokenAus("EAAabc\n"), "EAAabc");
    assert.equal(tokenAus(Buffer.from("EAAxyz").toString("base64")), "EAAxyz");
    assert.equal(tokenAus(""), "");
  });
});
