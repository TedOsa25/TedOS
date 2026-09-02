// Revenue Engine tests. Deterministic, offline — injected accounts/clock.
// Fixtures are minimal test doubles (the real engine reads crm-heycarbo/leads.js).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "../storage.js";
import { DistributionQueue } from "../distribution-queue.js";
import { parseLeads, normalize, prioritize, type Account } from "./accounts.js";
import { selectCampaign, qualityCheck, buildOpportunity, buildVariants, RevenueEngine } from "./revenue-engine.js";
import { needLeadHeycarbo } from "./email-copy.js";
import {
  germanizePain, researchIntro, kampagnenName,
  FOLLOWUP1_ARME, FOLLOWUP2_ARME, followUp1Fuer, followUp2Fuer,
} from "./email-copy.js";

const clock = (): string => "2026-06-30T09:00:00.000Z";

// A real-format window.LEADS snippet (structure mirrors crm-heycarbo/leads.js).
const LEADS_TEXT = `// comment
window.LEADS = [
 {"id":"HC1","name":"GRAFE GmbH","prio":"A","score":89,"segment":"Automotive / Mobility","employees":405,"revenue":"~150M EUR","buyer_titles":["Head of Sustainability"],"email":"grafe@grafe.com","website":"https://grafe.com","heycarbo_pain_points":["OEM-Kunden fordern ISO 14067 PCF","Scope-3-Konsolidierung über mehrere Werke"],"catena_x_relevance":"high"},
 {"id":"HC2","name":"Kleinwerk GmbH","prio":"C","score":40,"segment":"Maschinenbau","employees":20,"heycarbo_pain_points":["CSRD-Berichtspflicht naht"]}
];`;

describe("accounts: parse + normalize + prioritize", () => {
  test("parses the window.LEADS format into normalized accounts", () => {
    const accts = parseLeads(LEADS_TEXT);
    assert.equal(accts.length, 2);
    assert.equal(accts[0]?.company, "GRAFE GmbH");
    assert.equal(accts[0]?.industry, "Automotive / Mobility");
    assert.equal(accts[0]?.fitScore, 89);
    assert.ok((accts[0]?.painPoints.length ?? 0) >= 1);
  });

  test("bad input never throws, returns []", () => {
    assert.deepEqual(parseLeads("not json"), []);
    assert.deepEqual(parseLeads(""), []);
  });

  test("prioritize sorts revenue-first then fit", () => {
    const accts = prioritize(parseLeads(LEADS_TEXT));
    assert.equal(accts[0]?.company, "GRAFE GmbH", "bigger + higher fit first");
  });
});

describe("revenue: campaign selection from real signals", () => {
  test("Catena-X signal → catena-x campaign", () => {
    const a = normalize({ id: "x", name: "Co", segment: "Automotive", catena_x_relevance: "high" }, 0);
    assert.equal(selectCampaign(a), "catena-x");
  });
  test("CSRD pain → csrd campaign", () => {
    const a = normalize({ id: "x", name: "Co", segment: "Maschinenbau", heycarbo_pain_points: ["CSRD-Berichtspflicht naht"] }, 0);
    assert.equal(selectCampaign(a), "csrd");
  });
});

