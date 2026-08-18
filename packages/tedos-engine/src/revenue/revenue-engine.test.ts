// Revenue Engine tests. Deterministic, offline — injected accounts/clock.
// Fixtures are minimal test doubles (the real engine reads crm-heycarbo/leads.js).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "../storage.js";
import { DistributionQueue } from "../distribution-queue.js";
import { parseLeads, normalize, prioritize, type Account } from "./accounts.js";
import { selectCampaign, qualityCheck, buildOpportunity, buildVariants, RevenueEngine } from "./revenue-engine.js";
import { germanizePain, researchIntro } from "./email-copy.js";

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
      "Bei unserer Recherche ist uns aufgefallen, dass Chemie AG internationale Industriekunden beliefert. Genau diese Unternehmen erwarten heute transparente CO₂-Daten entlang der gesamten Lieferkette.",
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
    assert.equal(selectCampaign(bare("Kunststoff")), "pcf");
    assert.equal(selectCampaign(bare("Elektrotechnik")), "pcf");
    assert.equal(selectCampaign(bare("Oberflächentechnik")), "pcf");
    assert.equal(selectCampaign(bare("Metall")), "pcf");
  });

  test("non-manufacturing branches keep the generic Scope-3 framing", () => {
    assert.equal(selectCampaign(bare("Logistik")), "scope-3");
    assert.equal(selectCampaign(bare("Beratung")), "scope-3");
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
