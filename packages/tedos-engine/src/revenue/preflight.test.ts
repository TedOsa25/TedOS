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
import { approveLeads, unsubscribeLead, selectSendable, loadLeadStatus, markBounced, type LeadRecord } from "./batch-send.js";
import { runPreflight, urlChecks, brandSendUrls, evaluateDnsRecords, recipientMxCheck, type UrlFetcher } from "./preflight.js";

const clock = () => "2026-07-07T09:00:00.000Z";

/** Simulate "this lead went out in an earlier batch" without running a send. */
function markSent(storage: InMemoryStorage, id: string): void {
  const map = storage.load<Record<string, LeadRecord>>("revenue-lead-status") ?? {};
  map[id] = { status: "sent", sent_at: "2026-07-01T00:00:00.000Z" };
  storage.save("revenue-lead-status", map);
}

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

  test("never re-mails an address an earlier batch already reached", () => {
    // Same company sits in the CRM twice under one info@ address — the classic
    // cause of a double approach: "a" was sent in batch 1, "b" is approved now.
    const accounts = [
      acct("a", "info@same.de", 0),
      acct("b", "INFO@same.de", 1),
      acct("c", "fresh@x.com", 2),
    ];
    const storage = new InMemoryStorage();
    approveLeads(storage, ["b", "c"]);
    markSent(storage, "a");

    const sel = selectSendable(accounts, loadLeadStatus(storage), 20);
    assert.equal(sel.approved, 2);
    assert.equal(sel.contactedDropped, 1);                       // b blocked by a
    assert.deepEqual(sel.batch.map((x) => x.id), ["c"]);
  });

  test("bounced and unsubscribed addresses stay blocked across ids", () => {
    const accounts = [
      acct("a", "hard@bounce.de", 0),
      acct("b", "hard@bounce.de", 1),
      acct("c", "gone@optout.de", 2),
      acct("d", "gone@optout.de", 3),
    ];
    const storage = new InMemoryStorage();
    approveLeads(storage, ["a", "b", "c", "d"]); // seed records first
    markBounced(storage, ["a"], "2026-08-01T00:00:00.000Z");
    unsubscribeLead(storage, "c", "reply");

    const sel = selectSendable(accounts, loadLeadStatus(storage), 20);
    assert.equal(sel.contactedDropped, 2);
    assert.equal(sel.batch.length, 0);
  });

  test("markBounced never downgrades an opt-out", () => {
    const storage = new InMemoryStorage();
    approveLeads(storage, ["x"]); // seed the record so the opt-out can attach
    unsubscribeLead(storage, "x", "reply");
    const changed = markBounced(storage, ["x"], "2026-08-01T00:00:00.000Z");
    assert.equal(changed, 0);
    assert.equal(loadLeadStatus(storage)["x"]?.status, "unsubscribed");
  });
});

describe("evaluateDnsRecords", () => {
  const dkim = '"v=DKIM1; p=MIIBIjANBgkq"';
  const dmarc = '"v=DMARC1; p=none; rua=mailto:ted@heycarbo.com"';
  const args = (spf: string) => ({ domain: "heycarbo.com", spf, dkim, dmarc, selector: "s1-ionos" });
  const find = (cs: ReturnType<typeof evaluateDnsRecords>, id: string) => cs.find((c) => c.id === id)!;

  test("shows the SPF policy, not an unrelated TXT record", () => {
    // Real record set: the site-verification string sorts first in DNS.
    const spf = '"google-site-verification=IwOf2VSQ9frg44Cx"\n"v=spf1 include:_spf-eu.ionos.com ~all"';
    const spfCheck = find(evaluateDnsRecords(args(spf)), "dns-spf");
    assert.equal(spfCheck.ok, true);
    assert.match(spfCheck.detail, /v=spf1 include:_spf-eu\.ionos\.com/);
    assert.doesNotMatch(spfCheck.detail, /google-site-verification/);
  });

  test("two SPF records fail the gate (RFC 7208 → PERMERROR)", () => {
    const spf = '"v=spf1 include:_spf-eu.ionos.com ~all"\n"v=spf1 include:sendgrid.net ~all"';
    const spfCheck = find(evaluateDnsRecords(args(spf)), "dns-spf");
    assert.equal(spfCheck.ok, false);
    assert.equal(spfCheck.blocking, true);
    assert.match(spfCheck.detail, /2 SPF-Records/);
  });

  test("a missing SPF record fails with a clear reason", () => {
    const spfCheck = find(evaluateDnsRecords(args('"google-site-verification=x"')), "dns-spf");
    assert.equal(spfCheck.ok, false);
    assert.match(spfCheck.detail, /kein SPF-Record/);
  });

  test("DMARC detail is the DMARC record even when other TXT lines exist", () => {
    const cs = evaluateDnsRecords({ ...args('"v=spf1 ~all"'), dmarc: '"something-else"\n"v=DMARC1; p=quarantine"' });
    assert.equal(find(cs, "dns-dmarc").ok, true);
    assert.match(find(cs, "dns-dmarc").detail, /v=DMARC1; p=quarantine/);
  });
});

describe("recipientMxCheck", () => {
  const resolver = (map: Record<string, string[]>) => async (d: string) => {
    if (!(d in map)) throw new Error("NXDOMAIN");
    return map[d] as string[];
  };

  test("passes when every recipient domain accepts mail", async () => {
    const c = await recipientMxCheck(
      ["info@a.de", "kontakt@a.de", "info@b.com"],
      resolver({ "a.de": ["mx.a.de"], "b.com": ["mx.b.com"] }),
    );
    assert.equal(c.ok, true);
    assert.match(c.detail, /2 Domains geprüft/);
  });

  test("names recipients on a domain without MX, without blocking the batch", async () => {
    const c = await recipientMxCheck(
      ["info@good.de", "info@nomx.de"],
      resolver({ "good.de": ["mx.good.de"], "nomx.de": [] }),
    );
    assert.equal(c.ok, false);
    assert.equal(c.blocking, false); // 19 good addresses must still go out
    assert.match(c.detail, /info@nomx\.de/);
  });

  test("an unresolvable domain counts as undeliverable", async () => {
    const c = await recipientMxCheck(["info@gone.de"], resolver({}));
    assert.equal(c.ok, false);
    assert.match(c.detail, /info@gone\.de/);
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
