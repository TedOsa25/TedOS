// Channels — Instagram (DM-Akquise, Antworten), Meta (Kampagnen, Lead-Formulare)
// and the Growth-OS daily run, wired into the sales ledger.
//
// Instagram: following + the one thank-you DM run in an open Claude session
// (skill ig-runde, Chrome) — Instagram forbids bots. That session records what
// it saw in the IG runtime; this module turns it into sales facts:
//   * a reply to our DM  → SalesEvent "reply" (source instagram) → lead + task
//   * every reply        → a DM answer DRAFT in the approval queue (never sent here)
// Meta: campaign numbers come from the Growth-OS read connector (ads_read);
// lead-form leads (if a page token with leads_retrieval exists) become
// "inquiry" events. Nothing here publishes, sends or changes budgets.

import type { ApprovalInput } from "../approval-queue.js";
import { DEMO_BOOKING_URL } from "./drafts.js";
import type { SalesEvent } from "./model.js";
import { berlinWeek } from "./model.js";
import type { AccountState } from "./rules.js";

// ── Instagram ────────────────────────────────────────────────────────────
export interface IgKontakt {
  handle: string;
  name: string;
  status: string;
  charge?: string;
  gefolgtAm?: string;
  zurueckAm?: string;
  angeschriebenAm?: string;
}

/** One reply seen in the IG inbox (written by the ig-runde session). */
export interface IgAntwort {
  handle: string;
  name?: string;
  text: string;
  at: string;
}

export const normHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();

export function pruefeIgAntwort(raw: unknown): IgAntwort | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const handle = typeof r.handle === "string" ? normHandle(r.handle) : "";
  const text = typeof r.text === "string" ? r.text.trim().slice(0, 2000) : "";
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : "";
  if (!/^[a-z0-9._]{1,30}$/.test(handle) || !text || !at) return undefined;
  return { handle, text, at, ...(typeof r.name === "string" && r.name.trim() ? { name: r.name.trim().slice(0, 120) } : {}) };
}

