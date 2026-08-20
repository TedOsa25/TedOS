// Hardened approval-filter tests: domain-match rejects foreign addresses,
// personalization tiebreaker, and the full selection with all exclusions.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStorage } from "./../storage.js";
import { normalize, type Account } from "./accounts.js";
import { loadLeadStatus, approveLeads } from "./batch-send.js";
import { selectForApproval, domainMatches, isPersonalized, istZustellbar } from "./approve-select.js";

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

describe("istZustellbar", () => {
  test("die angeklebte TLD aus dem Impressum wird erkannt", () => {
    // Alle vier lagen am 20.08.2026 im CRM, zwei als "belegt" markiert.
    assert.equal(istZustellbar("vertrieb@kroll.deinternet"), false);
    assert.equal(istZustellbar("info@tr-plast.deinternet"), false);
    assert.equal(istZustellbar("media@kuehne-nagel.combusiness"), false);
    assert.equal(istZustellbar("communications.supplychain@havi.comauthorized"), false);
  });

  test("lange, aber echte TLDs bleiben gültig", () => {
    assert.equal(istZustellbar("info@makler.immobilien"), true);
    assert.equal(istZustellbar("info@studio.photography"), true);
    assert.equal(istZustellbar("info@laden.berlin"), true);
    assert.equal(istZustellbar("info@firma.hamburg"), true);
  });

  test("gewöhnliche Adressen bleiben unangetastet", () => {
    assert.equal(istZustellbar("info@lewa.de"), true);
    assert.equal(istZustellbar("office@remus.at"), true);
    assert.equal(istZustellbar("info@ch.kasto.com"), true);
  });

  test("kaputte Grundformen fallen durch", () => {
    assert.equal(istZustellbar("keinklammeraffe.de"), false);
    assert.equal(istZustellbar("zwei@@at.de"), false);
    assert.equal(istZustellbar("info@ohnepunkt"), false);
    assert.equal(istZustellbar("info@firma..de"), false);
    assert.equal(istZustellbar("mit leer@firma.de"), false);
    assert.equal(istZustellbar("@firma.de"), false);
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

  /**
   * Die Obergrenze hing bis 20.08.2026 nur im Nachfass-Pfad. Beim Erstkontakt
   * lief ein Konzern ungebremst durch — getragen hat die Regel stattdessen der
   * Versandpool, indem er eine belegte Mitarbeiterzahl verlangte. Das war die
   * Regel an der falschen Stelle: es kostete 43 von 75 verbleibenden Leads und
   * hätte REEL ausgeschlossen, die einzige gebuchte Demo, die gar keine Zahl
   * hinterlegt hat.
   */
  test("über 2.000 Mitarbeitende bekommt keinen Erstkontakt", () => {
    const gross = normalize({ id: "gross", name: "Riesen AG", industry: "Maschinenbau", email: "info@riesen-ag.de", website: "riesen-ag.de", employees: 5000, prio: "A", score: 90 } as never, 0);
    const klein = normalize({ id: "klein", name: "Klein GmbH", industry: "Maschinenbau", email: "info@klein-gmbh.de", website: "klein-gmbh.de", employees: 51, prio: "A", score: 65 } as never, 1);
    const sel = selectForApproval([gross, klein], loadLeadStatus(new InMemoryStorage()), 10);
    assert.deepEqual(sel.pick.map((a) => a.id), ["klein"]);
    assert.equal(sel.rejected.zuGross, 1);
  });

  test("ohne hinterlegte Größe greift die Konzern-Domainliste", () => {
    // Schaeffler steht im CRM ohne Mitarbeiterzahl — genau der Fall, für den
    // grossunternehmen.ts existiert. Ohne diesen Zweig fuhr er beim
    // Erstkontakt mit.
    const konzern = normalize({ id: "k", name: "Schaeffler", industry: "Maschinenbau", email: "info@schaeffler.com", website: "schaeffler.com", prio: "A", score: 90 } as never, 0);
    const sel = selectForApproval([konzern], loadLeadStatus(new InMemoryStorage()), 10);
    assert.equal(sel.pick.length, 0);
    assert.equal(sel.rejected.zuGross, 1);
  });

  test("keine Untergrenze — Bcomp hat 51 Mitarbeitende und ist die beste Anfrage", () => {
    const winzig = normalize({ id: "w", name: "Winzig GmbH", industry: "Maschinenbau", email: "info@winzig-gmbh.de", website: "winzig-gmbh.de", employees: 12, prio: "A", score: 65 } as never, 0);
    const ohneZahl = normalize({ id: "o", name: "Ohnezahl GmbH", industry: "Maschinenbau", email: "info@ohnezahl-gmbh.de", website: "ohnezahl-gmbh.de", prio: "A", score: 65 } as never, 1);
    const sel = selectForApproval([winzig, ohneZahl], loadLeadStatus(new InMemoryStorage()), 10);
    assert.equal(sel.pick.length, 2, "weder eine kleine noch eine ungemessene Firma wird ausgeschlossen");
    assert.equal(sel.rejected.zuGross, 0);
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
