// Tests for the two deliverability/compliance parts a productive batch must
// carry: the List-Unsubscribe header pair (RFC 2369 / RFC 8058) and the
// plain-text alternative of the HTML body.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { listUnsubscribeHeaders } from "./batch-send.js";
import { renderEmailText, unsubscribeUrl, EMAIL_ASSETS } from "./email-template.js";
import { activeBrandProfile } from "./brand-profile.js";
import { normalize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";

const parts = {
  greeting: "Guten Tag,",
  intro: "Intro über Musterfirma.",
  value: "Value.",
  closing: "Closing.",
  ctaText: "14 Tage kostenlos testen",
  ctaUrl: "https://heycarbo.com/signup",
};

describe("List-Unsubscribe headers", () => {
  test("emits a one-click https target AND the mailto fallback", () => {
    const url = unsubscribeUrl("HC001");
    const h = listUnsubscribeHeaders(url);
    const token = url.split("/").pop() as string;

    assert.match(h["List-Unsubscribe"] as string, /^<https:\/\/.+>, <mailto:.+>$/);
    assert.ok((h["List-Unsubscribe"] as string).includes(`token=${token}`),
      "the one-click target must carry THIS lead's token");
    assert.equal(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });

  test("each lead gets its own token in the header", () => {
    const a = listUnsubscribeHeaders(unsubscribeUrl("HC001"))["List-Unsubscribe"] as string;
    const b = listUnsubscribeHeaders(unsubscribeUrl("HC002"))["List-Unsubscribe"] as string;
    assert.notEqual(a, b);
  });

  test("without a token it degrades to mailto-only — never a broken one-click", () => {
    const h = listUnsubscribeHeaders(undefined);
    assert.match(h["List-Unsubscribe"] as string, /^<mailto:/);
    assert.equal(h["List-Unsubscribe-Post"], undefined,
      "announcing one-click without a POST target is worse than not offering it");
  });

  test("the mailto fallback targets the real sender address", () => {
    const h = listUnsubscribeHeaders(unsubscribeUrl("HC001"));
    assert.ok((h["List-Unsubscribe"] as string).includes(activeBrandProfile().identity.senderEmail));
  });
});

describe("plain-text alternative", () => {
  test("carries the copy, both CTAs and the legal links", () => {
    const t = renderEmailText({ ...parts, unsubscribeUrl: unsubscribeUrl("HC001") });
    assert.match(t, /Guten Tag,/);
    assert.match(t, /Intro über Musterfirma\./);
    assert.match(t, /Value\./);
    assert.match(t, /Closing\./);
    assert.ok(t.includes(parts.ctaUrl), "primary CTA url missing");
    assert.ok(t.includes(EMAIL_ASSETS.calendlyUrl), "secondary demo link missing");
    assert.ok(t.includes(EMAIL_ASSETS.imprintUrl), "Impressum missing");
    assert.ok(t.includes(EMAIL_ASSETS.privacyUrl), "Datenschutz missing");
  });

  test("embeds THIS lead's unsubscribe url — the opt-out must work in text too", () => {
    const url = unsubscribeUrl("HC042");
    assert.ok(renderEmailText({ ...parts, unsubscribeUrl: url }).includes(url));
  });

  test("contains no HTML tags", () => {
    const t = renderEmailText({ ...parts, unsubscribeUrl: unsubscribeUrl("HC001") });
    assert.doesNotMatch(t, /<[a-z/][^>]*>/i);
  });

  test("buildOpportunity produces a non-empty text part alongside the HTML", () => {
    const a = normalize({
      id: "HC900", name: "Musterfirma GmbH", industry: "Metall",
      email: "info@musterfirma.de", website: "https://www.musterfirma.de",
    } as never, 0);
    const opp = buildOpportunity(a, () => "2026-08-04T09:00:00.000Z", "E");
    assert.ok(opp.emailText.length > 100, "text part must be substantive");
    assert.ok(opp.emailText.includes(opp.unsubscribeUrl), "text part must carry the opt-out");
    assert.doesNotMatch(opp.emailText, /<[a-z/][^>]*>/i);
  });
});
