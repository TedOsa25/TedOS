// Preflight-gate tests. Network checks (SMTP + DNS) are skipped via skipNetwork;
// these pin the deterministic eligibility contract: approved-only, opt-out
// exclusion, duplicate-recipient exclusion, address requirement, and the pass/
// fail gate. Report files go to a throwaway dir so the repo stays clean.

import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { approveLeads, unsubscribeLead, selectSendable, loadLeadStatus } from "./batch-send.js";
import { runPreflight, urlChecks, brandSendUrls, type UrlFetcher } from "./preflight.js";

const clock = () => "2026-07-07T09:00:00.000Z";

/** Accounts with explicit emails so we can craft dupes / missing addresses. */
function acct(id: string, email: string | undefined, i: number): Account {
  return normalize({ id, name: `Co ${id}`, industry: "Automotive", ...(email ? { email } : {}), prio: "A", score: 80 }, i);
}

let reportsDir: string;
let savedDir: string | undefined;
before(() => {
  savedDir = process.env.REVENUE_REPORTS_DIR;
  reportsDir = mkdtempSync(join(tmpdir(), "revenue-reports-"));
  process.env.REVENUE_REPORTS_DIR = reportsDir;
});
after(() => {
  if (savedDir === undefined) delete process.env.REVENUE_REPORTS_DIR; else process.env.REVENUE_REPORTS_DIR = savedDir;
  rmSync(reportsDir, { recursive: true, force: true });
});

const base = {
  batchSize: 20,
  senderEmail: "ted@heycarbo.com",
  provider: "smtp",
  armed: false,
  skipNetwork: true,
  clock,
};

describe("selectSendable", () => {
  test("dedupes by address, drops missing addresses, caps to limit", () => {
    const accounts = [
      acct("a", "one@x.com", 0),
      acct("b", "ONE@x.com", 1), // duplicate (case-insensitive)
      acct("c", "two@x.com", 2),
      acct("d", undefined, 3),   // no address
      acct("e", "three@x.com", 4),
    ];
    const storage = new InMemoryStorage();
    approveLeads(storage, ["a", "b", "c", "d", "e"]);
    const sel = selectSendable(accounts, loadLeadStatus(storage), 2);
    assert.equal(sel.approved, 5);
    assert.equal(sel.withEmail, 4);      // d dropped (no address)
    assert.equal(sel.noEmailDropped, 1);
    assert.equal(sel.dupDropped, 1);     // b dropped (dup of a)
    assert.equal(sel.afterDedupe, 3);    // one,two,three
    assert.equal(sel.batch.length, 2);   // capped
  });
});

describe("runPreflight (network skipped)", () => {
  test("passes when there is at least one clean approved lead", async () => {
    const storage = new InMemoryStorage();
    const accounts = [acct("a", "one@x.com", 0), acct("b", "two@x.com", 1)];
    approveLeads(storage, ["a", "b"]);
    const pf = await runPreflight({ ...base, storage, accounts });
    assert.equal(pf.ok, true);
    assert.equal(pf.eligibility.toSend, 2);
    // every blocking check must be green
    assert.ok(pf.checks.filter((c) => c.blocking).every((c) => c.ok));
  });

  test("fails the gate when nothing is approved", async () => {
    const storage = new InMemoryStorage();
    const accounts = [acct("a", "one@x.com", 0)];
    const pf = await runPreflight({ ...base, storage, accounts });
    assert.equal(pf.ok, false);
    const approvedCheck = pf.checks.find((c) => c.id === "approved-only");
    assert.equal(approvedCheck?.ok, false);
  });

  test("excludes opted-out leads from the sendable set", async () => {
    const storage = new InMemoryStorage();
    const accounts = [acct("a", "one@x.com", 0), acct("b", "two@x.com", 1)];
    approveLeads(storage, ["a", "b"]);
    unsubscribeLead(storage, "b", "test opt-out");
    const pf = await runPreflight({ ...base, storage, accounts });
    assert.equal(pf.eligibility.toSend, 1);      // only "a"
    assert.equal(pf.eligibility.blockedUnsub, 1);
  });

  test("report stem is derived from the campaign label + timestamp", async () => {
    const storage = new InMemoryStorage();
    const accounts = [acct("a", "one@x.com", 0)];
    approveLeads(storage, ["a"]);
    const pf = await runPreflight({ ...base, storage, accounts, campaignLabel: "Pilot Batch 04" });
    assert.match(pf.reportStem, /pilot-batch-04$/);
  });
});

describe("urlChecks: only HTTP 200 is accepted", () => {
  const items = [
    { label: "signup", url: "https://x/signup" },
    { label: "impressum", url: "https://x/impressum" },
    { label: "datenschutz", url: "https://x/datenschutz" },
    { label: "abmelden", url: "https://x/abmelden" },
  ];

  test("a 200 passes, a non-200 fails", async () => {
    const stub: UrlFetcher = (u) => Promise.resolve({ status: u.endsWith("impressum") ? 404 : 200 });
    const checks = await urlChecks(items, stub);
    assert.equal(checks.find((c) => c.id === "url-signup")?.ok, true);
    const imp = checks.find((c) => c.id === "url-impressum");
    assert.equal(imp?.ok, false);
    assert.match(imp?.detail ?? "", /HTTP 404/);
    assert.ok(checks.every((c) => c.blocking), "URL checks are blocking");
  });

  test("a redirect landing on 301 is rejected (only FINAL 200)", async () => {
    const checks = await urlChecks([items[0]!], () => Promise.resolve({ status: 301 }));
    assert.equal(checks[0]?.ok, false);
  });

  test("a network error fails the check (not throws)", async () => {
    const checks = await urlChecks([items[3]!], () => Promise.reject(new Error("ENOTFOUND")));
    assert.equal(checks[0]?.ok, false);
    assert.match(checks[0]?.detail ?? "", /nicht erreichbar/);
  });

  test("brandSendUrls covers the four required landing pages for the active brand", () => {
    const labels = brandSendUrls().map((u) => u.label).sort();
    assert.deepEqual(labels, ["abmelden", "datenschutz", "impressum", "signup"]);
  });
});
