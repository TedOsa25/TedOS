// Revenue Engine tests. Deterministic, offline — injected accounts/clock.
// Fixtures are minimal test doubles (the real engine reads crm-heycarbo/leads.js).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "../storage.js";
import { DistributionQueue } from "../distribution-queue.js";
import { parseLeads, normalize, prioritize, type Account } from "./accounts.js";
import { selectCampaign, qualityCheck, buildOpportunity, RevenueEngine } from "./revenue-engine.js";

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
    assert.ok(o.emailHtml.includes("calendly.com/ted-heycarbo/30min"), "Calendly link present");
    assert.ok(o.emailHtml.includes("#0d9488"), "HeyCarbo turquoise CTA");
    assert.ok(o.emailHtml.includes("GRAFE GmbH"), "company-specific intro uses the real name");
    assert.ok(o.followUp1.length > 0 && o.followUp2.length > 0);
    assert.ok(o.summary.includes("HeyCarbo"));
    assert.equal(o.quality.passed, true);
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
