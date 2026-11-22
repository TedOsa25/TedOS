// Deterministic sales rules: account resolution, next step, task reconciliation.
//
// No AI here. Status changes, dedupe, deadlines and blocks are fixed rules so
// that a replayed, duplicated, late or reordered event stream always converges
// to the same task set. Task ids are anchored to EVENT ids (first interest,
// meeting id, reply id) — never to the account id — so an account merge (e.g.
// a freemail signup later linked to a company booking) cannot duplicate tasks.

import type { SalesEvent } from "./model.js";
import { addBusinessDays, identityKeys, normalizeEmail, zaehltAlsInteresse } from "./model.js";
import type { Qualification } from "./qualify.js";
import { priorityScore, qualify } from "./qualify.js";
import type { SalesTask, TaskType } from "./store.js";

export interface Account {
  id: string;
  name: string;
  events: SalesEvent[];
  keys: string[];
}

export interface MeetingState {
  id: string;
  at: string;
  status: "active" | "canceled";
  bookedAt: string;
  held: boolean;
  noShow: boolean;
}

export interface AccountState {
  account: Account;
  q: Qualification;
  firstInterest?: SalesEvent;
  lead: boolean;
  source: string;
  sourceDetail?: string;
  meetings: MeetingState[];
  optedOut: Set<string>;
  bounced: Set<string>;
  accountOptOut: boolean;
  email?: string;
  phone?: string;
  person?: string;
  lastReply?: SalesEvent;
  demoHeld?: SalesEvent;
  won?: SalesEvent;
  lost?: SalesEvent;
}

const byTime = (a: SalesEvent, b: SalesEvent) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);

/** Union-find over identity keys → accounts. */
export function resolveAccounts(events: SalesEvent[]): Account[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c) as string; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra); };
  const evKey = (e: SalesEvent) => `ev:${e.id}`;
  for (const e of events) {
    parent.set(evKey(e), evKey(e));
    for (const k of identityKeys(e)) {
      if (!parent.has(k)) parent.set(k, k);
      union(evKey(e), k);
    }
  }
  const groups = new Map<string, SalesEvent[]>();
  for (const e of events) {
    const r = find(evKey(e));
    groups.set(r, [...(groups.get(r) ?? []), e]);
  }
  return [...groups.values()].map((evs) => {
    evs.sort(byTime);
    const keys = [...new Set(evs.flatMap(identityKeys))].sort();
    // Display id: company domain if known, else first key — for humans only.
    const id = keys.find((k) => k.startsWith("acct:")) ?? keys.find((k) => k.startsWith("dom:")) ?? keys[0] ?? `ev:${evs[0]?.id}`;
    const name = [...evs].reverse().find((e) => e.company)?.company ?? id.replace(/^\w+:/, "");
    return { id, name, events: evs, keys };
  });
}

