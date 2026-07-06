// Approval-server tests: the UI endpoints write to the SAME store sendApprovedBatch
// reads, so only Approved leads are ever sent. Localhost, no real send.

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { type EmailProvider, type OutboundEmail, type SendResult } from "./sending.js";
import { createApprovalServer } from "./approval-server.js";
import { approveLeads, loadLeadStatus, unsubscribeLead, sendApprovedBatch } from "./batch-send.js";

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

async function withServer(storage: InMemoryStorage, accounts: Account[], fn: (base: string) => Promise<void>): Promise<void> {
  const server = createApprovalServer({ storage, accounts });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise<void>((r) => server.close(() => r())); }
}

const action = (base: string, act: string, ids: string[]) =>
  fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: act, ids }) }).then((r) => r.json());

let saved: string | undefined;
beforeEach(() => { saved = process.env.REVENUE_SEND_ENABLED; delete process.env.REVENUE_SEND_ENABLED; });
afterEach(() => { if (saved === undefined) delete process.env.REVENUE_SEND_ENABLED; else process.env.REVENUE_SEND_ENABLED = saved; });

describe("approval UI: page", () => {
  test("GET / renders columns, bulk actions, KPIs, search, filter, sort", async () => {
    const s = new InMemoryStorage();
    await withServer(s, [acct("a1")], async (base) => {
      const html = await fetch(base).then((r) => r.text());
      for (const col of ["Firma", "Ansprechpartner", "E-Mail", "Branche", "Prio", "Betreff", "Vorschau"]) assert.match(html, new RegExp(col));
      for (const b of ["Approve All Visible", "Approve Top 10", "Approve Top 20", "Approve Selected"]) assert.match(html, new RegExp(b));
      for (const kpi of ["Pending", "Approved", "Sent", "Replies", "Bounces", "Demos", "Won", "Unsubscribed"]) assert.match(html, new RegExp(kpi));
      assert.match(html, /id="q"/);          // search field
      assert.match(html, /id="fStatus"/);    // status filter
      assert.match(html, /id="fSort"/);      // sort
      assert.doesNotMatch(html, /localStorage/); // no localStorage logic
    });
  });
});

describe("approval UI: actions write to the send store", () => {
  test("Approve sets status 'approved'", async () => {
    const s = new InMemoryStorage();
    await withServer(s, [acct("a1")], async (base) => {
      const j = await action(base, "approve", ["a1"]);
      assert.equal(j.ok, true);
      assert.equal(loadLeadStatus(s)["a1"]?.status, "approved");
    });
  });

  test("Reject sets status 'lost'; Skip sets 'pending'", async () => {
    const s = new InMemoryStorage();
    await withServer(s, [acct("a1"), acct("a2")], async (base) => {
      await action(base, "reject", ["a1"]);
      await action(base, "skip", ["a2"]);
      assert.equal(loadLeadStatus(s)["a1"]?.status, "lost");
      assert.equal(loadLeadStatus(s)["a2"]?.status, "pending");
    });
  });

  test("an unsubscribed lead cannot be re-approved via the UI", async () => {
    const s = new InMemoryStorage();
    approveLeads(s, ["a1"]);                 // lead exists in the store…
    unsubscribeLead(s, "a1", "Opt-out", clock); // …then opts out
    await withServer(s, [acct("a1")], async (base) => {
      await action(base, "approve", ["a1"]);
      assert.equal(loadLeadStatus(s)["a1"]?.status, "unsubscribed");
    });
  });
});

describe("approval UI: only approved leads are sent", () => {
  test("approve a1, reject a2 → sendApprovedBatch sends only a1", async () => {
    const s = new InMemoryStorage();
    const accounts = [acct("a1"), acct("a2")];
    await withServer(s, accounts, async (base) => {
      await action(base, "approve", ["a1"]);
      await action(base, "reject", ["a2"]);
    });
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage: s, accounts, provider, batchNumber: 1, clock });
    assert.equal(r.sent, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.to, "a1@example.com");
  });
});
