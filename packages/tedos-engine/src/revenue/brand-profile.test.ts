// Brand-profile tests. Deterministic, offline — no AI, no kernel involvement.
//
// Verifies the Revenue Engine can select a product profile (REVENUE_BRAND /
// TEDOS_PROJECT) while defaulting to HeyCarbo, and that the HeyCarbo profile
// reproduces the exact copy/data values previously hardcoded in revenue-engine.ts
// and accounts.ts (extraction fidelity — guards against silent copy drift).

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { activeBrandProfile, brandProfile, registerBrand, type BrandProfile } from "./brand-profile.js";
import type { Account } from "./accounts.js";

// Hermetic: a stray env selection must not skew default-selection.
delete process.env.REVENUE_BRAND;
delete process.env.TEDOS_PROJECT;

/** Minimal real-shaped account fixture (only the fields the copy templates read). */
function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "HC1", company: "GRAFE GmbH", industry: "Automotive / Mobility",
    painPoints: [], certifications: [], customers: [],
    prio: "A", fitScore: 89, revenueScore: 60, buyingIntent: 80, priority: 75,
    ...overrides,
  };
}

describe("brand-profile: selection", () => {
  const saved = { brand: process.env.REVENUE_BRAND, project: process.env.TEDOS_PROJECT };
  afterEach(() => {
    if (saved.brand === undefined) delete process.env.REVENUE_BRAND; else process.env.REVENUE_BRAND = saved.brand;
    if (saved.project === undefined) delete process.env.TEDOS_PROJECT; else process.env.TEDOS_PROJECT = saved.project;
  });

  test("defaults to HeyCarbo when nothing is selected", () => {
    delete process.env.REVENUE_BRAND;
    delete process.env.TEDOS_PROJECT;
    assert.equal(activeBrandProfile().key, "heycarbo");
    assert.equal(activeBrandProfile().productName, "HeyCarbo");
  });

  test("brandProfile is case-insensitive and falls back to HeyCarbo (never throws)", () => {
    assert.equal(brandProfile("HEYCARBO").key, "heycarbo");
    assert.equal(brandProfile(undefined).key, "heycarbo");
    assert.equal(brandProfile("does-not-exist").key, "heycarbo");
  });

  test("REVENUE_BRAND selects a registered profile; unknown falls back", () => {
    const body = { A: "v", B: "v", C: "v", D: "v", E: "v" } as const;
    const acme: BrandProfile = {
      key: "acme", productName: "Acme",
      identity: {
        senderName: "A", senderEmail: "a@acme.test", bcc: "a@acme.test", websiteUrl: "https://acme.test",
        emailTitle: "Acme", bannerAlt: "Acme — X", unsubscribeSecret: "acme-unsub",
      },
      urls: {
        trialUrl: "https://acme.test/trial", calendlyUrl: "https://cal/acme",
        imprintUrl: "https://acme.test/impressum", privacyUrl: "https://acme.test/datenschutz",
        unsubscribeBase: "https://acme.test/abmelden",
      },
      assets: { hostedAssetBase: "https://cdn/acme", signaturePaths: [], fallbackSignatureHtml: "<i>Acme</i>" },
      footer: { relevanceSentence: "Sie erhalten diese E-Mail, weil ..." },
      data: { painField: "acme_pain_points", dataPath: "../acme/leads.js" },
      copy: {
        subjects: () => ["s1", "s2", "s3"], previewText: "p", linkedin: () => "l",
        followUp1: () => "f1", followUp2: () => "f2", summaryLead: "Warum Acme passt",
        painFallback: () => "pain", ctaText: "Jetzt testen", queueSubjectFallback: (c) => `${c}: X`,
        intro: (a) => `Acme ${a.company}`, germanizePain: (r) => r,
        emailBody: { value: body, closing: body }, selectCampaign: () => "acme-campaign",
      },
    };
    registerBrand(acme);
    process.env.REVENUE_BRAND = "acme";
    assert.equal(activeBrandProfile().key, "acme");
    process.env.REVENUE_BRAND = "nope";
    assert.equal(activeBrandProfile().key, "heycarbo");
  });

  test("TEDOS_PROJECT is honoured when REVENUE_BRAND is unset", () => {
    delete process.env.REVENUE_BRAND;
    process.env.TEDOS_PROJECT = "heycarbo";
    assert.equal(activeBrandProfile().key, "heycarbo");
  });
});

describe("brand-profile: HeyCarbo extraction fidelity", () => {
  const hc = brandProfile("heycarbo");

  test("data model matches the previously hardcoded values", () => {
    assert.equal(hc.data.painField, "heycarbo_pain_points");
    assert.match(hc.data.dataPath, /Sales\/crm-heycarbo\/leads\.js$/);
  });

  test("subjects reproduce the exact three hardcoded templates", () => {
    assert.deepEqual(hc.copy.subjects(account()), [
      "GRAFE GmbH: CO₂-Bilanz & PCF in Minuten",
      "Automotive / Mobility & Scope 3 — kurze Frage",
      "PCF-Daten für GRAFE GmbH?",
    ]);
  });

  test("summary lead + CTA + follow-ups match the hardcoded copy", () => {
    assert.equal(hc.copy.summaryLead, "Warum HeyCarbo passt");
    assert.equal(hc.copy.ctaText, "14 Tage kostenlos testen");
    assert.match(hc.copy.followUp1(account()), /HeyCarbo den Aufwand senkt/);
    assert.match(hc.copy.followUp2(account(), { campaign: "csrd", calendlyUrl: "https://cal/x" }), /csrd-Themen.*https:\/\/cal\/x/);
    assert.equal(hc.copy.queueSubjectFallback("GRAFE GmbH"), "GRAFE GmbH: CO₂-Daten");
  });
});

describe("brand-profile: HeyAudit profile", () => {
  const ha = brandProfile("heyaudit");

  test("is registered with HeyAudit identity + data source", () => {
    assert.equal(ha.key, "heyaudit");
    assert.equal(ha.productName, "HeyAudit");
    assert.equal(ha.identity.senderEmail, "ted@heyaudit.de");
    assert.equal(ha.identity.bcc, "ted@heyaudit.de");
    assert.equal(ha.data.painField, "heyaudit_pain_points");
    assert.match(ha.data.dataPath, /Sales\/crm-heyaudit\/leads\.js$/);
  });

  test("copy is audit-focused and personalized (no carbon vocabulary)", () => {
    const a = account({ company: "Securitas GmbH", industry: "Sicherheitsdienst", employees: 20000, painPoints: ["120 Standorte mit mobilen Teams"] });
    assert.match(ha.copy.subjects(a)[0] ?? "", /Prüfungen & Checklisten/);
    assert.match(ha.copy.summaryLead, /HeyAudit/);
    const intro = ha.copy.intro(a);
    assert.ok(intro.includes("Securitas GmbH"), "intro names the real company");
    assert.doesNotMatch(intro, /CO₂|Scope|PCF/i, "no carbon vocabulary");
    assert.equal(ha.copy.selectCampaign(a), "arbeitssicherheit");
  });
});
