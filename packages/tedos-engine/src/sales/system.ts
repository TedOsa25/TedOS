// Wiring: the six agents as scheduler jobs over one store.

import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { buildBody, promptVersion, refineWithModel } from "./drafts.js";
import { fetchNewMail, imapConfigFromEnv, type Cursor } from "./imap-source.js";
import type { RawMail } from "./inbound.js";
import { parseMail } from "./inbound.js";
import type { SalesEvent } from "./model.js";
import { berlinDay, berlinWeek, normalizeEmail, validateEvent } from "./model.js";
import { acquisitionPlan, dailyBrief, funnel, learningProposals, readMetaSpend, weeklyReport } from "./reports.js";
import { loadBlocklist, pageFetch, placesSearch, runResearch, type ResearchState } from "./research.js";
import type { AccountState } from "./rules.js";
import { accountState, reconcile, resolveAccounts, stillValid } from "./rules.js";
import type { JobDef } from "./scheduler.js";
import type { SalesStore, SalesTask } from "./store.js";

const EXTERNAL: SalesTask["type"][] = ["reply_draft", "rebook", "followup_draft"];

export interface Config {
  capacity: number;
  researchLimit: number;
  blocklists: string[];
}

export function configFromEnv(): Config {
  return {
    capacity: Number(process.env.SALES_KAPAZITAET ?? 6),
    researchLimit: Number(process.env.SALES_RESEARCH_LIMIT ?? 10),
    blocklists: (process.env.SALES_SPERRLISTEN ?? "").split(":").filter(Boolean),
  };
}

/** Documented approvals for external actions (channel × purpose × volume). Empty = nothing external. */
export interface Freigabe { kanal: string; zweck: string; proTag: number; bis?: string; belegt: string }

export class SalesSystem {
  readonly approvals: ApprovalQueue;
  constructor(readonly store: SalesStore, readonly cfg: Config) {
    this.approvals = new ApprovalQueue(new JsonFileStorage(join(store.dir, "approvals")));
  }

  states(): AccountState[] {
    const evs = Object.values(this.store.events());
    return resolveAccounts(evs).map(accountState);
  }

  knownContacts(): Set<string> {
    const s = new Set<string>();
    // Only contacts of real sales accounts (not internal/test, not research-only).
    for (const st of this.states()) {
      if (!st.lead) continue;
      for (const e of st.account.events) { const m = normalizeEmail(e.email); if (m) s.add(m); }
    }
    return s;
  }

  /** Ingest events (any source) and converge tasks. Idempotent. */
  ingest(events: SalesEvent[], now: Date): string {
    const r = this.store.addEvents(events, now.toISOString());
    const t = this.converge(now);
    return `ereignisse +${r.added} neu, ${r.merged} ergänzt, ${r.duplicate} doppelt · ${t}`;
  }

  /** Reconcile tasks + keep the approval queue in sync with external drafts. */
  converge(now: Date): string {
    const states = this.states();
    const res = reconcile(states, this.store.tasks(), now, { contactTasksPerDay: this.cfg.capacity }, buildBody);
    for (const id of res.created) {
      const t = res.tasks[id] as SalesTask;
      if (!EXTERNAL.includes(t.type)) continue;
      const goalId = `sales:${t.id}`;
      this.approvals.enqueue({
        goalId, title: `${t.title} (Entwurf, nicht gesendet)`, description: t.body ?? "", businessImpact: 7, revenueImpact: 7, customerValue: 6,
        risk: "HIGH", priorityScore: Math.max(1, Math.round(-t.priority)), files: [], estimatedEffort: "5 min", recommendation: "approve",
      });
      t.approvalGoalId = goalId;
    }
    for (const id of res.superseded) {
      const t = res.tasks[id] as SalesTask;
      if (t.approvalGoalId) this.approvals.expire(t.approvalGoalId);
    }
    this.store.saveTasks(res.tasks);
    this.writeCockpit(now, states, Object.values(res.tasks));
    return `aufgaben +${res.created.length} neu, ${res.updated.length} aktualisiert, ${res.superseded.length} ersetzt`;
  }

