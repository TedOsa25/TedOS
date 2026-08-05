// Tests for opt-out detection in inbound replies.
//
// The decisive case is the false positive: our own legal footer contains the
// word "abmelden" in every mail we send, so a naive body match would classify
// nearly every quoted reply as an opt-out and suppress the whole campaign.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { stripQuotedReply, isOptOutMessage } from "./inbox-classify.js";

const HEADERS = [
  "Return-Path: <kunde@example.de>",
  "From: Max Muster <kunde@example.de>",
  "Subject: Re: Musterfirma: CO2-Bilanz & PCF in Minuten",
  "Content-Type: text/plain; charset=utf-8",
].join("\n");

/** A reply that quotes our original mail, footer and all. */
function quotedReply(typed: string): string {
  return [
    HEADERS,
    "",
    typed,
    "",
    "Am 04.08.2026 um 09:12 schrieb Ted Osammor <ted@heycarbo.com>:",
    "> Guten Tag,",
    "> Bei unserer Recherche ist uns aufgefallen, dass Musterfirma ...",
    "> Falls Sie künftig keine Informationen mehr von HeyCarbo erhalten möchten,",
    "> können Sie sich jederzeit mit einem Klick abmelden oder einfach auf diese",
    "> E-Mail mit „Abmelden“ antworten.",
    "> Impressum · Datenschutzerklärung · Abmelden",
  ].join("\n");
}

describe("stripQuotedReply", () => {
  test("keeps only what the person typed", () => {
    const out = stripQuotedReply(quotedReply("Bitte austragen."));
    assert.equal(out, "Bitte austragen.");
  });

  test("drops the header block", () => {
    assert.doesNotMatch(stripQuotedReply(quotedReply("Danke.")), /Return-Path|Subject:/);
  });

  test("cuts at an Outlook-style 'Von:' separator", () => {
    const raw = [HEADERS, "", "Kein Interesse.", "", "Von: Ted Osammor", "Gesendet: Montag", "> ... abmelden ..."].join("\n");
    assert.equal(stripQuotedReply(raw), "Kein Interesse.");
  });

  test("cuts at an English 'On ... wrote:' separator", () => {
    const raw = [HEADERS, "", "Thanks, not now.", "", "On Aug 4, 2026, Ted wrote:", "> unsubscribe link here"].join("\n");
    assert.equal(stripQuotedReply(raw), "Thanks, not now.");
  });
});

describe("isOptOutMessage", () => {
  test("a bare 'Abmelden' body is an opt-out even under a normal Re: subject", () => {
    // The regression this fixes: only the subject used to be checked, so this
    // recipient stayed contactable.
    assert.equal(
      isOptOutMessage("Re: Musterfirma: CO2-Bilanz & PCF in Minuten", quotedReply("Abmelden")),
      true,
    );
  });

  test("an ordinary reply quoting our footer is NOT an opt-out", () => {
    assert.equal(
      isOptOutMessage(
        "Re: Musterfirma: CO2-Bilanz & PCF in Minuten",
        quotedReply("Klingt spannend — können wir nächste Woche telefonieren?"),
      ),
      false,
    );
  });

  test("an interested reply mentioning our unsubscribe wording is NOT an opt-out", () => {
    assert.equal(
      isOptOutMessage("Re: Angebot", quotedReply("Danke für die Info, ich leite das intern weiter.")),
      false,
    );
  });

  test("opt-out in the subject still counts", () => {
    assert.equal(isOptOutMessage("Abmelden", quotedReply("")), true);
  });

  test("German variants are recognised", () => {
    for (const phrase of ["Bitte austragen", "Kein Interesse", "Nicht mehr kontaktieren", "Keine E-Mails mehr"]) {
      assert.equal(isOptOutMessage("Re: X", quotedReply(phrase)), true, `missed: ${phrase}`);
    }
  });

  test("English variants are recognised", () => {
    for (const phrase of ["Please unsubscribe", "Remove me from your list", "opt-out please"]) {
      assert.equal(isOptOutMessage("Re: X", quotedReply(phrase)), true, `missed: ${phrase}`);
    }
  });

  test("a long message merely mentioning the word is not an opt-out", () => {
    const chatty =
      "Vielen Dank für Ihre Nachricht. ".repeat(30) +
      "Übrigens stand im Footer etwas von abmelden, das war aber nicht gemeint.";
    assert.equal(isOptOutMessage("Re: X", quotedReply(chatty)), false);
  });
});
