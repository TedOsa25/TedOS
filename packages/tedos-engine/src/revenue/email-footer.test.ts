// Legal-footer tests. The footer must be appended (not replace the layout),
// carry Impressum + Datenschutz + Abmelden links, and embed the per-lead
// unsubscribe URL. No relative image paths.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { legalFooter, renderEmail, unsubscribeUrl, EMAIL_ASSETS } from "./email-template.js";
import { normalize } from "./accounts.js";
import { buildOpportunity } from "./revenue-engine.js";

const parts = {
  greeting: "Guten Tag,", intro: "Intro.", value: "Value.", closing: "Closing.",
  ctaText: "14 Tage kostenlos testen", ctaUrl: "https://heycarbo.com/trial",
};

describe("legal footer: rendered + required links", () => {
  test("footer renders with the consent text", () => {
    const f = legalFooter();
    assert.match(f, /Sie erhalten diese E-Mail/);
    assert.match(f, /abmelden/i);
  });

  test("Impressum link present", () => {
    assert.match(legalFooter(), />Impressum</);
    assert.match(legalFooter(), new RegExp(EMAIL_ASSETS.imprintUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("Datenschutz link present", () => {
    assert.match(legalFooter(), />Datenschutzerklärung</);
    assert.match(legalFooter(), new RegExp(EMAIL_ASSETS.privacyUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("Abmelden link present", () => {
    assert.match(legalFooter(), />Abmelden</);
  });

  test("footer uses the spec styling (Inter, 12px, #6B7280, hairline #E5E7EB), no boxes/icons", () => {
    const f = legalFooter();
    assert.match(f, /Inter, Arial, sans-serif/);
    assert.match(f, /font-size:12px/);
    assert.match(f, /#6B7280/);
    assert.match(f, /border-top:1px solid #E5E7EB/);
    assert.doesNotMatch(f, /<img/); // no icons
  });

  test("unsubscribe_url is used verbatim when provided", () => {
    const url = "https://heycarbo.com/unsubscribe/abc123";
    assert.match(legalFooter({ unsubscribeUrl: url }), new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("legal footer: wired into the email + per-lead URL", () => {
  test("renderEmail appends the footer after the existing body", () => {
    const html = renderEmail({ ...parts, unsubscribeUrl: "https://heycarbo.com/unsubscribe/xyz" });
    assert.match(html, />Impressum</);
    assert.match(html, /unsubscribe\/xyz/);
    // existing layout untouched: primary CTA + signature divider still present
    assert.match(html, /14 Tage kostenlos testen/);
  });

  test("buildOpportunity embeds THIS lead's unsubscribe URL (correct token)", () => {
    const a = normalize({ id: "acct-42", name: "Muster GmbH", industry: "Automotive", email: "info@muster.de", prio: "A", score: 80 }, 0);
    const opp = buildOpportunity(a, () => "2026-07-05T09:00:00.000Z", "E");
    const expected = unsubscribeUrl("acct-42");
    assert.equal(opp.unsubscribeUrl, expected);
    assert.match(opp.emailHtml, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(opp.unsubscribeUrl.startsWith("http"), true); // absolute, never relative
  });
});