  /** Execution guard for any external action: still valid AND documented approval with volume left. */
  mayExecute(taskId: string, kanal: string, zweck: string, now: Date): { ok: boolean; why: string } {
    const task = this.store.tasks()[taskId];
    if (!task || task.status !== "open") return { ok: false, why: "Aufgabe nicht offen" };
    if (!stillValid(taskId, this.states(), now)) return { ok: false, why: "Neuprüfung: Antwort/Buchung/Abmeldung/Bounce hat den Schritt überholt" };
    const appr = this.approvals.all().find((a) => a.goalId === task.approvalGoalId);
    if (task.approvalGoalId && appr?.status !== "approved") return { ok: false, why: "Entwurf nicht freigegeben" };
    const freigaben = this.store.read<Freigabe[]>("freigaben.json", []);
    const f = freigaben.find((x) => x.kanal === kanal && x.zweck === zweck && (!x.bis || x.bis >= berlinDay(now)));
    if (!f) return { ok: false, why: `Keine dokumentierte Freigabe für ${kanal}/${zweck}` };
    const today = berlinDay(now);
    const used = this.store.readLines<{ day: string; kanal: string }>("ausgefuehrt.jsonl").filter((x) => x.day === today && x.kanal === kanal).length;
    if (used >= f.proTag) return { ok: false, why: `Tagesvolumen ${f.proTag} für ${kanal} erreicht` };
    return { ok: true, why: `Freigabe ${f.belegt}` };
  }

  writeCockpit(now: Date, states: AccountState[], tasks: SalesTask[]): void {
    const md = dailyBrief(now, tasks, states, Object.values(this.store.jobs()), Object.values(this.store.research()));
    writeFileSync(join(this.store.dir, "AUFGABEN.md"), md + "\n", { mode: 0o600 });
  }

  // ── jobs ──────────────────────────────────────────────────────────────
  jobs(): JobDef[] {
    return [
      { name: "inbound", schedule: { every: 5 }, run: ({ now }) => this.jobInbound(now) },
      { name: "aufgaben", schedule: { every: 5 }, run: async ({ now }) => this.converge(now) },
      { name: "recherche", schedule: { at: { hour: 7, minute: 10 }, days: [1, 2, 3, 4, 5] }, run: ({ now }) => this.jobResearch(now) },
      { name: "tagesbericht", schedule: { at: { hour: 7, minute: 30 }, days: [1, 2, 3, 4, 5] }, run: async ({ now }) => this.jobDaily(now) },
      { name: "akquise", schedule: { at: { hour: 7, minute: 40 }, days: [1] }, run: ({ now }) => this.jobAcquisition(now) },
      { name: "wochenbericht", schedule: { at: { hour: 7, minute: 45 }, days: [1] }, run: ({ now }) => this.jobWeekly(now) },
      { name: "monitor", schedule: { every: 15 }, run: async ({ now }) => this.jobMonitor(now) },
    ];
  }

