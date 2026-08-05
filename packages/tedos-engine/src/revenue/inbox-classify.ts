// Pure classification helpers for the inbox scan.
//
// Split out of inbox-scan.ts so they can be unit-tested: that module runs
// main() on import (it is a script), so importing it from a test would open an
// IMAP connection.

/**
 * Reply separators that mark the start of the quoted original — German and
 * English clients, plus the horizontal rule Outlook emits.
 */
const QUOTE_SEPARATORS = [
  /^-{2,}\s*(original|urspr[üu]ngliche)[\s\w-]*-{0,}/im,
  /^_{5,}/m,
  /^\s*Am\s.+\sschrieb\s/im,
  /^\s*On\s.+\swrote:/im,
  /^\s*Von:\s/im,
  /^\s*From:\s/im,
  /^\s*Gesendet:\s/im,
  /^\s*Sent:\s/im,
];

/**
 * Return only what the person actually typed: the message body with the quoted
 * original removed.
 *
 * This matters more than it looks. Our own legal footer contains the words
 * "abmelden" and "Abmelden" (the opt-out link) in every mail we send, so any
 * reply that quotes the original — which is nearly all of them — would match an
 * opt-out pattern applied to the raw message. Testing the whole body would
 * therefore classify almost every human reply as an opt-out.
 */
export function stripQuotedReply(raw: string): string {
  // Drop the RFC 5322 header block: body starts after the first blank line.
  const blank = raw.search(/\r?\n\r?\n/);
  let body = blank === -1 ? raw : raw.slice(blank).replace(/^\s+/, "");

  // Cut at the earliest quote separator.
  let cut = body.length;
  for (const re of QUOTE_SEPARATORS) {
    const m = body.match(re);
    if (m?.index !== undefined && m.index < cut) cut = m.index;
  }
  body = body.slice(0, cut);

  // Drop quoted lines ("> ...") that appear before any separator.
  return body
    .split(/\r?\n/)
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .trim();
}

/** Opt-out phrases, matched against the subject or the newly-typed reply text. */
export const OPTOUT_PATTERN =
  /(abmelden|unsubscribe|keine (e-?mails|werbung)|austragen|remove me|nicht mehr kontaktieren|opt[- ]?out|kein interesse|bitte l[öo]schen)/i;

/**
 * True when this inbound message is a request to be removed.
 *
 * The subject is checked as-is; the body is checked only after the quoted
 * original is stripped (see stripQuotedReply). Previously only the subject was
 * examined — and since a reply keeps the original subject ("Re: <company>:
 * CO₂-Bilanz …"), a recipient who wrote nothing but "Abmelden" in the body was
 * filed as an ordinary reply and never suppressed.
 */
export function isOptOutMessage(subject: string, rawSource: string): boolean {
  if (OPTOUT_PATTERN.test(subject)) return true;
  const typed = stripQuotedReply(rawSource);
  // Guard against a long message that merely mentions the word in passing:
  // a genuine opt-out is short and to the point.
  if (typed.length > 600) return false;
  return OPTOUT_PATTERN.test(typed);
}