/** Stable id: same handle + same minute + same text start = same reply (replays are idempotent). */
export function igAntwortId(a: IgAntwort): string {
  let h = 0;
  for (const c of a.text.slice(0, 80)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `instagram:${a.handle}:${a.at.slice(0, 16)}:${h.toString(36)}`;
}

export function igAntwortEreignis(a: IgAntwort, kontakt?: IgKontakt): SalesEvent {
  return {
    id: igAntwortId(a),
    kind: "reply",
    at: a.at,
    origin: "instagram",
    account: `ig:${a.handle}`,
    company: a.name ?? kontakt?.name ?? `@${a.handle}`,
    source: "instagram",
    campaign: kontakt?.angeschriebenAm ? "ig-dm-folgen" : "ig-dm",
    note: a.text,
    evidenceUrl: `https://www.instagram.com/${a.handle}/`,
  };
}

/** DM answer draft (IG duzt, kurz, keine erfundenen Zahlen). Draft only. */
export function igAntwortFreigabe(ev: SalesEvent): ApprovalInput {
  const handle = ev.account?.replace(/^ig:/, "") ?? "?";
  const entwurf = [
    "Danke dir für deine Nachricht! 🙌",
    "",
    "Wenn du magst, zeige ich dir HeyAudit in 20 Minuten online, ganz auf euren Ablauf bezogen. Termin kannst du dir hier direkt aussuchen:",
    DEMO_BOOKING_URL,
    "",
    "Oder du schaust es dir erst selbst an: heyaudit.de/gratis (bis 3 Mitarbeiter und 5 Objekte kostenlos).",
    "",
    "Viele Grüße, Ted",
  ].join("\n");
  return {
    goalId: `sales:ig-antwort:${ev.id}`,
    title: `Instagram-Antwort an @${handle} — Entwurf, nicht gesendet`,
    description: [
      `Ihre Nachricht (${ev.at.slice(0, 16).replace("T", " ")}):`,
      `> ${(ev.note ?? "").split("\n").join("\n> ")}`,
      "",
      "Entwurf (vor dem Senden auf die Nachricht anpassen):",
      entwurf,
      "",
      "Gesendet wird nur nach Freigabe, in der IG-Runde (Chrome), einmal, nach Prüfung des Chats.",
    ].join("\n"),
    businessImpact: 7, revenueImpact: 7, customerValue: 6,
    risk: "HIGH", priorityScore: 7, files: [], estimatedEffort: "3 min", recommendation: "approve",
  };
}

export interface IgFunnelZeile { week: string; gefolgt: number; zurueck: number; angeschrieben: number; antworten: number; leads: number }

/** Weekly IG acquisition funnel from the follow ledger + sales ledger. */
export function igFunnel(kontakte: IgKontakt[], states: AccountState[]): IgFunnelZeile[] {
  const rows = new Map<string, IgFunnelZeile>();
  const row = (iso: string) => {
    const w = berlinWeek(iso);
    let r = rows.get(w);
    if (!r) { r = { week: w, gefolgt: 0, zurueck: 0, angeschrieben: 0, antworten: 0, leads: 0 }; rows.set(w, r); }
    return r;
  };
  for (const k of kontakte) {
    if (k.gefolgtAm) row(k.gefolgtAm).gefolgt++;
    if (k.zurueckAm) row(k.zurueckAm).zurueck++;
    if (k.angeschriebenAm) row(k.angeschriebenAm).angeschrieben++;
  }
  for (const s of states) {
    for (const e of s.account.events) if (e.origin === "instagram" && e.kind === "reply") row(e.at).antworten++;
    if (s.lead && s.source === "instagram" && s.firstInterest) row(s.firstInterest.at).leads++;
  }
  return [...rows.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
}

// ── Meta ─────────────────────────────────────────────────────────────────
/** Lead-form lead as delivered by Graph /{form}/leads (field_data name/value). */
export interface MetaLead {
  id: string;
  created_time: string;
  campaign_name?: string;
  ad_name?: string;
  form_name?: string;
  field_data?: Array<{ name: string; values?: string[] }>;
}

export function metaLeadEreignis(l: MetaLead): SalesEvent | undefined {
  if (!l.id || Number.isNaN(Date.parse(l.created_time))) return undefined;
  const f = (...names: string[]) => l.field_data?.find((x) => names.includes(x.name.toLowerCase()))?.values?.[0]?.trim();
  const email = f("email", "e-mail");
  const company = f("company_name", "firma", "unternehmen");
  const phone = f("phone_number", "telefon", "telefonnummer");
  const person = f("full_name", "name");
  if (!email && !phone) return undefined;
  return {
    id: `meta-lead:${l.id}`,
    kind: "inquiry",
    at: new Date(l.created_time).toISOString(),
    origin: "meta-leadform",
    source: "meta",
    ...(l.campaign_name ? { campaign: l.campaign_name } : {}),
    ...(email ? { email } : {}),
    ...(company ? { company } : {}),
    ...(phone ? { phone } : {}),
    ...(person ? { person } : {}),
    note: `Meta-Leadformular${l.form_name ? ` „${l.form_name}“` : ""}${l.ad_name ? `, Anzeige ${l.ad_name}` : ""}`,
  };
}

export interface MetaAdsStand { stand?: string; zeitraumTage?: number; kostenJeRegistrierung?: number | null; befunde?: string[]; vorschlaege?: string[] }
export interface MetaZahlen { stand?: string; zeitraum?: string; ausgabenEur?: number | null; klicks?: number | null; leads?: number | null }

export function kanaeleAbschnitt(o: {
  igKontakte: IgKontakt[];
  igOffeneEntwuerfe: number;
  igFunnel: IgFunnelZeile[];
  meta?: MetaZahlen | undefined;
  metaAds?: MetaAdsStand | undefined;
  metaLeadsHinweis?: string | undefined;
  growthLauf?: string | undefined;
}): string {
  const st = (s: string) => o.igKontakte.filter((k) => k.status === s).length;
  const lines = ["## Kanäle", "", "**Instagram (@heyauditapp)**"];
  lines.push(`- Bestand: ${o.igKontakte.length} Firmen · gefolgt ${st("gefolgt")} · zurückgefolgt ${st("zurueckgefolgt")} · angeschrieben ${st("angeschrieben")}`);
  const w = o.igFunnel[0];
  if (w) lines.push(`- ${w.week}: ${w.gefolgt} gefolgt, ${w.zurueck} zurück, ${w.angeschrieben} Danke-DMs, ${w.antworten} Antworten, ${w.leads} Leads`);
  if (o.igOffeneEntwuerfe) lines.push(`- ${o.igOffeneEntwuerfe} DM-Antwortentwurf/-entwürfe warten auf Freigabe`);
  lines.push("- Folgen + Danke-DM laufen nur in der offenen Sitzung („IG-Runde“), kein Bot.");
  lines.push("", "**Meta**");
  if (o.meta) lines.push(`- ${o.meta.zeitraum ?? "Zeitraum ?"}: ${o.meta.ausgabenEur ?? "?"} € Ausgaben, ${o.meta.klicks ?? "?"} Klicks, ${o.meta.leads ?? "?"} zugeordnete Registrierungen (Stand ${o.meta.stand?.slice(0, 16) ?? "?"})`);
  else lines.push("- Kennzahlen: noch nicht abgerufen");
  for (const b of o.metaAds?.befunde?.slice(0, 4) ?? []) lines.push(`- ${b}`);
  if (o.metaLeadsHinweis) lines.push(`- Leadformulare: ${o.metaLeadsHinweis}`);
  lines.push("- Kampagnen starten/ändern, Budgets und Beiträge nur mit Teds Freigabe.");
  if (o.growthLauf) lines.push("", `Growth-Lauf: ${o.growthLauf}`);
  return lines.join("\n");
}
