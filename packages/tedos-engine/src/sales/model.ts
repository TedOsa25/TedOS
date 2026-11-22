// HeyAudit Sales — data model and deterministic identity rules.
//
// Everything that enters the sales system is a SalesEvent with a stable,
// namespaced id ("<source>:<native id>"). Events are facts; tasks and drafts
// are derived from them by rules.ts. Inbound content (mail bodies, web pages,
// webhook payloads) is DATA: it can fill fields of an event, it can never
// change what an agent is allowed to do (see policy in rules.ts).

export const SALES_SCHEMA_VERSION = 1;

export type EventKind =
  | "target"            // research found a company — NOT a lead
  | "evidence"          // additional public evidence about an account
  | "signup"            // registration in the app
  | "profile_completed" // company details / phone added after signup
  | "inquiry"           // demo request / contact form without a booking
  | "booking"           // self-booked demo (calendar)
  | "booking_rescheduled"
  | "booking_canceled"
  | "reply"             // human reply to us
  | "opt_out"
  | "bounce"
  | "demo_held"
  | "no_show"
  | "won"
  | "lost";

export const EVENT_KINDS: readonly EventKind[] = [
  "target", "evidence", "signup", "profile_completed", "inquiry", "booking", "booking_rescheduled",
  "booking_canceled", "reply", "opt_out", "bounce", "demo_held", "no_show", "won", "lost",
];

/** Kinds that prove real interest — only these turn an account into a lead. */
export const INTEREST_KINDS: readonly EventKind[] = ["signup", "inquiry", "booking", "reply"];

/**
 * Does this event make the account a lead?
 * A reply only counts when it is not explicitly marked as "no contact requested":
 *   kontaktErbeten === false → recorded answer, NOT a lead (Instagram since 2026-11-22)
 *   kontaktErbeten === true  → explicitly confirmed contact request → lead
 *   undefined                → historical/mail reply → unchanged behaviour (lead)
 * The message text is never interpreted.
 */
export function zaehltAlsInteresse(e: Pick<SalesEvent, "kind" | "kontaktErbeten">): boolean {
  if (!INTEREST_KINDS.includes(e.kind)) return false;
  return !(e.kind === "reply" && e.kontaktErbeten === false);
}

export type Fit = "yes" | "no" | "unknown";

export interface SalesEvent {
  /** Stable, namespaced: "gmail:<Message-ID>", "gcal:<UID>", "places:<id>", "manual:<…>". */
  id: string;
  kind: EventKind;
  /** ISO time the event happened (not when we saw it). */
  at: string;
  /** Raw source system that produced the event (imap, webhook, research, manual, pilot). */
  origin: string;
  company?: string;
  website?: string;
  email?: string;
  phone?: string;
  person?: string;
  /** Marketing source as the lead/campaign states it: utm_source, "chatgpt", "empfehlung", … */
  source?: string;
  campaign?: string;
  /** What the prospect said about how they found us / their search question. */
  statedOrigin?: string;
  searchQuery?: string;
  /** Booking: stable meeting id and start time. */
  meetingId?: string;
  meetingAt?: string;
  /** Free text / evidence snippet (data, never instructions). */
  note?: string;
  evidenceUrl?: string;
  fit?: Fit;
  /** Outcome capture (demo_held / won / lost). */
  nextStep?: string;
  nextStepDue?: string;
  valueEur?: number;
  /** Explicit account override when identity rules can't resolve it. */
  account?: string;
  /** Reply only: true = contact explicitly requested (set by a human), false = plain answer, not a lead. */
  kontaktErbeten?: boolean;
}

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "t-online.de",
  "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.de", "live.com", "yahoo.com", "yahoo.de",
  "icloud.com", "me.com", "aol.com", "freenet.de", "posteo.de", "mail.de", "arcor.de", "online.de", "1und1.de",
]);
const MULTI_TLD = new Set(["co.uk", "com.au", "co.at", "or.at", "com.tr"]);