export function accountState(account: Account): AccountState {
  const evs = account.events;
  const q = qualify(evs);
  const meetings = new Map<string, MeetingState>();
  const optedOut = new Set<string>();
  const bounced = new Set<string>();
  let accountOptOut = false;
  let lastReply: SalesEvent | undefined, demoHeld: SalesEvent | undefined, won: SalesEvent | undefined, lost: SalesEvent | undefined;
  let lastMeetingId: string | undefined;
  for (const e of evs) {
    const mail = normalizeEmail(e.email);
    switch (e.kind) {
      case "booking":
      case "booking_rescheduled": {
        const id = e.meetingId ?? `ohne-id:${e.id}`;
        const m = meetings.get(id);
        // A late "booking" older than a cancellation cannot revive it: events are
        // applied in event-time order, and a cancel only yields to a NEWER booking.
        meetings.set(id, { id, at: e.meetingAt ?? m?.at ?? e.at, status: "active", bookedAt: m?.bookedAt ?? e.at, held: m?.held ?? false, noShow: m?.noShow ?? false });
        lastMeetingId = id;
        break;
      }
      case "booking_canceled": {
        const id = e.meetingId ?? lastMeetingId;
        const m = id ? meetings.get(id) : undefined;
        if (m) m.status = "canceled";
        else if (id) meetings.set(id, { id, at: e.meetingAt ?? e.at, status: "canceled", bookedAt: e.at, held: false, noShow: false });
        break;
      }
      case "demo_held":
      case "no_show": {
        const id = e.meetingId ?? lastMeetingId;
        const m = id ? meetings.get(id) : undefined;
        if (m) { if (e.kind === "demo_held") m.held = true; else m.noShow = true; }
        if (e.kind === "demo_held") demoHeld = e;
        break;
      }
      case "opt_out":
        if (mail) optedOut.add(mail); else accountOptOut = true;
        if (e.phone) optedOut.add(e.phone);
        break;
      case "bounce":
        if (mail) bounced.add(mail);
        break;
      case "reply": lastReply = e; break;
      case "won": won = e; break;
      case "lost": lost = e; break;
      default: break;
    }
  }
  const firstInterest = evs.find(zaehltAlsInteresse);
  const lead = Boolean(firstInterest) && !q.internal;
  const contactEv = [...evs].reverse();
  const email = contactEv.map((e) => normalizeEmail(e.email)).find((m) => m && !bounced.has(m) && !optedOut.has(m));
  const phone = contactEv.map((e) => e.phone?.trim()).find((p) => p && /\d{5,}/.test(p.replace(/\D/g, "")) && !/^0+$/.test(p.replace(/\D/g, "")) && !optedOut.has(p));
  const person = contactEv.find((e) => e.person)?.person;
  const src = firstInterest ?? evs[0];
  const source = normalizeSource(src?.source, src?.statedOrigin);
  const st: AccountState = { account, q, lead, source, meetings: [...meetings.values()], optedOut, bounced, accountOptOut };
  if (firstInterest) st.firstInterest = firstInterest;
  const detail = [src?.campaign, src?.statedOrigin, src?.searchQuery].filter(Boolean).join(" · ");
  if (detail) st.sourceDetail = detail;
  if (email) st.email = email;
  if (phone) st.phone = phone;
  if (person) st.person = person;
  if (lastReply) st.lastReply = lastReply;
  if (demoHeld) st.demoHeld = demoHeld;
  if (won) st.won = won;
  if (lost) st.lost = lost;
  return st;
}

/** Map raw source/stated origin to a reporting channel. Unknown stays "unbekannt". */
export function normalizeSource(source?: string, stated?: string): string {
  const s = `${source ?? ""} ${stated ?? ""}`.toLowerCase();
  if (/chatgpt|openai|chat\.openai/.test(s)) return "chatgpt";
  if (/perplexity|gemini|copilot|claude/.test(s)) return "ki-assistent";
  if (/empfehl|referral|kunde hat|kollege/.test(s)) return "empfehlung";
  if (/google.*(ads|cpc)|gads|adwords/.test(s)) return "google-ads";
  if (/google|seo|organic|bing/.test(s)) return "google-organisch";
  if (/instagram|\big\b|ig-/.test(s)) return "instagram";
  if (/facebook|meta|\bfb\b/.test(s)) return "meta";
  if (/linkedin|\bli-/.test(s)) return "linkedin";
  if (/outbound|kaltakquise|e-?mail-kampagne|recherche/.test(s)) return "outbound";
  if (/portal|capterra|omr|softwareabc|vergleich/.test(s)) return "portal";
  const t = (source ?? "").trim();
  return t && t !== "unknown" ? t.toLowerCase() : "unbekannt";
}

// ── next step ────────────────────────────────────────────────────────────

export interface DesiredTask {
  id: string;
  type: TaskType;
  account: string;
  title: string;
  reason: string;
  due: string;
  score: number;
  contactEmail?: string;
  contactPhone?: string;
}

export interface Capacity {
  /** Max. callbacks + answer drafts Ted handles per day. */
  contactTasksPerDay: number;
}

/**
 * Exactly one next contact step per account (plus internal briefing/outcome
 * tasks for meetings). Pure function of the account's events and `now`.
 */
