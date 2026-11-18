// RevOps + Acquisition agents — measurement and reports.
//
// Four funnel stages are counted SEPARATELY and never mixed:
//   researched target accounts → real leads (first-party interest)
//   → qualified demos (booked / held, fit = yes) → wins.
// Unknown origin stays "unbekannt" and is reported as such.

import type { SalesEvent } from "./model.js";
import { berlinDay, berlinWeek } from "./model.js";
import type { AccountState } from "./rules.js";
import type { JobState, ResearchTarget, SalesTask } from "./store.js";
import { DEMO_BOOKING_URL } from "./drafts.js";

export const REVOPS_VERSION = "revops@1";
export const ACQUISITION_VERSION = "akquise@1";
const PAID = new Set(["meta", "google-ads", "linkedin"]);

export interface SourceWeek {
  week: string;
  source: string;
  leads: number;
  bookedQualified: number;
  heldQualified: number;
  wins: number;
  openTasks: number;
  spendEur?: number;
}

export function funnel(states: AccountState[], tasks: SalesTask[], research: ResearchTarget[], spend: Record<string, Record<string, number>> = {}) {
  const rows = new Map<string, SourceWeek>();
  const row = (week: string, source: string) => {
    const k = `${week}|${source}`;
    let r = rows.get(k);
    if (!r) { r = { week, source, leads: 0, bookedQualified: 0, heldQualified: 0, wins: 0, openTasks: 0 }; rows.set(k, r); }
    return r;
  };
  for (const st of states) {
    if (!st.lead) continue;
    const fi = st.firstInterest as SalesEvent;
    row(berlinWeek(fi.at), st.source).leads++;
    const qualified = st.q.fit === "yes";
    const booking = st.account.events.find((e) => e.kind === "booking");
    if (booking && qualified) row(berlinWeek(booking.at), st.source).bookedQualified++;
    if (st.demoHeld && st.demoHeld.fit !== "no" && qualified) row(berlinWeek(st.demoHeld.at), st.source).heldQualified++;
    if (st.won) row(berlinWeek(st.won.at), st.source).wins++;
    const open = tasks.filter((t) => t.status === "open" && (t.account === st.account.id || st.account.keys.includes(t.account))).length;
    if (open) row(berlinWeek(new Date().toISOString()), st.source).openTasks += open;
  }
  for (const [week, bySrc] of Object.entries(spend)) for (const [src, eur] of Object.entries(bySrc)) row(week, src).spendEur = eur;
  const targetsByWeek: Record<string, number> = {};
  for (const t of research) if (t.status === "neu") targetsByWeek[berlinWeek(t.foundAt)] = (targetsByWeek[berlinWeek(t.foundAt)] ?? 0) + 1;
  return { rows: [...rows.values()].sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : a.source < b.source ? -1 : 1)), targetsByWeek };
}