describe("revenue: content generation + quality gates", () => {
  const a = parseLeads(LEADS_TEXT)[0] as Account;

  test("builds all artifacts from real data and passes quality", () => {
    const o = buildOpportunity(a, clock);
    assert.equal(o.subjects.length, 3);
    assert.ok(o.previewText.length > 0);
    assert.ok(o.emailHtml.includes("Guten Tag,"), "modern greeting");
    assert.ok(!/Sehr geehrte/.test(o.emailHtml), "no classical salutation");
    assert.ok(o.emailHtml.includes(o.banner.url), "central marketing banner referenced");
    // Banner appears EXACTLY once, directly above the signature (after the CTA).
    // `alt="HeyCarbo —` is unique to the banner (the signature logo uses alt="HeyCarbo").
    assert.equal(o.emailHtml.split('alt="HeyCarbo —').length - 1, 1, "banner exactly once");
    assert.ok(
      o.emailHtml.indexOf("7 Tage kostenlos testen") < o.emailHtml.indexOf('alt="HeyCarbo —'),
      "banner comes after the CTA (above the signature)",
    );
    assert.ok(o.emailHtml.includes("calendly.com/ted-heycarbo/30min"), "Calendly link present");
    assert.ok(o.emailHtml.includes("#13A6A6"), "website turquoise CTA");
    assert.ok(o.emailHtml.includes("7 Tage kostenlos testen"), "primary CTA button");
    assert.ok(o.emailHtml.includes("Oder direkt eine 15-Minuten-Demo vereinbaren"), "secondary demo link");
    // No broken relative image paths in the final email (icons/ or assets/).
    assert.ok(!/src\s*=\s*["']icons\//i.test(o.emailHtml), "no relative icons/ paths");
    assert.ok(!/src\s*=\s*["']assets\//i.test(o.emailHtml), "no relative assets/ paths");
    assert.ok(o.emailHtml.includes("GRAFE GmbH"), "company-specific intro uses the real name");
    assert.ok(o.followUp1.length > 0 && o.followUp2.length > 0);
    assert.ok(o.summary.includes("HeyCarbo"));
    assert.equal(o.quality.passed, true);
  });

  test("uses the default variant + standard research opener + layout order", () => {
    const o = buildOpportunity(a, clock);
    assert.equal(o.variant, "E", "default is the highest-conversion variant");
    assert.ok(o.emailHtml.includes("Product Carbon Footprints"), "value paragraph present");
    // New standard opener — the old ones must be gone.
    assert.ok(o.emailHtml.includes("Bei unserer Recherche ist uns aufgefallen"), "standard research opener");
    assert.ok(!/wir haben gesehen|mir ist aufgefallen/.test(o.emailHtml), "old openers removed");
    // Closing ask sits right under the personalized text — BEFORE the CTA.
    assert.ok(
      o.emailHtml.indexOf("15 Minuten") < o.emailHtml.indexOf("7 Tage kostenlos testen"),
      "closing ask under the text, above the CTA",
    );
  });

  test("generates all 5 variants, each on-brand and quality-passing", () => {
    const vs = buildVariants(a, clock);
    assert.deepEqual(Object.keys(vs).sort(), ["A", "B", "C", "D", "E"]);
    for (const v of ["A", "B", "C", "D", "E"] as const) {
      assert.equal(vs[v].variant, v);
      assert.equal(vs[v].quality.passed, true, `variant ${v} passes quality gates`);
      assert.ok(vs[v].emailHtml.includes("GRAFE GmbH"), `variant ${v} stays personalized`);
    }
    // Tones actually differ (intro copy is not identical across variants).
    assert.notEqual(vs.A.emailHtml, vs.C.emailHtml);
    assert.notEqual(vs.D.emailHtml, vs.E.emailHtml);
  });

  test("germanizePain turns long/English pain into a short German sentence", () => {
    assert.equal(germanizePain("We struggle with ISO 14067 PCF requirements from OEMs"), "Product Carbon Footprints nach ISO 14067 werden von Kunden gefordert.");
    assert.equal(germanizePain("CSRD reporting obligation approaching fast"), "Die CSRD-Berichtspflicht rückt näher.");
    assert.ok(germanizePain("Some very long unmapped sentence that keeps going and going far beyond a reasonable length for one line").length <= 90);
  });

  test("standard research opener — dynamic per branch, names real customers/OEMs", () => {
    const automotive = normalize({ id: "1", name: "GRAFE GmbH", segment: "Automotive / Mobility", customers: ["BMW", "Bosch"], supplier_pressure: "BMW und Bosch fordern PCF über Catena-X", catena_x_relevance: "high" }, 0);
    assert.equal(
      researchIntro(automotive),
      "Bei unserer Recherche ist uns aufgefallen, dass GRAFE GmbH unter anderem für BMW und Bosch produziert. Genau diese OEMs verlangen inzwischen ISO-14067-konforme PCF-Daten entlang Catena-X.",
    );
    const maschinenbau = normalize({ id: "2", name: "Muster GmbH", segment: "Maschinenbau" }, 1);
    assert.equal(
      researchIntro(maschinenbau),
      "Bei unserer Recherche ist uns aufgefallen, dass Muster GmbH zahlreiche Industriekunden beliefert. Genau diese Unternehmen fordern zunehmend belastbare Scope-3- und Product-Carbon-Footprint-Daten.",
    );
    const chemie = normalize({ id: "3", name: "Chemie AG", segment: "Chemie" }, 2);
    assert.equal(
      researchIntro(chemie),
      "Bei unserer Recherche ist uns aufgefallen, dass Chemie AG Industriekunden beliefert. Genau diese Unternehmen erwarten heute transparente CO₂-Daten entlang der gesamten Lieferkette.",
    );
    const logistik = normalize({ id: "4", name: "Trans GmbH", segment: "Logistik" }, 3);
    assert.equal(
      researchIntro(logistik),
      "Bei unserer Recherche ist uns aufgefallen, dass Trans GmbH für Unternehmen mit steigenden Nachhaltigkeitsanforderungen tätig ist. Immer mehr Auftraggeber erwarten inzwischen belastbare Scope-1-, Scope-2- und Scope-3-Daten.",
    );
    const elektronik = normalize({ id: "5", name: "Elektro AG", segment: "Elektronik" }, 4);
    assert.equal(
      researchIntro(elektronik),
      "Bei unserer Recherche ist uns aufgefallen, dass Elektro AG für internationale Industrieunternehmen produziert. Genau diese Kunden verlangen zunehmend standardisierte Product Carbon Footprints.",
    );
  });

  /**
   * Die Nachfass-Arme laufen ueber DIESELBEN Bausteine wie der Erstkontakt, und
   * beide haben eine Kongruenzfalle:
   *
   *   `bedarfsPhrase`  → immer Plural, schwach dekliniert ("belastbare … Daten").
   *                      Nach "für" (Akkusativ) korrekt, nach "bei" (Dativ) nicht.
   *   `kampagnenName`  → teils Plural ("Product Carbon Footprints"), muss darum
   *                      immer hinter "das Thema" stehen.
   *
   * Beide Fehler standen im ersten Entwurf der neuen Arme wörtlich im Text
   * ("Bei belastbare … Daten steckt", "Ist Product Carbon Footprints … ein
   * Thema?"). Der Test rendert deshalb JEDEN Arm gegen JEDEN Branchen-Bucket.
   */
  test("Nachfass-Arme: keine Numerus- oder Kasusfehler in irgendeiner Branche", () => {
    const buckets = [
      { segment: "Maschinenbau" }, { segment: "Chemie" }, { segment: "Logistik" },
      { segment: "Elektronik" }, { segment: "Möbel" }, { segment: "Werkzeugbau" },
      { segment: "Automotive / Mobility", catena_x_relevance: "high" },
      { segment: "Pharma" }, { segment: "Kunststoff" },
    ];
    const ctxs = ["pcf", "scope-3", "catena-x", "csrd", "supplier-management", "esg"];
    for (const [i, b] of buckets.entries()) {
      const a = normalize({ id: `f${i}`, name: "Muster GmbH", ...b } as never, i);
      for (const f of FOLLOWUP1_ARME) {
        const t = f(a);
        // Dativ-Falle: die Phrase darf nie direkt hinter einer Dativpräposition stehen.
        assert.ok(!/\b(bei|mit|von|zu|aus|nach) (belastbare|transparente|standardisierte|produktbezogene|konsolidierte|ISO-14067-konforme)\b/.test(t), `Kasusfehler: ${t}`);
        // Numerus-Falle: Singularverb vor der Pluralphrase.
        assert.ok(!/\bliegt (belastbare|transparente|standardisierte|produktbezogene|konsolidierte)/.test(t), `Numerusfehler: ${t}`);
        assert.ok(t.includes("Muster GmbH"), "der Firmenname muss vorkommen");
      }
      for (const c of ctxs) {
        for (const f of FOLLOWUP2_ARME) {
          const t = f(a, { campaign: c, calendlyUrl: "https://example.test/t" });
          const name = kampagnenName(c);
          // kampagnenName darf nur hinter "das Thema" stehen — sonst kippt die
          // Kongruenz, sobald das Label Plural ist.
          assert.ok(t.includes(`das Thema ${name}`), `"${name}" ohne "das Thema": ${t}`);
        }
      }
    }
  });

  test("Nachfass-Arme werden deterministisch und gleichmäßig zugeteilt", () => {
    const a = normalize({ id: "stabil-1", name: "Muster GmbH", segment: "Maschinenbau" } as never, 0);
    // Derselbe Lead bekommt über Läufe hinweg denselben Arm — sonst wechselte
    // ein Empfänger mitten in der Sequenz die Tonlage.
    assert.equal(followUp1Fuer(a).arm, followUp1Fuer(a).arm);
    assert.equal(followUp1Fuer(a).text, followUp1Fuer(a).text);

    // Stufe 1 und Stufe 2 haben getrennte Salts: über viele Leads dürfen die
    // Arme nicht paarweise gekoppelt sein.
    let gekoppelt = 0;
    const zaehler1 = [0, 0, 0], zaehler2 = [0, 0, 0];
    for (let i = 0; i < 600; i++) {
      const l = normalize({ id: `lead-${i}`, name: "X GmbH", segment: "Metall" } as never, i);
      const a1 = followUp1Fuer(l).arm;
      const a2 = followUp2Fuer(l, { campaign: "pcf", calendlyUrl: "u" }).arm;
      zaehler1[a1]! += 1; zaehler2[a2]! += 1;
      if (a1 === a2) gekoppelt += 1;
    }
    for (const n of [...zaehler1, ...zaehler2]) assert.ok(n > 120 && n < 280, `unausgewogen: ${n}/600`);
    assert.ok(gekoppelt > 120 && gekoppelt < 280, `Stufen sind gekoppelt: ${gekoppelt}/600 identisch`);
  });

  test("quality gates flag salesy + spam copy", () => {
    const bad = qualityCheck(["Wir sind die beste Lösung und Nr. 1!!!", "GRATIS testen"]);
    assert.equal(bad.passed, false);
    assert.equal(bad.tonality, false);
    assert.equal(bad.spam, false);
  });
});

describe("RevenueEngine: queueing + quota + missing data", () => {
  function setup(accounts: Account[], dailyTarget = 40, perTickCap = 8) {
    const storage = new InMemoryStorage();
    const queue = new DistributionQueue(storage, undefined, clock);
    const engine = new RevenueEngine(queue, storage, { accounts, clock, dailyTarget, perTickCap });
    return { storage, queue, engine };
  }

  test("queues 4 credential-gated artifacts per ready account (pending-approval)", () => {
    const accts = parseLeads(LEADS_TEXT);
    const { queue, engine } = setup(accts);
    const c = engine.run();
    assert.equal(c.dataAvailable, true);
    assert.ok(c.emailsCreated >= 1);
    assert.equal(c.followUpsCreated, c.emailsCreated * 2);
    // 4 jobs per account (email, linkedin, fu1, fu2), all pending-approval.
    assert.equal(queue.byStatus("pending-approval").length, c.emailsCreated * 4);
    assert.equal(queue.byStatus("sent").length, 0);
  });

  test("never exceeds the daily target across many ticks", () => {
    // Duplicate one account many times to exceed the target.
    const many = Array.from({ length: 60 }, (_, i) => normalize({ id: `a${i}`, name: `Co ${i}`, segment: "Automotive", score: 70, employees: 200 }, i));
    const { engine } = setup(many, 40, 8);
    let analyzed = 0;
    for (let i = 0; i < 20; i++) analyzed = engine.run().accountsAnalyzed;
    assert.equal(analyzed, 40, "stops at the daily quota");
  });

  test("no accounts → dataAvailable false + actionable missingData (no fabrication)", () => {
    const { engine } = setup([]);
    const c = engine.run();
    assert.equal(c.dataAvailable, false);
    assert.match(c.missingData ?? "", /REVENUE_ACCOUNTS_PATH/);
    assert.equal(c.readyToSend, 0);
  });
});

describe("need-adapted copy", () => {
  /** Minimal account carrying exactly one carbon signal, to steer selectCampaign. */
  const acct = (signal: Partial<Record<string, unknown>>): Account =>
    normalize({ id: "X1", name: "Musterteile GmbH", industry: "Automotive / Zulieferer",
      email: "info@musterteile.de", website: "https://musterteile.de", prio: "A", score: 88,
      employees: 300, ...signal }, 0);

  const CASES: [string, Record<string, unknown>, RegExp][] = [
    ["catena-x", { catena_x_relevance: "high" }, /Catena-X-Anfragen verlangen den PCF je Teilenummer/],
    ["pcf", { pcf_relevance: "high" }, /Product Carbon Footprints je Artikel/],
    ["csrd", { csrd_relevance: "high" }, /CSRD-Berichtspflicht/],
    ["supplier-management", { heycarbo_pain_points: ["Lieferant muss Daten liefern"] }, /eigene Scope-3-Bilanz/],
    ["esg", { heycarbo_pain_points: ["EcoVadis Fragebogen"] }, /EcoVadis- und CDP-Fragebögen/],
    // Industry override: the default fixture is automotive, which now correctly
    // resolves to catena-x — scope-3 is what a non-manufacturing branch gets.
    ["scope-3", { industry: "Logistik" }, /Scope 3 ist der größte Posten/],
  ];

  for (const [campaign, signal, expected] of CASES) {
    test(`"${campaign}" leads with the obligation that campaign implies`, () => {
      const a = acct(signal);
      const o = buildOpportunity(a, clock);
      assert.equal(selectCampaign(a), campaign);
      assert.match(o.emailHtml, expected);
    });
  }

  test("two different needs produce two different value paragraphs", () => {
    const catena = buildOpportunity(acct({ catena_x_relevance: "high" }), clock);
    const csrd = buildOpportunity(acct({ csrd_relevance: "high" }), clock);
    assert.notEqual(catena.emailHtml, csrd.emailHtml);
  });

  test("every need stays inside the word budget and passes the gates, in all variants", () => {
    for (const [, signal] of CASES) {
      for (const v of ["A", "B", "C", "D", "E"] as const) {
        const o = buildOpportunity(acct(signal), clock, v);
        assert.equal(o.quality.concise, true, `zu lang: Variante ${v}`);
        assert.equal(o.quality.passed, true, `Gate verletzt (${v}): ${o.quality.issues.join(", ")}`);
      }
    }
  });
});

describe("campaign fallback from industry", () => {
  const bare = (industry: string): Account =>
    normalize({ id: "Y1", name: "Teilewerk GmbH", industry, email: "info@teilewerk.de",
      website: "https://teilewerk.de", prio: "A", score: 88, employees: 300 }, 0);

  test("an unenriched supplier no longer collapses onto the generic default", () => {
    // These carry no pcf_/catena_x_/csrd_relevance and no pain points — the
    // normal state of ~97 % of the CRM.
    assert.equal(selectCampaign(bare("Automotive / Zulieferer")), "catena-x");
    assert.equal(selectCampaign(bare("Kunststoff")), "pcf-teil");
    assert.equal(selectCampaign(bare("Elektrotechnik")), "pcf-teil");
    assert.equal(selectCampaign(bare("Oberflächentechnik")), "pcf-teil");
    assert.equal(selectCampaign(bare("Metall")), "pcf-teil");
  });

  /**
   * TEIL vs. ERZEUGNIS, getrennt am 02.09.2026.
   *
   * Der VDMA-Messe-Import drehte den Pool auf Maschinenbau um: 626 von 780
   * offenen Leads trugen eine Branche, die keine der Werkstoff-Regeln traf,
   * und lasen deshalb alle denselben scope-3-Satz. Wer ein Teil zuliefert,
   * wird nach der Teilenummer gefragt; wer eine Maschine liefert, nach dem
   * Erzeugnis — zwei verschiedene Gespraeche.
   */
  test("Komponentenbauer bekommen die Teilenummer-Ansprache", () => {
    for (const ind of ["Antriebstechnik", "Armaturen", "Pumpen und Systeme", "Fluidtechnik", "Präzisionswerkzeuge"])
      assert.equal(selectCampaign(bare(ind)), "pcf-teil", ind);
  });

  test("Maschinen- und Anlagenbauer bekommen die Erzeugnis-Ansprache", () => {
    for (const ind of ["Lufttechnik", "Robotik und Automation", "Fördertechnik", "Landtechnik", "Holzbearbeitungsmaschinen"])
      assert.equal(selectCampaign(bare(ind)), "pcf-anlage", ind);
  });

  /**
   * Das Suffix schlaegt das Material — die teuerste Stelle der Regel.
   *
   * Die Teile-Liste enthaelt Werkstoffnamen, die zugleich in Maschinennamen
   * stecken. Wird sie zuerst geprueft, landen Werkzeug-, Verpackungs- und
   * Textilmaschinen bei "pcf-teil", obwohl sie ein Erzeugnis liefern. Beim
   * Pruefen von sechs neuen VDMA-Fachverbaenden am 02.09.2026 waeren drei
   * davon falsch angesprochen worden.
   */
  test("Maschinenbauer bleiben Erzeugnis, auch wenn der Name einen Werkstoff traegt", () => {
    for (const ind of ["Werkzeugmaschinenbau", "Nahrungsmittel- und Verpackungsmaschinen",
                       "Textilmaschinen", "Baumaschinen und Baustoffanlagen", "Druck- und Papiertechnik"])
      assert.equal(selectCampaign(bare(ind)), "pcf-anlage", ind);
  });

  test("der reine Werkstoff bleibt davon unberuehrt", () => {
    for (const ind of ["Papier", "Verpackung", "Textil", "Kunststoff", "Metall"])
      assert.equal(selectCampaign(bare(ind)), "pcf-teil", ind);
  });

  test("beide Zweige tragen einen eigenen, nicht-leeren Need-Satz", () => {
    const teil = needLeadHeycarbo("pcf-teil");
    const anlage = needLeadHeycarbo("pcf-anlage");
    assert.ok(teil.length > 0 && anlage.length > 0);
    assert.notEqual(teil, anlage, "sonst waere die Trennung folgenlos");
    // Budget aus dem Kommentar an HEYCARBO_NEED: hoechstens 16 Woerter.
    for (const satz of [teil, anlage]) assert.ok(satz.split(/\s+/).length <= 16, satz);
  });

  test("non-manufacturing branches keep the generic Scope-3 framing", () => {
    assert.equal(selectCampaign(bare("Logistik")), "scope-3");
    assert.equal(selectCampaign(bare("Beratung")), "scope-3");
    // Konsumgueter bleiben draussen: dort entscheidet der Handel, nicht ein
    // Industriekunde mit Scope-3-Bilanz.
    assert.equal(selectCampaign(bare("Kosmetik")), "scope-3");
    assert.equal(selectCampaign(bare("Lebensmittel")), "scope-3");
  });

  test("explicit enrichment still wins over the industry guess", () => {
    const a = normalize({ id: "Y2", name: "X", industry: "Kunststoff", email: "i@x.de",
      website: "https://x.de", prio: "A", score: 80, csrd_relevance: "high" }, 0);
    assert.equal(selectCampaign(a), "csrd"); // not "pcf"
  });

  test("the fallback still yields a need sentence within the gates", () => {
    for (const ind of ["Automotive / Zulieferer", "Kunststoff", "Logistik"]) {
      const o = buildOpportunity(bare(ind), clock);
      assert.equal(o.quality.passed, true, `Gate verletzt (${ind}): ${o.quality.issues.join(", ")}`);
      assert.ok(o.emailHtml.length > 0);
    }
  });
});

describe("Intro erfindet keine Kundenbeziehung", () => {
  const lead = (industry: string, extra: Record<string, unknown> = {}) =>
    normalize({ id: "T1", name: "Musterfirma GmbH", industry, email: "info@musterfirma.de", ...extra } as never, 0);

  test("ohne bekannte Kunden wird die Branche genannt, nicht 'Industriekunden'", () => {
    // Waldemar Link liefert Implantate an Kliniken, Kaldewei Wannen an den
    // Sanitärgroßhandel — "beliefert zahlreiche Industriekunden" war dort falsch.
    for (const branche of ["Medizintechnik", "SHK", "Beleuchtung", "Bahntechnik", "Papier"]) {
      const o = buildOpportunity(lead(branche), () => "2026-08-09T09:00:00.000Z", "E");
      assert.doesNotMatch(o.emailHtml, /Industriekunden beliefert/,
        `${branche}: behauptet Industriekunden ohne Beleg`);
      assert.ok(o.emailHtml.includes(`im Bereich ${branche} fertigt`),
        `${branche}: nennt die belegte Branche nicht`);
    }
  });

  test("echte OEM-Namen schlagen den Branchen-Fallback", () => {
    const o = buildOpportunity(
      lead("Medizintechnik", { supplier_pressure: "Beliefert BMW und Bosch" }),
      () => "2026-08-09T09:00:00.000Z", "E",
    );
    assert.match(o.emailHtml, /für BMW und Bosch produziert/);
    assert.doesNotMatch(o.emailHtml, /im Bereich Medizintechnik fertigt/);
  });

  test("Satz 2 bezieht sich sauber auf Satz 1", () => {
    const o = buildOpportunity(lead("Medizintechnik"), () => "2026-08-09T09:00:00.000Z", "E");
    // "Genau diese Unternehmen" hätte ohne genannte Kunden keinen Bezug.
    assert.doesNotMatch(o.emailText, /Genau diese Unternehmen/);
    assert.match(o.emailText, /Dort verlangen Kunden/);
  });
});

describe("Konsumgüter: Handel statt Industriekunden", () => {
  const lead = (industry: string) =>
    normalize({ id: "K1", name: "Musterfirma GmbH", industry, email: "info@musterfirma.de" } as never, 0);

  test("Konsumgüter behaupten nie Industriekunden", () => {
    // Bahlsen (Kekse), Kneipp (Drogerie), Nobilia (Küchen für Endkunden) —
    // deren Druck kommt vom Handel, nicht von Industriekunden.
    for (const b of ["Lebensmittel", "Kosmetik", "Möbel", "Textil"]) {
      const o = buildOpportunity(lead(b), () => "2026-08-09T09:00:00.000Z", "E");
      // Nur der Einstieg wird geprüft: der Value-Absatz ist kampagnengesteuert.
      assert.doesNotMatch(o.emailText.split("\n").filter(Boolean)[1] ?? "", /Industriekunden/, `${b}: behauptet Industriekunden`);
      assert.match(o.emailText, /Handelskunden und Ausschreibungen/, `${b}: nennt den Treiber nicht`);
    }
  });

  /**
   * Die Grenze zwischen den beiden Nachbarn: WELCHE Kunden folgt aus der
   * Branche, WIE WEIT sie reichen nicht. "Industriekunden" bleibt bei Chemie
   * wie bei Maschinenbau; "internationale" ist am 02.09.2026 gefallen, weil es
   * eine Behauptung ueber den einzelnen Empfaenger ist, die kein Feld deckt.
   */
  test("Chemie behauptet keine internationale Kundschaft", () => {
    for (const b of ["Chemie", "Kunststoff", "Polymer"]) {
      const o = buildOpportunity(lead(b), () => "2026-08-09T09:00:00.000Z", "E");
      assert.doesNotMatch(o.emailText, /internationale Industriekunden/, `${b}: behauptet internationale Kundschaft`);
      assert.match(o.emailText, /Industriekunden beliefert/, `${b}: nennt die Kundenart nicht mehr`);
    }
  });

  test("Maschinenbau behält die Industriekunden-Aussage — dort stimmt sie", () => {
    // Grenzebach, Heller, EMAG bauen Anlagen FÜR Industriekunden.
    const o = buildOpportunity(lead("Maschinenbau"), () => "2026-08-09T09:00:00.000Z", "E");
    assert.match(o.emailHtml, /Industriekunden beliefert/);
  });

  // Derselbe Fehler ist zweimal aufgetreten: erst im Default-Zweig (Waldemar
  // Link, Kaldewei), dann über den chemie-Zweig, in dem "pharma" mitlief.
  // Verla-Pharm, Hevert und Mucos beliefern Apotheken, Großhandel und Kliniken
  // — 9 von 18 Empfängern eines Batches hätten die Behauptung im ersten Satz
  // gelesen. Deshalb ein Test und nicht nur eine Korrektur.
  test("Pharma behauptet keine Industriekunden", () => {
    for (const b of ["Pharma", "Arzneimittel", "Biotech"]) {
      const o = buildOpportunity(lead(b), () => "2026-08-09T09:00:00.000Z", "E");
      const einstieg = o.emailText.split("\n").filter(Boolean)[1] ?? "";
      assert.doesNotMatch(einstieg, /Industriekunden/, `${b}: behauptet Industriekunden`);
      assert.match(einstieg, new RegExp(`im Bereich ${b} produziert`), `${b}: nennt die Branche nicht`);
    }
  });

  test("Medizintechnik nennt die Branche statt der Kunden", () => {
    // Königsee (Implantate), Geuder (Augenchirurgie) liefern an Kliniken.
    const o = buildOpportunity(lead("Medizintechnik"), () => "2026-08-09T09:00:00.000Z", "E");
    const einstieg = o.emailText.split("\n").filter(Boolean)[1] ?? "";
    assert.doesNotMatch(einstieg, /Industriekunden/);
    assert.match(einstieg, /im Bereich Medizintechnik fertigt/);
  });
});

describe("Nachfassen spricht dieselbe Sprache wie der Erstkontakt", () => {
  const lead = (industry: string) =>
    normalize({ id: "F1", name: "Musterfirma GmbH", industry, email: "info@musterfirma.de" } as never, 0);
  const fu1 = (industry: string) =>
    buildOpportunity(lead(industry), () => "2026-08-19T09:00:00.000Z", "E").followUp1;

  // Vorher gab es EINEN Nachfasssatz fuer alle: "falls CO₂-Bilanzierung und
  // PCF-Daten bei X gerade Thema sind". Ein Werkzeugbauer und eine Molkerei
  // bekamen denselben Text, obwohl der Erstkontakt sie sauber unterscheidet.
  test("der Bedarf im Nachfassen richtet sich nach der Branche", () => {
    assert.match(fu1("Automotive / Zulieferer"), /Catena-X/);
    assert.match(fu1("Maschinenbau"), /Scope-3/);
    assert.match(fu1("Möbel"), /Umweltproduktdeklarationen/);
    assert.match(fu1("Pharma"), /je Produkt/);
  });

  test("verschiedene Branchen bekommen verschiedene Texte", () => {
    const texte = new Set(["Automotive / Zulieferer", "Maschinenbau", "Möbel", "Pharma", "Logistik"].map(fu1));
    assert.equal(texte.size, 5, "mindestens eine Branche teilt sich noch einen Text");
  });

  // ctx.campaign ist ein technisches Kuerzel ("scope-3"). Ungefiltert stand es
  // kleingeschrieben mitten im Satz; ohne "das Thema" davor stimmte ausserdem
  // die Kongruenz nicht ("Sollte Product Carbon Footprints ...").
  test("die zweite Nachfassmail nennt kein technisches Kuerzel und ist grammatisch korrekt", () => {
    for (const b of ["Automotive / Zulieferer", "Maschinenbau", "Möbel", "Pharma"]) {
      const fu2 = buildOpportunity(lead(b), () => "2026-08-19T09:00:00.000Z", "E").followUp2;
      // Case-sensitive: "Catena-X und PCF" ist der LESBARE Name und erlaubt.
      // Verboten sind die kleingeschriebenen Store-Kuerzel und die alte
      // "-Themen"-Konstruktion.
      assert.doesNotMatch(fu2, /\bscope-3\b|\bcatena-x\b|-Themen\b/, `${b}: technisches Kuerzel im Text`);
      assert.match(fu2, /Sollte das Thema /, `${b}: Kongruenz-Konstruktion fehlt`);
    }
  });
});
