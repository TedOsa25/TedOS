// Hardened approval-filter tests: domain-match rejects foreign addresses,
// personalization tiebreaker, and the full selection with all exclusions.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { loadLeadStatus, approveLeads } from "./batch-send.js";
import { selectForApproval, domainMatches, isPersonalized } from "./approve-select.js";

function acct(id: string, company: string, email: string, website: string | undefined, i: number): Account {
  return normalize({ id, name: company, industry: "Maschinenbau", email, ...(website ? { website } : {}), prio: "A", score: 65 }, i);
}

describe("domainMatches", () => {
  test("matches company website domain (and sub-domains)", () => {
    assert.equal(domainMatches("service@lewa.de", "https://www.lewa.de", "LEWA"), true);
    assert.equal(domainMatches("info@ch.kasto.com", "kasto.com", "Kasto"), true);
  });
  test("rejects foreign third-party domains (the bounce cause)", () => {
    assert.equal(domainMatches("info@joppnet.de", "https://www.kapp-niles.com", "Kapp Niles"), false);
    assert.equal(domainMatches("info@business4you.ch", "daetwyler.com", "MDC Max Daetwyler"), false);
  });
  test("falls back to a company-name token when no website is on file", () => {
    assert.equal(domainMatches("info@niehoff.de", undefined, "Maschinenfabrik Niehoff"), true);
    assert.equal(domainMatches("info@randomhost.xyz", undefined, "Maschinenfabrik Niehoff"), false);
  });
});

describe("isPersonalized", () => {
  test("role mailboxes are not personalized", () => {
    assert.equal(isPersonalized("info@x.de"), false);
    assert.equal(isPersonalized("kontakt@x.de"), false);
  });
  test("named local parts are personalized", () => {
    assert.equal(isPersonalized("t.mueller@x.de"), true);
    assert.equal(isPersonalized("anna.schmidt@x.de"), true);
  });
});

describe("selectForApproval", () => {
  test("excludes foreign-domain, missing-address, duplicate and already-sent leads", () => {
    const accounts = [
      acct("a", "LEWA", "service@lewa.de", "lewa.de", 0),
      acct("b", "Kapp Niles", "info@joppnet.de", "kapp-niles.com", 1), // foreign domain → rejected
      acct("c", "Niehoff", "info@niehoff.de", "niehoff.de", 2),
      acct("d", "DupCo", "service@lewa.de", "lewa.de", 3),               // duplicate address
      acct("e", "NoMail", "", undefined, 4),                             // no address
    ];
    const storage = new InMemoryStorage();
    const sel = selectForApproval(accounts, loadLeadStatus(storage), 10);
    const picked = sel.pick.map((a) => a.company).sort();
    assert.deepEqual(picked, ["LEWA", "Niehoff"]);
    assert.equal(sel.rejected.domainMismatch, 1);
    assert.equal(sel.rejected.duplicate, 1);
    assert.equal(sel.rejected.noEmail, 1);
  });

  test("skips leads already approved/sent", () => {
    const accounts = [acct("a", "LEWA", "service@lewa.de", "lewa.de", 0), acct("c", "Niehoff", "info@niehoff.de", "niehoff.de", 1)];
    const storage = new InMemoryStorage();
    approveLeads(storage, ["a"]);
    const sel = selectForApproval(accounts, loadLeadStatus(storage), 10);
    assert.deepEqual(sel.pick.map((a) => a.id), ["c"]);
    assert.equal(sel.rejected.status, 1);
  });

  test("prefers personalized addresses within the same fit tier", () => {
    const accounts = [
      acct("role", "RoleCo", "info@roleco.de", "roleco.de", 0),
      acct("pers", "PersCo", "max.mustermann@persco.de", "persco.de", 1),
    ];
    const storage = new InMemoryStorage();
    const sel = selectForApproval(accounts, loadLeadStatus(storage), 1);
    assert.equal(sel.pick[0]?.id, "pers"); // personalized wins the tiebreak
  });
});