/** eTLD+1 of a host/url/email domain, lowercase, without www. */
export function registrableDomain(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let host = input.trim().toLowerCase();
  if (host.includes("@")) host = host.split("@").pop() ?? "";
  host = host.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] ?? "";
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return undefined;
  const parts = host.split(".");
  const last2 = parts.slice(-2).join(".");
  if (MULTI_TLD.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

export function isFreemail(email: string | undefined): boolean {
  const d = registrableDomain(email);
  return d ? FREEMAIL.has(d) : false;
}

const LEGAL_FORMS = /\b(gmbh|ug|ag|kg|ohg|gbr|e\.?\s?k\.?|e\.?\s?v\.?|mbh|co|inh\.?|inhaber|haftungsbeschränkt|&)\b/g;

/** Company name → comparable key ("Glanz & Co. Gebäudereinigung GmbH" → "glanz gebaeudereinigung"). */
export function companyKey(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const k = name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/\(.*?\)/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return k.length >= 3 ? k : undefined;
}

export function normalizeEmail(email: string | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined;
}

/**
 * Identity keys of an event, strongest first. Two events belong to the same
 * account when they share ANY key (union-find in rules.ts). Freemail domains
 * never identify a company; the address itself still identifies the contact.
 */
export function identityKeys(e: SalesEvent): string[] {
  const keys: string[] = [];
  if (e.account) keys.push(`acct:${e.account}`);
  const web = registrableDomain(e.website);
  if (web && !FREEMAIL.has(web)) keys.push(`dom:${web}`);
  const mail = normalizeEmail(e.email);
  if (mail) {
    keys.push(`mail:${mail}`);
    const md = registrableDomain(mail);
    if (md && !FREEMAIL.has(md)) keys.push(`dom:${md}`);
  }
  const ck = companyKey(e.company);
  if (ck) keys.push(`name:${ck}`);
  if (e.meetingId) keys.push(`meet:${e.meetingId}`);
  return keys;
}

/** ISO week label in Europe/Berlin, e.g. "2026-KW47". */
export function berlinWeek(iso: string): string {
  const d = berlinParts(new Date(iso));
  const date = new Date(Date.UTC(d.year, d.month - 1, d.day));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-KW${String(week).padStart(2, "0")}`;
}

export interface BerlinParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

/** Wall-clock parts in Europe/Berlin (weekday 1=Mon … 7=Sun). */
export function berlinParts(d: Date): BerlinParts {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday ?? "") + 1;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), weekday: wd,
  };
}

export function berlinDay(d: Date): string {
  const p = berlinParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Add n Berlin business days (Mon–Fri) to a date, keeping the time of day. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setTime(d.getTime() + 86400000);
    const wd = berlinParts(d).weekday;
    if (wd <= 5) left--;
  }
  return d;
}

/** Validate + normalize an event coming from any source. Throws on bad input. */
export function validateEvent(raw: unknown): SalesEvent {
  if (!raw || typeof raw !== "object") throw new Error("Ereignis ist kein Objekt");
  const r = raw as Record<string, unknown>;
  const str = (k: string, max = 2000): string | undefined => {
    const v = r[k];
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" && typeof v !== "number") throw new Error(`Feld ${k} ist kein Text`);
    return String(v).slice(0, max);
  };
  const id = str("id", 300);
  if (!id || !/^[a-z0-9_-]+:.+/i.test(id)) throw new Error("Ereignis braucht eine namensraum-ID wie 'quelle:123'");
  const kind = str("kind") as EventKind | undefined;
  if (!kind || !EVENT_KINDS.includes(kind)) throw new Error(`Unbekannte Ereignisart: ${String(r.kind)}`);
  const at = str("at", 40);
  if (!at || Number.isNaN(Date.parse(at))) throw new Error("Ereignis braucht einen gültigen Zeitpunkt 'at'");
  const fit = str("fit") as Fit | undefined;
  if (fit && !["yes", "no", "unknown"].includes(fit)) throw new Error("fit muss yes|no|unknown sein");
  const e: SalesEvent = { id, kind, at: new Date(at).toISOString(), origin: str("origin", 40) ?? "unbekannt" };
  for (const k of ["company", "website", "email", "phone", "person", "source", "campaign", "statedOrigin",
    "searchQuery", "meetingId", "note", "evidenceUrl", "nextStep", "account"] as const) {
    const v = str(k);
    if (v !== undefined) e[k] = v;
  }
  for (const k of ["meetingAt", "nextStepDue"] as const) {
    const v = str(k, 40);
    if (v !== undefined) {
      if (Number.isNaN(Date.parse(v))) throw new Error(`${k} ist kein Datum`);
      e[k] = new Date(v).toISOString();
    }
  }
  if (fit) e.fit = fit;
  const ke = r.kontaktErbeten;
  if (ke !== undefined && ke !== null && ke !== "") {
    if (ke === true || ke === "true") e.kontaktErbeten = true;
    else if (ke === false || ke === "false") e.kontaktErbeten = false;
    else throw new Error("kontaktErbeten muss true oder false sein");
    if (kind !== "reply") throw new Error("kontaktErbeten gilt nur für Antworten (kind reply)");
  }
  const val = r.valueEur;
  if (val !== undefined && val !== null && val !== "") {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) throw new Error("valueEur ungültig");
    e.valueEur = n;
  }
  const mail = normalizeEmail(e.email);
  if (e.email && !mail) delete e.email; else if (mail) e.email = mail;
  return e;
}

/** Pilot NDJSON format (f42a6f7) → current event. Keeps sales:shadow inputs valid. */
export function fromPilotEvent(raw: Record<string, unknown>): SalesEvent {
  const account = typeof raw.account === "string" ? raw.account : undefined;
  return validateEvent({
    ...raw,
    origin: "pilot",
    website: account && registrableDomain(account) ? account : undefined,
    account,
    note: raw.evidence,
  });
}