export function desiredTasks(st: AccountState, now: Date): DesiredTask[] {
  const out: DesiredTask[] = [];
  const a = st.account;
  if (st.q.internal || !st.lead) return out;
  if (st.won || st.lost) return out;
  const nowIso = now.toISOString();
  const contactBlocked = st.accountOptOut || (!st.email && !st.phone);
  const base = { account: a.id, ...(st.email ? { contactEmail: st.email } : {}), ...(st.phone ? { contactPhone: st.phone } : {}) };
  const push = (t: Omit<DesiredTask, "score" | "account">) => out.push({ ...base, ...t, score: priorityScore(st.q, t.due, now) });

  const active = st.meetings.filter((m) => m.status === "active" && !m.held && !m.noShow);
  const upcoming = active.filter((m) => Date.parse(m.at) > now.getTime() - 3_600_000).sort((x, y) => (x.at < y.at ? -1 : 1));
  const past = active.filter((m) => Date.parse(m.at) <= now.getTime() - 3_600_000);

  for (const m of upcoming.slice(0, 1)) {
    const due = new Date(Math.max(now.getTime(), Date.parse(m.at) - 2 * 3_600_000)).toISOString();
    push({ id: `brief:${m.id}`, type: "demo_briefing", title: `Demo vorbereiten: ${a.name}`, reason: `Demo gebucht für ${m.at}`, due });
  }
  for (const m of past) {
    push({ id: `outcome:${m.id}`, type: "outcome_capture", title: `Demo-Ergebnis erfassen: ${a.name}`, reason: `Termin ${m.at} ist vorbei, Ergebnis fehlt`, due: new Date(Date.parse(m.at) + 3_600_000).toISOString() });
  }
  if (upcoming.length || past.length) return out;

  // A reply newer than everything else → Ted reads it; it stops drafts/follow-ups.
  const latestOther = a.events.filter((e) => e.kind !== "reply" && e.kind !== "evidence" && e.kind !== "target").at(-1);
  if (st.lastReply && (!latestOther || st.lastReply.at >= latestOther.at)) {
    push({ id: `reply-review:${st.lastReply.id}`, type: "review_reply", title: `Antwort lesen: ${a.name}`, reason: "Persönliche Antwort eingegangen — Folgeaktionen gestoppt", due: nowIso });
    return out;
  }
  if (contactBlocked) return out;

  if (st.demoHeld) {
    const due = st.demoHeld.nextStepDue ?? addBusinessDays(new Date(st.demoHeld.at), 2).toISOString();
    if (!st.email && st.phone) {
      push({ id: `followup:${st.demoHeld.id}`, type: "callback", title: `Nachfassen (Anruf): ${a.name}`, reason: `Nach Demo: ${st.demoHeld.nextStep ?? "nächsten Schritt klären"}`, due });
    } else if (st.email) {
      push({ id: `followup:${st.demoHeld.id}`, type: "followup_draft", title: `Follow-up nach Demo: ${a.name}`, reason: `Nach Demo: ${st.demoHeld.nextStep ?? "nächsten Schritt klären"}`, due });
    }
    return out;
  }

  const canceled = st.meetings.filter((m) => m.status === "canceled" && !m.held).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
  if (canceled) {
    push({
      id: `rebook:${canceled.id}`, type: st.phone ? "callback" : "rebook",
      title: `${st.phone ? "Anrufen" : "Neuen Termin anbieten"}: ${a.name}`,
      reason: "Demo abgesagt — neuen Termin anbieten", due: addBusinessDays(now, 0).toISOString(),
    });
    return out;
  }

  const fi = st.firstInterest as SalesEvent;
  const fast = fi.kind === "inquiry";
  const due = fast ? new Date(Date.parse(fi.at) + 2 * 3_600_000).toISOString() : addBusinessDays(new Date(fi.at), 1).toISOString();
  if (st.phone) {
    push({ id: `callback:${fi.id}`, type: "callback", title: `Rückruf: ${a.name}`, reason: `${fi.kind === "inquiry" ? "Anfrage" : "Registrierung"} ohne Buchung, Telefon vorhanden`, due });
  } else if (st.email) {
    push({ id: `reply:${fi.id}`, type: "reply_draft", title: `Antwort senden: ${a.name}`, reason: `${fi.kind === "inquiry" ? "Anfrage" : "Registrierung"} ohne Buchung, nur E-Mail`, due });
  }
  return out;
}