  /** Spool (webhook / manual exports) + IMAP poll. */
  async jobInbound(now: Date): Promise<string> {
    const events: SalesEvent[] = [];
    const spool = join(this.store.dir, "eingang");
    mkdirSync(join(spool, "verarbeitet"), { recursive: true, mode: 0o700 });
    let bad = 0;
    const files = readdirSync(spool).filter((f) => f.endsWith(".json") || f.endsWith(".ndjson")).sort();
    for (const f of files) {
      for (const line of readFileSync(join(spool, f), "utf8").split(/\r?\n/).filter((l) => l.trim())) {
        try { events.push(validateEvent(JSON.parse(line))); } catch { bad++; }
      }
    }
    let imap = "IMAP nicht konfiguriert";
    const cfg = imapConfigFromEnv();
    let mails: RawMail[] = [];
    let cursor: Cursor | undefined;
    if (cfg) {
      const r = await fetchNewMail(cfg, this.store.read<Cursor>("imap-cursor.json", {}));
      mails = r.mails;
      cursor = r.cursor;
      const known = this.knownContacts();
      let recognized = 0;
      // Registrations/inquiries/bookings first so replies of new contacts are known.
      for (const m of mails) { const ev = parseMail(m, new Set()); if (ev.length && ev[0]?.kind !== "reply") { events.push(...ev); recognized++; ev.forEach((e) => e.email && known.add(e.email)); } }
      for (const m of mails) { const ev = parseMail(m, known).filter((e) => ["reply", "opt_out", "bounce"].includes(e.kind)); if (ev.length) { events.push(...ev); recognized++; } }
      imap = `IMAP ${mails.length} Mails gelesen, ${recognized} erkannt`;
    }
    const out = this.ingest(events, now);
    // Persist cursor + archive spool only AFTER events are stored (crash-safe: replay is idempotent).
    if (cursor) this.store.write("imap-cursor.json", cursor);
    for (const f of files) renameSync(join(spool, f), join(spool, "verarbeitet", `${Date.now()}-${f}`));
    return `${imap} · spool ${files.length} Datei(en)${bad ? `, ${bad} ungültig` : ""} · ${out}`;
  }

  async jobResearch(now: Date): Promise<string> {
    const key = process.env.SALES_PLACES_KEY;
    if (!key) throw new Error("RECHERCHE_ZUGANG_FEHLT: SALES_PLACES_KEY nicht gesetzt (Keychain heyaudit-google-places)");
    // Block lists live in the outbound runtime (iCloud Desktop). If a list is not
    // readable from the job (eviction/TCC), fall back to the last snapshot and say so.
    const snapDir = join(this.store.dir, "sperrlisten");
    mkdirSync(snapDir, { recursive: true, mode: 0o700 });
    const paths: string[] = [];
    const notes: string[] = [];
    for (const p of this.cfg.blocklists) {
      const snap = join(snapDir, p.replace(/[^\w.-]+/g, "_"));
      const live = loadBlocklist([p]);
      if (live.readable.length) { copyFileSync(p, snap); paths.push(p); }
      else if (existsSync(snap)) { paths.push(snap); notes.push(`Sperrliste ${p} nicht lesbar — Stand ${statSync(snap).mtime.toISOString().slice(0, 10)}`); }
      else notes.push(`Sperrliste ${p} nicht lesbar, keine Kopie`);
    }
    const block = loadBlocklist(paths);
    const knownKeys = new Set(this.states().flatMap((s) => s.account.keys));
    const existing = this.store.research();
    const r = await runResearch({
      limit: this.cfg.researchLimit, today: berlinDay(now), now: now.toISOString(),
      state: this.store.read<ResearchState>("research-state.json", { queryIndex: 0, days: {} }),
      existing, knownKeys, block, search: placesSearch(key), fetchPage: pageFetch, maxQueries: 4,
    });
    if (notes.length) for (const t of r.created) t.assumptions.push(...notes);
    for (const t of [...r.created, ...r.skipped]) existing[t.id] = t;
    this.store.saveResearch(existing);
    this.store.write("research-state.json", r.state);
    const ing = this.ingest(r.events, now);
    return `${promptVersion("research")}: ${r.created.length} neue Zielaccounts, ${r.skipped.length} übersprungen (Dublette/Sperre/ohne Website) · Abfragen: ${r.queries.join(" | ")} · Sperrlisten ${block.readable.length}/${this.cfg.blocklists.length} (${block.domains.size} Domains)${notes.length ? ` ⚠ ${notes.join("; ")}` : ""} · ${ing}`;
  }

  jobDaily(now: Date): string {
    this.converge(now);
    const md = readFileSync(join(this.store.dir, "AUFGABEN.md"), "utf8");
    mkdirSync(join(this.store.dir, "berichte"), { recursive: true, mode: 0o700 });
    const p = join(this.store.dir, "berichte", `${berlinDay(now)}-tag.md`);
    writeFileSync(p, md, { mode: 0o600 });
    return `Tagesübersicht ${p}`;
  }

