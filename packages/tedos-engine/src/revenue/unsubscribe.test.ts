// Opt-out tests: token/URL, click-unsubscribe, reply-unsubscribe, send-blocking,
// and opt-out reporting.

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { type EmailProvider, type OutboundEmail, type SendResult } from "./sending.js";
import {
  approveLeads, loadLeadStatus, unsubscribeToken, unsubscribeUrl,
  unsubscribeLead, isUnsubscribed, replyRequestsUnsubscribe, processReply,
  sendApprovedBatch,
} from "./batch-send.js";
import { lifecycleCounts, optOutReport } from "./reporting.js";

const clock = () => "2026-07-05T09:00:00.000Z";
const acct = (id: string): Account =>
  normalize({ id, name: `Co ${id}`, industry: "Automotive", email: `${id}@example.com`, prio: "A", score: 80, catena_x_relevance: "high" }, 0);

function spyProvider(): { provider: EmailProvider; seen: OutboundEmail[] } {
  const seen: OutboundEmail[] = [];
  const provider: EmailProvider = {
    name: "smtp", label: "spy", isConfigured: () => true,
    async send(e: OutboundEmail): Promise<SendResult> { seen.push(e); return { provider: "smtp", status: "sent", ok: true, messageId: `<m${seen.length}@t>` }; },
  };
  return { provider, seen };
}

let saved: string | undefined;
beforeEach(() => { saved = process.env.REVENUE_SEND_ENABLED; delete process.env.REVENUE_SEND_ENABLED; });
afterEach(() => { if (saved === undefined) delete process.env.REVENUE_SEND_ENABLED; else process.env.REVENUE_SEND_ENABLED = saved; });

describe("opt-out: token + url", () => {
  test("token is deterministic per lead", () => {
    assert.equal(unsubscribeToken("acct-1"), unsubscribeToken("acct-1"));
    assert.notEqual(unsubscribeToken("acct-1"), unsubscribeToken("acct-2"));
  });
  test("url is absolute and ends with the token", () => {
    const u = unsubscribeUrl("acct-1");
    assert.equal(u.startsWith("http"), true);
    assert.equal(u.endsWith(unsubscribeToken("acct-1")), true);
  });
});

describe("opt-out: click unsubscribe", () => {
  test("unsubscribeLead by id sets status + timestamp + reason", () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["acct-1"]);
    const id = unsubscribeLead(s, "acct-1", "Opt-out", clock);
    assert.equal(id, "acct-1");
    const rec = loadLeadStatus(s)["acct-1"];
    assert.equal(rec?.status, "unsubscribed");
    assert.equal(rec?.unsubscribed_at, clock());
    assert.equal(rec?.unsubscribe_reason, "Opt-out");
    assert.equal(isUnsubscribed(s, "acct-1"), true);
  });
  test("unsubscribeLead resolves a token to the lead", () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["acct-7"]);
    const id = unsubscribeLead(s, unsubscribeToken("acct-7"), "Opt-out", clock);
    assert.equal(id, "acct-7");
    assert.equal(isUnsubscribed(s, "acct-7"), true);
  });
  test("unknown id/token returns null", () => {
    const s = new InMemoryStorage();
    assert.equal(unsubscribeLead(s, "nope", "Opt-out", clock), null);
  });
});

describe("opt-out: reply detection", () => {
  for (const w of ["Abmelden", "unsubscribe", "STOP", "Keine E-Mails bitte", "please remove me"]) {
    test(`"${w}" triggers unsubscribe`, () => assert.equal(replyRequestsUnsubscribe(w), true));
  }
  test("a normal reply does not", () => assert.equal(replyRequestsUnsubscribe("Klingt spannend, gern Montag?"), false));
  test("processReply opts out on 'Abmelden', else marks replied", () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["a", "b"]);
    assert.equal(processReply(s, "a", "Bitte abmelden", clock), "unsubscribed");
    assert.equal(processReply(s, "b", "Interesse, Termin?", clock), "replied");
    assert.equal(isUnsubscribed(s, "a"), true);
  });
});

describe("opt-out: sending is blocked", () => {
  test("an unsubscribed lead is never dispatched", async () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["acct-1"]);
    unsubscribeLead(s, "acct-1", "Opt-out", clock);
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage: s, accounts: [acct("acct-1")], provider, batchNumber: 1, clock });
    assert.equal(r.attempted, 0);
    assert.equal(seen.length, 0);
  });
  test("mixed batch sends only the non-unsubscribed lead", async () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["acct-1", "acct-2"]);
    unsubscribeLead(s, "acct-1", "Opt-out", clock);
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage: s, accounts: [acct("acct-1"), acct("acct-2")], provider, batchNumber: 1, clock });
    assert.equal(r.sent, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.to, "acct-2@example.com");
  });
});

describe("opt-out: reporting", () => {
  test("counts opt-outs overall + per campaign/industry/variant", async () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["acct-1", "acct-2"]);
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider } = spyProvider();
    await sendApprovedBatch({ storage: s, accounts: [acct("acct-1"), acct("acct-2")], provider, batchNumber: 1, variant: "E", clock });
    // one of them opts out afterwards
    unsubscribeLead(s, "acct-1", "Opt-out", clock);

    const rep = optOutReport(s);
    assert.equal(rep.contacted, 2);
    assert.equal(rep.unsubscribed, 1);
    assert.equal(rep.optOutRate, 50);
    assert.equal(rep.byVariant["E"], 1);
    assert.equal(Object.values(rep.byCampaign).reduce((a, b) => a + b, 0), 1);
    assert.equal(rep.byIndustry["Automotive"], 1);

    const life = lifecycleCounts(s);
    assert.equal(life.unsubscribed, 1);
    assert.equal(life.sent, 1); // the other lead stays "sent"
  });
});