function fmtDue(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const TYPE_LABEL: Record<SalesTask["type"], string> = {
  demo_briefing: "Demo", callback: "Rückruf", reply_draft: "Antwort", rebook: "Neuer Termin",
  outcome_capture: "Ergebnis erfassen", followup_draft: "Follow-up", review_reply: "Antwort lesen",
};

export function dailyBrief(now: Date, tasks: SalesTask[], states: AccountState[], jobs: JobState[], research: ResearchTarget[]): string {
  const day = berlinDay(now);
  const horizon = now.getTime() + 24 * 3_600_000;
  const open = tasks.filter((t) => t.status === "open").sort((a, b) => a.priority - b.priority || (a.due < b.due ? -1 : 1));
  const due = open.filter((t) => Date.parse(t.due) <= horizon && !t.overCapacity);
  const later = open.filter((t) => Date.parse(t.due) > horizon);
  const over = open.filter((t) => t.overCapacity);
  const overdue = open.filter((t) => Date.parse(t.due) < now.getTime() - 24 * 3_600_000);
  const failing = jobs.filter((j) => j.deadLetter || j.consecutiveFailures > 0 || j.paused);
  const stOf = (t: SalesTask) => states.find((s) => s.account.id === t.account);
  const line = (t: SalesTask) => {
    const st = stOf(t);
    const contact = [t.contactPhone ? `☎ ${t.contactPhone}` : "", t.contactEmail ? `✉ ${t.contactEmail}` : ""].filter(Boolean).join(" · ");
    return `- **${fmtDue(t.due)}** · ${TYPE_LABEL[t.type]} · ${t.title.replace(/^[^:]+:\s*/, "")}${contact ? ` · ${contact}` : ""}\n  ${t.reason}${st ? ` · Fit ${st.q.fit}, Absicht ${st.q.intent} · Quelle ${st.source}` : ""}\n  Aufgabe: \`${t.id}\``;
  };
  const newTargets = research.filter((r) => r.status === "neu" && berlinDay(new Date(r.foundAt)) === day);
  return [
    `# HeyAudit Sales — ${day}`,
    `_${REVOPS_VERSION} · erzeugt ${fmtDue(now.toISOString())} (Europe/Berlin)_`,
    "",
    `## Heute fällig (${due.length})`,
    due.length ? due.map(line).join("\n") : "- Nichts fällig.",
    "",
    ...(over.length ? [`## Über Kapazität → morgen (${over.length})`, over.map(line).join("\n"), ""] : []),
    `## Ausnahmen`,
    ...(overdue.length ? overdue.map((t) => `- ⚠ überfällig seit ${fmtDue(t.due)}: ${t.title}`) : ["- Keine überfälligen Aufgaben."]),
    ...failing.map((j) => `- ⚠ Job **${j.name}**: ${j.paused ? "pausiert" : j.deadLetter ? `DEAD-LETTER seit ${j.deadLetter.at}: ${j.deadLetter.error}` : `${j.consecutiveFailures} Fehlversuch(e): ${j.lastError ?? ""}`}`),
    "",
    `## Demnächst (${later.length})`,
    later.slice(0, 15).map((t) => `- ${fmtDue(t.due)} · ${TYPE_LABEL[t.type]} · ${t.title}`).join("\n") || "- —",
    "",
    `## Recherche heute: ${newTargets.length} neue Zielaccounts (keine Leads, keine Kontaktfreigabe)`,
    ...newTargets.map((r) => `- ${r.company} — ${r.website ?? "ohne Website"} — ${r.signal} · [Quelle](${r.sourceUrl})`),
    "",
    "Ergebnis nach Gespräch: `npm run sales -- ergebnis --konto \"<konto>\" --ergebnis demo_held|no_show|won|lost --fit yes|no --naechster-schritt \"…\" [--faellig YYYY-MM-DD]`",
    "Aufgabe erledigt: `npm run sales -- erledigt <aufgabe>`",
  ].join("\n");
}

export function weeklyReport(now: Date, f: ReturnType<typeof funnel>, states: AccountState[], learning: string[]): string {
  const weeks = [...new Set(f.rows.map((r) => r.week))].slice(0, 6);
  const table = ["| KW | Quelle | Leads | gebucht qual. | gehalten qual. | Abschlüsse | offene Aufgaben | Kosten/qual. Demo |", "|---|---|---:|---:|---:|---:|---:|---:|"];
  for (const r of f.rows.filter((x) => weeks.includes(x.week))) {
    const cpd = PAID.has(r.source)
      ? r.spendEur === undefined ? "Kosten n. v." : r.heldQualified ? `${(r.spendEur / r.heldQualified).toFixed(2)} €` : `${r.spendEur.toFixed(2)} € / 0`
      : "—";
    table.push(`| ${r.week} | ${r.source} | ${r.leads} | ${r.bookedQualified} | ${r.heldQualified} | ${r.wins} | ${r.openTasks} | ${cpd} |`);
  }
  const leads = states.filter((s) => s.lead);
  const unknown = leads.filter((s) => s.source === "unbekannt").length;
  const thisWeek = berlinWeek(now.toISOString());
  const weekLeads = f.rows.filter((r) => r.week === thisWeek).reduce((a, r) => a + r.leads, 0);
  return [
    `# HeyAudit Sales — Wochenbericht ${thisWeek}`,
    `_${REVOPS_VERSION}_`,
    "",
    `- Recherchierte Zielaccounts je KW: ${Object.entries(f.targetsByWeek).sort().reverse().slice(0, 6).map(([w, n]) => `${w}: ${n}`).join(", ") || "—"}`,
    `- Echte Leads diese KW: **${weekLeads}** (Ziel 30–50)`,
    `- Herkunft unbekannt: ${unknown} von ${leads.length} Leads${leads.length ? ` (${Math.round((unknown / leads.length) * 100)} %)` : ""}`,
    leads.length < 20 ? `- ⚠ Kleine Stichprobe (${leads.length} Leads gesamt) — Quoten nicht belastbar.` : "",
    "",
    ...table,
    "",
    "## Lernschleife (Vorschläge, nicht umgesetzt)",
    ...(learning.length ? learning.map((l) => `- ${l}`) : ["- Noch keine Demo-Ergebnisse mit Fit-Angabe — sobald Ergebnisse erfasst sind, erscheinen hier Vorschläge."]),
  ].filter((l) => l !== "").join("\n");
}

/** Demo outcomes → research priorities (proposal only). */
export function learningProposals(states: AccountState[], research: ResearchTarget[]): string[] {
  const held = states.filter((s) => s.demoHeld);
  if (held.length < 3) return held.length ? [`Erst ${held.length} Demo-Ergebnis(se) — Regeländerungen ab 3 Ergebnissen.`] : [];
  const good = held.filter((s) => s.demoHeld?.fit === "yes" || s.won);
  const bad = held.filter((s) => s.demoHeld?.fit === "no");
  const out: string[] = [];
  const sizes = (xs: AccountState[]) => xs.map((s) => s.account.events.map((e) => e.note ?? "").join(" ").match(/Gr(ö|oe)(ß|ss)e:\s*([^\n]+)/i)?.[3]).filter(Boolean);
  out.push(`${good.length} von ${held.length} gehaltenen Demos passten (Fit ja). Größen der passenden: ${sizes(good).join(", ") || "n. v."}; der unpassenden: ${sizes(bad).join(", ") || "n. v."}.`);
  const fromResearch = held.filter((s) => s.account.events.some((e) => e.kind === "target"));
  if (fromResearch.length) {
    const queries = fromResearch.map((s) => research.find((r) => s.account.events.some((e) => e.id === r.id))?.query).filter(Boolean);
    out.push(`Aus Recherche stammende Demos kamen über: ${queries.join(", ")} — Vorschlag: diese Suchanlässe höher gewichten.`);
  }
  if (bad.length >= 2) out.push(`Vorschlag: Ausschlussregel prüfen für Merkmale der ${bad.length} unpassenden Demos (Freigabe nötig).`);
  return out;
}

export interface MetaSpend { byWeek: Record<string, number>; campaigns: Array<{ name: string; spend: number; status: string }>; error?: string }

/** Read-only Meta insights (last 28 days) — spend per Berlin week. */
export async function readMetaSpend(token: string | undefined, account = "act_1081387852541408"): Promise<MetaSpend | undefined> {
  if (!token) return undefined;
  try {
    const url = `https://graph.facebook.com/v21.0/${account}/insights?level=campaign&time_increment=1&date_preset=last_28d&fields=campaign_name,spend,date_start&limit=500`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { byWeek: {}, campaigns: [], error: `Meta HTTP ${res.status}` };
    const j = (await res.json()) as { data?: Array<{ campaign_name: string; spend: string; date_start: string }> };
    const byWeek: Record<string, number> = {};
    const byCamp = new Map<string, number>();
    for (const d of j.data ?? []) {
      const w = berlinWeek(`${d.date_start}T12:00:00Z`);
      byWeek[w] = (byWeek[w] ?? 0) + Number(d.spend);
      byCamp.set(d.campaign_name, (byCamp.get(d.campaign_name) ?? 0) + Number(d.spend));
    }
    return { byWeek, campaigns: [...byCamp].map(([name, spend]) => ({ name, spend, status: "gelesen" })) };
  } catch (e) {
    return { byWeek: {}, campaigns: [], error: (e as Error).message };
  }
}

/** Acquisition agent: where do qualified demos come from + ONE prepared test. */
export function acquisitionPlan(now: Date, states: AccountState[], meta: MetaSpend | undefined): { markdown: string; proposal: { goalId: string; title: string; description: string } } {
  const week = berlinWeek(now.toISOString());
  const leads = states.filter((s) => s.lead);
  const bySrc = new Map<string, { leads: number; demos: number; wins: number }>();
  for (const s of leads) {
    const r = bySrc.get(s.source) ?? { leads: 0, demos: 0, wins: 0 };
    r.leads++;
    if (s.demoHeld && s.q.fit === "yes") r.demos++;
    if (s.won) r.wins++;
    bySrc.set(s.source, r);
  }
  const chatgpt = leads.filter((s) => s.source === "chatgpt" || s.source === "ki-assistent");
  const yr = week.slice(0, 4), kw = week.slice(-2);
  const utm = `utm_source=google&utm_medium=cpc&utm_campaign=gads-${yr}-kw${kw}-dienstplan-reinigung`;
  const proposal = {
    goalId: `sales:akquise:${week}`,
    title: `Akquise-Test ${week}: Suchanzeige „Dienstplan Gebäudereinigung“ (Entwurf)`,
    description: [
      "EIN Test, nichts geschaltet. Kaufnaher Suchanlass für Reinigungsbetriebe:",
      "Keywords (Phrase): „dienstplan gebäudereinigung“, „software gebäudereinigung“, „zeiterfassung reinigungskräfte“, „objektverwaltung reinigung“.",
      `Ziel-URL: https://www.heyaudit.de/gebaeudereinigung?${utm} — Konversion = Demo-Buchung (${DEMO_BOOKING_URL}) bzw. Registrierung.`,
      "Budgetvorschlag: 15 €/Tag für 14 Tage (≈ 210 €), Abbruch wenn nach 100 Klicks keine Registrierung/Anfrage.",
      "Erfolgskriterium: ≥ 2 gehaltene qualifizierte Demos; Messung über utm_source/utm_campaign in der Registrierungsmeldung → Sales-Ereignis → Wochenbericht.",
      "Alternative (Meta): vorhandene Motive aus Marketing/heyaudit-instagram/motive als Lead-Anzeige an Inhaber Reinigungsbetriebe, utm_campaign=meta-<jahr>-kw<nn>-<motiv>.",
      "Start, Veröffentlichung und Budget brauchen Teds Freigabe.",
    ].join("\n"),
  };
  const md = [
    `# Akquise-Analyse ${week}`,
    `_${ACQUISITION_VERSION}_`,
    "",
    "| Quelle | Leads | gehaltene qual. Demos | Abschlüsse |",
    "|---|---:|---:|---:|",
    ...[...bySrc].sort((a, b) => b[1].leads - a[1].leads).map(([s, r]) => `| ${s} | ${r.leads} | ${r.demos} | ${r.wins} |`),
    leads.length < 20 ? `\n⚠ Kleine Stichprobe (${leads.length} Leads).` : "",
    "",
    "## ChatGPT / KI-Assistenten",
    chatgpt.length
      ? chatgpt.map((s) => `- ${s.account.name}: genannte Herkunft „${s.firstInterest?.statedOrigin ?? "—"}“, Suchfrage „${s.firstInterest?.searchQuery ?? "nicht erfasst"}“`).join("\n")
      : "- Keine Leads mit ChatGPT-Herkunft erfasst. Die App speichert weder Referrer noch eine Frage „Wie haben Sie von uns erfahren?“ — ChatGPT-Besucher erscheinen als „unbekannt“, außer der Link trägt utm_source=chatgpt.com.",
    "",
    "## Meta (nur lesend)",
    meta ? (meta.error ? `- nicht verfügbar: ${meta.error}` : meta.campaigns.map((c) => `- ${c.name}: ${c.spend.toFixed(2)} € (28 Tage)`).join("\n") || "- 0 € in 28 Tagen") : "- Kein Lesezugang konfiguriert.",
    "- Google Ads: kein Konto/Zugang verbunden.",
    "",
    "## Vorbereiteter Test (Freigabe nötig)",
    `**${proposal.title}**`,
    "",
    proposal.description,
  ].join("\n");
  return { markdown: md, proposal };
}