  async jobWeekly(now: Date): Promise<string> {
    const states = this.states();
    const meta = await readMetaSpend(process.env.SALES_META_TOKEN);
    const spend: Record<string, Record<string, number>> = {};
    for (const [w, eur] of Object.entries(meta?.byWeek ?? {})) spend[w] = { meta: eur };
    const f = funnel(states, Object.values(this.store.tasks()), Object.values(this.store.research()), spend);
    const md = weeklyReport(now, f, states, learningProposals(states, Object.values(this.store.research())));
    mkdirSync(join(this.store.dir, "berichte"), { recursive: true, mode: 0o700 });
    const p = join(this.store.dir, "berichte", `${berlinWeek(now.toISOString())}-woche.md`);
    writeFileSync(p, md + "\n", { mode: 0o600 });
    return `Wochenbericht ${p}`;
  }

  async jobAcquisition(now: Date): Promise<string> {
    const meta = await readMetaSpend(process.env.SALES_META_TOKEN);
    const plan = acquisitionPlan(now, this.states(), meta);
    mkdirSync(join(this.store.dir, "berichte"), { recursive: true, mode: 0o700 });
    const p = join(this.store.dir, "berichte", `${berlinWeek(now.toISOString())}-akquise.md`);
    writeFileSync(p, plan.markdown + "\n", { mode: 0o600 });
    this.approvals.enqueue({
      goalId: plan.proposal.goalId, title: plan.proposal.title, description: plan.proposal.description,
      businessImpact: 8, revenueImpact: 8, customerValue: 5, risk: "HIGH", priorityScore: 8, files: [p], estimatedEffort: "Freigabe + Einrichtung 1 h",
    });
    return `Akquise-Analyse ${p} · Testvorschlag ${plan.proposal.goalId} in Freigabe-Queue${meta?.error ? ` · Meta: ${meta.error}` : meta ? " · Meta gelesen" : " · Meta: kein Zugang"}`;
  }

  jobMonitor(now: Date): string {
    const jobs = this.store.jobs();
    const lines: string[] = [`# Sales-Jobstatus — ${now.toISOString()}`, "", "| Job | Status | letzter Lauf | letzter Erfolg | Dauer | Ergebnis/Fehler |", "|---|---|---|---|---:|---|"];
    const problems: string[] = [];
    for (const def of this.jobs()) {
      const j = jobs[def.name];
      const status = !j ? "noch nie gelaufen" : j.paused ? "PAUSIERT" : j.deadLetter ? "DEAD-LETTER" : j.consecutiveFailures ? `Fehler ×${j.consecutiveFailures}` : "ok";
      if (j?.deadLetter || (j?.consecutiveFailures ?? 0) > 0) problems.push(def.name);
      // Interval job silent for > 1 h = stale.
      if ("every" in def.schedule && j?.lastSuccessAt && now.getTime() - Date.parse(j.lastSuccessAt) > 3_600_000) problems.push(`${def.name} (kein Erfolg seit >1 h)`);
      lines.push(`| ${def.name} | ${status} | ${j?.lastRunAt ?? "—"} | ${j?.lastSuccessAt ?? "—"} | ${j?.lastDurationMs ?? "—"} ms | ${(j?.lastError ?? j?.lastResult ?? "").replace(/\|/g, "/").slice(0, 160)} |`);
    }
    lines.push("", existsSync(join(this.store.dir, "PAUSE")) ? "**GLOBAL PAUSIERT** (Datei PAUSE)" : "Global aktiv.");
    writeFileSync(join(this.store.dir, "STATUS.md"), lines.join("\n") + "\n", { mode: 0o600 });
    return problems.length ? `Auffällig: ${problems.join(", ")}` : "alle Jobs gesund";
  }
}
