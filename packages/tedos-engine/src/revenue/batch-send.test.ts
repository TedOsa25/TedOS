// Batch-send tests. Every test runs with the master switch OFF (or dryRun), so
// no real email is ever dispatched. They pin the safety contract: disarmed →
// nothing sent, BCC only on batch 1, hard cap of 20, status transitions, and
// auto-disarm after the batch.

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { getProvider, type EmailProvider, type OutboundEmail, type SendResult } from "./sending.js";
import {
  sendApprovedBatch, approveLeads, loadLeadStatus,
  BCC_FIRST_BATCH, FIRST_BATCH_HARD_CAP,
} from "./batch-send.js";

const clock = () => "2026-07-05T09:00:00.000Z";

/** N synthetic accounts with real-shaped fields and a routable test address. */
function accounts(n: number): Account[] {
  return Array.from({ length: n }, (_, i) =>
    normalize({ id: `acct-${i + 1}`, name: `TestCo ${i + 1}`, industry: "Automotive", email: `lead${i + 1}@example.com`, prio: "A", score: 80, catena_x_relevance: "high" }, i),
  );
}

/** A spy provider that records every dispatched email and always "sends". */
function spyProvider(): { provider: EmailProvider; seen: OutboundEmail[] } {
  const seen: OutboundEmail[] = [];
  const provider: EmailProvider = {
    name: "smtp",
    label: "SMTP (spy)",
    isConfigured: () => true,
    async send(email: OutboundEmail): Promise<SendResult> {
      seen.push(email);
      return { provider: "smtp", status: "sent", ok: true, messageId: `<mid-${seen.length}@test>` };
    },
  };
  return { provider, seen };
}

let savedSwitch: string | undefined;
beforeEach(() => { savedSwitch = process.env.REVENUE_SEND_ENABLED; delete process.env.REVENUE_SEND_ENABLED; });
afterEach(() => { if (savedSwitch === undefined) delete process.env.REVENUE_SEND_ENABLED; else process.env.REVENUE_SEND_ENABLED = savedSwitch; });

describe("batch-send: disarmed by default", () => {
  test("with the master switch OFF, nothing is sent (all skipped)", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1", "acct-2", "acct-3"]);
    const r = await sendApprovedBatch({ storage, accounts: accounts(3), clock });
    assert.equal(r.armed, false);
    assert.equal(r.sent, 0);
    assert.equal(r.smtpStatus.skipped + r.smtpStatus.queued, 3);
  });

  test("a fresh store has no approved leads → sends to nobody", async () => {
    const storage = new InMemoryStorage();
    const r = await sendApprovedBatch({ storage, accounts: accounts(5), clock });
    assert.equal(r.approvedAvailable, 0);
    assert.equal(r.attempted, 0);
  });

  test("dryRun dispatches nothing even against a live provider", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1"]);
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(1), provider, dryRun: true, clock });
    assert.equal(seen.length, 0);
    assert.equal(r.sent, 0);
    assert.equal(r.dryRun, true);
  });
});

describe("batch-send: BCC is batch-1 only", () => {
  test("batch 1 applies BCC to ted@heycarbo.com (blind), counted as bccCopies", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1", "acct-2"]);
    process.env.REVENUE_SEND_ENABLED = "1"; // arm so dispatch reaches the provider
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(2), provider, batchNumber: 1, clock });
    assert.equal(r.bccApplied, true);
    assert.equal(r.bccAddress, BCC_FIRST_BATCH);
    assert.equal(r.bccCopies, 2);
    assert.ok(seen.every((e) => e.bcc === BCC_FIRST_BATCH));
  });

  test("batch 2 carries no BCC by default", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1"]);
    process.env.REVENUE_SEND_ENABLED = "1"; // arm so dispatch reaches the provider
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(1), provider, batchNumber: 2, clock });
    assert.equal(r.bccApplied, false);
    assert.equal(r.bccCopies, 0);
    assert.ok(seen.every((e) => e.bcc === undefined));
  });

  test("explicit bcc applies at ANY batch (e.g. batch 2, size 50)", async () => {
    const storage = new InMemoryStorage();
    const ids = Array.from({ length: 3 }, (_, i) => `acct-${i + 1}`);
    approveLeads(storage, ids);
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(3), provider, batchNumber: 2, bcc: "ted@heycarbo.com", clock });
    assert.equal(r.bccApplied, true);
    assert.equal(r.bccAddress, "ted@heycarbo.com");
    assert.equal(r.bccCopies, 3);
    assert.ok(seen.every((e) => e.bcc === "ted@heycarbo.com"));
  });

  test("explicit bcc:'' disables BCC even on batch 1", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1"]);
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider, seen } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(1), provider, batchNumber: 1, bcc: "", clock });
    assert.equal(r.bccApplied, false);
    assert.ok(seen.every((e) => e.bcc === undefined));
  });
});

describe("batch-send: caps + status + disarm", () => {
  test("batch 1 never sends more than 20 even if 25 are approved", async () => {
    const storage = new InMemoryStorage();
    const ids = Array.from({ length: 25 }, (_, i) => `acct-${i + 1}`);
    approveLeads(storage, ids);
    process.env.REVENUE_SEND_ENABLED = "1"; // arm so dispatch reaches the provider
    const { provider } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(25), provider, batchSize: 25, batchNumber: 1, clock });
    assert.equal(r.attempted, FIRST_BATCH_HARD_CAP);
    assert.equal(r.sent, FIRST_BATCH_HARD_CAP);
  });

  test("sent leads flip approved → sent and record messageId + sent_at", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1"]);
    process.env.REVENUE_SEND_ENABLED = "1"; // arm so the send actually happens
    const { provider } = spyProvider();
    await sendApprovedBatch({ storage, accounts: accounts(1), provider, batchNumber: 1, clock });
    const rec = loadLeadStatus(storage)["acct-1"];
    assert.equal(rec?.status, "sent");
    assert.equal(rec?.sent_at, clock());
    assert.match(rec?.messageId ?? "", /mid-1/);
  });

  test("master switch is auto-disarmed after a real batch", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1"]);
    process.env.REVENUE_SEND_ENABLED = "1";
    const { provider } = spyProvider();
    const r = await sendApprovedBatch({ storage, accounts: accounts(1), provider, batchNumber: 1, clock });
    assert.equal(r.disarmed, true);
    assert.equal(process.env.REVENUE_SEND_ENABLED, "0");
  });

  test("a resend finds no approved leads (already sent) → attempts 0", async () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["acct-1"]);
    process.env.REVENUE_SEND_ENABLED = "1"; // arm the first send; auto-disarm follows
    const { provider } = spyProvider();
    await sendApprovedBatch({ storage, accounts: accounts(1), provider, batchNumber: 1, clock });
    const again = await sendApprovedBatch({ storage, accounts: accounts(1), provider, clock });
    assert.equal(again.attempted, 0);
  });
});
