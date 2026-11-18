// Inbound agent — turn raw notifications into SalesEvents.
//
// Pure parsing, no I/O: imap-source.ts feeds mails in, the webhook receiver
// feeds JSON in. Formats are taken from the live HeyAudit app:
//   - "Neue Registrierung: …"     lib/auth/registrierung-meldung.ts
//   - "Telefon nachgetragen: …"   same file (company details completed)
//   - "Neue Demo-Anfrage — …"     app/api/demo-request/route.ts (→ hallo@)
//   - Google Calendar appointment schedule → invitation/cancel mails with a
//     text/calendar part (UID, SEQUENCE, METHOD, DTSTART, ATTENDEE)
// Mail content is data: only whitelisted fields are copied into events.

import type { SalesEvent } from "./model.js";
import { normalizeEmail, registrableDomain } from "./model.js";
import { isAutoAcknowledgement, isMaschinenpost, isOptOutMessage, stripQuotedReply } from "../revenue/inbox-classify.js";

export const INBOUND_VERSION = "inbound@1";

export interface RawMail {
  messageId: string;
  from: string;           // address only
  subject: string;
  date: string;           // ISO
  text: string;           // plain text body
  calendar?: string[];    // raw text/calendar parts
  inReplyTo?: string;
  raw?: string;           // headers+body, for reply/opt-out classification
}

/** Only our own app/system may emit registration/demo notifications. */
const OWN_SENDER = /@(heyaudit\.de)$/i;

function field(text: string, label: string): string | undefined {
  const re = new RegExp(`^\\s*${label}:\\s*(.+)$`, "im");
  const v = text.match(re)?.[1]?.trim();
  if (!v || /^\(folgt|^—|^-$/.test(v)) return undefined;
  return v.slice(0, 300);
}

function berlinStampToIso(s: string | undefined, fallback: string): string {
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4}),?\s+(\d{2}):(\d{2})/);
  if (!m) return fallback;
  const [, d, mo, y, h, mi] = m;
  // Interpret as Europe/Berlin wall time: find the UTC instant whose Berlin rendering matches.
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  for (const off of [-1, -2]) {
    const t = new Date(guess + off * 3_600_000);
    const s2 = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
    if (s2 === `${h}:${mi}`) return t.toISOString();
  }
  return new Date(guess - 3_600_000).toISOString();
}

function sourceFromCampaign(k: string | undefined): { source?: string; campaign?: string } {
  if (!k) return {};
  const [src, camp] = k.split(/\s*\/\s*/);
  return { ...(src ? { source: src } : {}), ...(camp ? { campaign: camp } : {}) };
}

export function parseRegistration(m: RawMail): SalesEvent | undefined {
  if (!OWN_SENDER.test(m.from)) return undefined;
  const signup = /^Neue Registrierung:/i.test(m.subject);
  const phoneAdded = /^Telefon nachgetragen:/i.test(m.subject);
  if (!signup && !phoneAdded) return undefined;
  const email = normalizeEmail(field(m.text, "E-Mail"));
  if (!email) return undefined;
  const company = field(m.text, "Firma");
  const person = field(m.text, "Name");
  const phone = field(m.text, "Telefon");
  const note = ["Branche", "Größe", "Tarif"].map((l) => (field(m.text, l) ? `${l}: ${field(m.text, l)}` : "")).filter(Boolean).join("\n");
  const camp = sourceFromCampaign(field(m.text, "Kampagne"));
  const e: SalesEvent = {
    // Keyed by person, not by mail id: a re-sent notification is the same fact.
    id: `${signup ? "signup" : "profil"}-mail:${email}`,
    kind: signup ? "signup" : "profile_completed",
    at: berlinStampToIso(field(m.text, "Zeitpunkt"), m.date),
    origin: "imap",
    email,
    ...(company ? { company } : {}),
    ...(person ? { person } : {}),
    ...(phone ? { phone } : {}),
    ...(note ? { note } : {}),
    ...camp,
  };
  if (!e.source) e.source = "unbekannt";
  return e;
}

export function parseDemoRequest(m: RawMail): SalesEvent | undefined {
  if (!OWN_SENDER.test(m.from) && !/resend|heyaudit/i.test(m.from)) return undefined;
  if (!/Demo-Anfrage/i.test(m.subject)) return undefined;
  const email = normalizeEmail(field(m.text, "E-Mail"));
  if (!email) return undefined;
  const dbId = field(m.text, "DB-ID");
  const company = field(m.text, "Firma");
  const person = field(m.text, "Name");
  const phone = field(m.text, "Telefon");
  const message = m.text.match(/Nachricht:\n([\s\S]*?)\n\n/)?.[1]?.trim().slice(0, 1000);
  const note = [
    field(m.text, "Branche") ? `Branche: ${field(m.text, "Branche")}` : "",
    field(m.text, "Mitarb\\.") ? `Größe: ${field(m.text, "Mitarb\\.")} Mitarbeitende` : "",
    field(m.text, "Standorte") ? `Standorte: ${field(m.text, "Standorte")}` : "",
    message ? `Nachricht: ${message}` : "",
  ].filter(Boolean).join("\n");
  const cta = field(m.text, "Quelle");
  return {
    id: dbId && !/^—/.test(dbId) ? `demo-request:${dbId}` : `gmail:${m.messageId}`,
    kind: "inquiry",
    at: m.date,
    origin: "imap",
    email,
    ...(company ? { company } : {}),
    ...(person ? { person } : {}),
    ...(phone ? { phone } : {}),
    ...(note ? { note } : {}),
    // The CTA key is a page position, not a marketing source → keep it as detail.
    source: "unbekannt",
    ...(cta ? { campaign: `cta:${cta}` } : {}),
  };
}