function closeReason(st: AccountState, t: SalesTask): string {
  if (st.won) return "Abschluss erfasst";
  if (st.lost) return "Verloren erfasst";
  if (st.accountOptOut || (t.contactEmail && st.optedOut.has(t.contactEmail))) return "Abmeldung";
  if (t.contactEmail && st.bounced.has(t.contactEmail)) return "Bounce";
  if (st.meetings.some((m) => m.status === "active")) return "Buchung ersetzt den Schritt";
  if (st.lastReply) return "Antwort erhalten";
  if (st.phone && t.type === "reply_draft") return "Telefon liegt vor — Rückruf statt Mail";
  return "Nicht mehr erforderlich";
}

export interface ReconcileResult {
  created: string[];
  updated: string[];
  superseded: string[];
  tasks: Record<string, SalesTask>;
}

/**
 * Converge stored tasks to the desired set. Idempotent: running it twice with
 * the same events changes nothing. Done/closed tasks are never reopened.
 */
export function reconcile(
  states: AccountState[],
  stored: Record<string, SalesTask>,
  now: Date,
  capacity: Capacity,
  body: (st: AccountState, d: DesiredTask) => { body: string; version: string } | undefined,
): ReconcileResult {
  const tasks: Record<string, SalesTask> = JSON.parse(JSON.stringify(stored));
  const nowIso = now.toISOString();
  const desired = new Map<string, { st: AccountState; d: DesiredTask }>();
  for (const st of states) for (const d of desiredTasks(st, now)) desired.set(d.id, { st, d });
  const res: ReconcileResult = { created: [], updated: [], superseded: [], tasks };
  const stateByKey = new Map<string, AccountState>();
  for (const st of states) for (const k of st.account.keys) stateByKey.set(k, st);
  const stateOf = (t: SalesTask) => states.find((s) => s.account.id === t.account) ?? stateByKey.get(t.account);

  for (const t of Object.values(tasks)) {
    if (t.status !== "open" || desired.has(t.id)) continue;
    const st = stateOf(t);
    t.status = "superseded";
    t.closedReason = st ? closeReason(st, t) : "Konto nicht mehr vorhanden";
    t.updatedAt = nowIso;
    res.superseded.push(t.id);
  }
  for (const { st, d } of desired.values()) {
    const prev = tasks[d.id];
    if (prev && prev.status !== "open") continue; // never reopen
    const b = body(st, d);
    if (!prev) {
      const t: SalesTask = {
        id: d.id, account: d.account, type: d.type, status: "open", title: d.title, reason: d.reason,
        createdAt: nowIso, updatedAt: nowIso, due: d.due, priority: -d.score,
        ...(d.contactEmail ? { contactEmail: d.contactEmail } : {}),
        ...(d.contactPhone ? { contactPhone: d.contactPhone } : {}),
        ...(b ? { body: b.body, bodyVersion: b.version } : {}),
      };
      tasks[d.id] = t;
      res.created.push(d.id);
    } else {
      const changed = prev.due !== d.due || prev.title !== d.title || prev.account !== d.account || prev.reason !== d.reason
        || prev.contactEmail !== d.contactEmail || prev.contactPhone !== d.contactPhone;
      if (changed) {
        Object.assign(prev, { due: d.due, title: d.title, account: d.account, reason: d.reason, updatedAt: nowIso, priority: -d.score });
        if (d.contactEmail) prev.contactEmail = d.contactEmail; else delete prev.contactEmail;
        if (d.contactPhone) prev.contactPhone = d.contactPhone; else delete prev.contactPhone;
        if (b) { prev.body = b.body; prev.bodyVersion = b.version; }
        res.updated.push(d.id);
      }
    }
  }
  // Capacity: contact tasks due today, best first; the rest is marked for tomorrow.
  const endOfDay = now.getTime() + 24 * 3_600_000;
  const contact = Object.values(tasks)
    .filter((t) => t.status === "open" && ["callback", "reply_draft", "rebook", "followup_draft"].includes(t.type) && Date.parse(t.due) <= endOfDay)
    .sort((x, y) => x.priority - y.priority || (x.due < y.due ? -1 : 1));
  contact.forEach((t, i) => {
    const over = i >= capacity.contactTasksPerDay;
    if (Boolean(t.overCapacity) !== over) { if (over) t.overCapacity = true; else delete t.overCapacity; }
  });
  return res;
}

/** Execution guard: re-derive right before acting. False = do not act. */
export function stillValid(taskId: string, states: AccountState[], now: Date): boolean {
  return states.some((st) => desiredTasks(st, now).some((d) => d.id === taskId));
}