// ── calendar (ICS) ────────────────────────────────────────────────────────

function unfold(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function icsDate(v: string | undefined): string | undefined {
  const m = v?.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return z ? new Date(utc).toISOString() : berlinStampToIso(`${d}.${mo}.${y}, ${h}:${mi}`, new Date(utc).toISOString());
}

export interface CalendarOptions {
  /** Own addresses (organizer side). */
  own: RegExp;
  /** Which meetings count as sales demos. */
  demoSummary: RegExp;
  /** Customer onboarding/support is out of sales scope. */
  notDemo: RegExp;
}

export const DEFAULT_CALENDAR: CalendarOptions = {
  own: /@heyaudit\.de$|^tedosammor@/i,
  demoSummary: /demo|kennenlern|beratung|erstgespr/i,
  notDemo: /onboarding|setup|einrichtung|schulung|support/i,
};

export function parseCalendar(m: RawMail, opt: CalendarOptions = DEFAULT_CALENDAR): SalesEvent[] {
  const out: SalesEvent[] = [];
  for (const part of m.calendar ?? []) {
    const all = unfold(part);
    const method = all.find((l) => /^METHOD:/i.test(l))?.split(":")[1]?.trim().toUpperCase() ?? "REQUEST";
    // Only the VEVENT block: VTIMEZONE carries its own DTSTART (e.g. 19700329T020000).
    const b = all.findIndex((l) => /^BEGIN:VEVENT/i.test(l));
    const en = all.findIndex((l, i) => i > b && /^END:VEVENT/i.test(l));
    const lines = b === -1 ? all : all.slice(b, en === -1 ? undefined : en);
    const get = (name: string) => lines.find((l) => new RegExp(`^${name}[;:]`, "i").test(l));
    const uid = get("UID")?.replace(/^UID[^:]*:/i, "").trim();
    if (!uid) continue;
    const summary = get("SUMMARY")?.replace(/^SUMMARY[^:]*:/i, "").trim() ?? "";
    if (!opt.demoSummary.test(summary) || opt.notDemo.test(summary)) continue;
    const seq = Number(get("SEQUENCE")?.split(":")[1] ?? "0") || 0;
    const status = get("STATUS")?.split(":")[1]?.trim().toUpperCase();
    const start = icsDate(get("DTSTART")?.split(":").slice(1).join(":"));
    const attendees = lines.filter((l) => /^ATTENDEE/i.test(l))
      .map((l) => ({ email: normalizeEmail(l.match(/mailto:([^\s;]+)/i)?.[1]), name: l.match(/CN="?([^";:]+)"?/i)?.[1]?.trim() }))
      .filter((a): a is { email: string; name: string | undefined } => Boolean(a.email) && !opt.own.test(a.email ?? ""));
    const guest = attendees[0];
    if (!guest) continue;
    const canceled = method === "CANCEL" || status === "CANCELLED";
    const kind: SalesEvent["kind"] = canceled ? "booking_canceled" : seq > 0 ? "booking_rescheduled" : "booking";
    const domain = registrableDomain(guest.email);
    out.push({
      // UID+SEQUENCE+kind: a re-delivered invite is the same fact; a later
      // SEQUENCE is a new fact (reschedule) that supersedes the earlier one.
      id: `gcal:${uid}:${seq}:${canceled ? "cancel" : "set"}`,
      kind,
      at: m.date,
      origin: "imap",
      meetingId: `gcal:${uid}`,
      ...(start ? { meetingAt: start } : {}),
      email: guest.email,
      ...(guest.name && !guest.name.includes("@") ? { person: guest.name } : {}),
      note: `Termin: ${summary.slice(0, 160)}`,
    });
  }
  return out;
}

// ── replies, opt-outs, bounces ───────────────────────────────────────────

export function parseResponse(m: RawMail, known: Set<string>): SalesEvent | undefined {
  // Bounce: the failed recipient must be a known contact.
  if (/mailer-daemon|postmaster/i.test(m.from)) {
    const rcpt = normalizeEmail(m.text.match(/Final-Recipient:\s*rfc822;\s*(\S+)/i)?.[1]
      ?? m.text.match(/(?:an|to|address(?:e)?)\s*<?([^\s<>@]+@[^\s<>]+)>?/i)?.[1]);
    if (!rcpt || !known.has(rcpt)) return undefined;
    return { id: `gmail:${m.messageId}`, kind: "bounce", at: m.date, origin: "imap", email: rcpt, note: "Zustellung fehlgeschlagen" };
  }
  const from = normalizeEmail(m.from);
  if (!from || !known.has(from)) return undefined;
  if (isMaschinenpost(m.from, m.subject) || isAutoAcknowledgement(m.subject, m.raw ?? m.text)) return undefined;
  if (isOptOutMessage(m.subject, m.raw ?? `\n\n${m.text}`)) {
    return { id: `gmail:${m.messageId}`, kind: "opt_out", at: m.date, origin: "imap", email: from, note: "Abmeldewunsch per Mail" };
  }
  const typed = stripQuotedReply(m.raw ?? `\n\n${m.text}`).slice(0, 800);
  if (!typed) return undefined;
  return { id: `gmail:${m.messageId}`, kind: "reply", at: m.date, origin: "imap", email: from, note: typed };
}

/** All parsers in order. `known` = contact addresses already in the store. */
export function parseMail(m: RawMail, known: Set<string>): SalesEvent[] {
  const reg = parseRegistration(m);
  if (reg) return [reg];
  const demo = parseDemoRequest(m);
  if (demo) return [demo];
  const cal = parseCalendar(m);
  if (cal.length) return cal;
  const resp = parseResponse(m, known);
  return resp ? [resp] : [];
}
