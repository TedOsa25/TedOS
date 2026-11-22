// Wiring: the six agents as scheduler jobs over one store.

import { execFile } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { buildBody, promptVersion, refineWithModel } from "./drafts.js";
import { fetchNewMail, gesendetAnDomain, imapConfigFromEnv, type Cursor } from "./imap-source.js";
import type { RawMail } from "./inbound.js";
import { parseMail } from "./inbound.js";
import type { SalesEvent } from "./model.js";
import { berlinDay, berlinParts, berlinWeek, normalizeEmail, registrableDomain, validateEvent } from "./model.js";
import { acquisitionPlan, dailyBrief, funnel, learningProposals, readMetaSpend, weeklyReport } from "./reports.js";
import { loadBlocklist, pageFetch, placesSearch, runResearch, type ResearchState } from "./research.js";
import type { AccountState } from "./rules.js";
import { accountState, reconcile, resolveAccounts, stillValid } from "./rules.js";
import type { JobDef } from "./scheduler.js";
import type { SalesStore, SalesTask } from "./store.js";
import { igAntwortFreigabe, igFunnel, kanaeleAbschnitt, type IgKontakt, type MetaAdsStand, type MetaZahlen } from "./kanaele.js";
import { contentLoopSchritt, ContentStore } from "../content/zustand.js";
import { darfPartnerSenden, freigegebeneMail, ladeZiele, naechsteEntwuerfe, PARTNER_KANAL, PARTNER_ZWECK, partnerAbschnitt, partnerAntworten, partnerFreigabe, type PartnerBestand, type PartnerZiel } from "./partner.js";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = promisify(execFile);

const EXTERNAL: SalesTask["type"][] = ["reply_draft", "rebook", "followup_draft"];

export interface Config {
  capacity: number;
  researchLimit: number;
  blocklists: string[];
  /** Instagram/Growth runtime (follow ledger, growth briefings, Meta inputs). Outside iCloud. */
  igRuntime: string;
  /** Partner first-contact DRAFTS per weekday (nothing is sent). */
  partnerPerDay: number;
  /** Content-System (Redaktionspläne, Ideen). Außerhalb von Git. Fehlt = Content-Schritt aus (Tests). */
  contentDir?: string;
}

export function configFromEnv(): Config {
  return {
    capacity: Number(process.env.SALES_KAPAZITAET ?? 6),
    researchLimit: Number(process.env.SALES_RESEARCH_LIMIT ?? 10),
    blocklists: (process.env.SALES_SPERRLISTEN ?? "").split(":").filter(Boolean),
    igRuntime: process.env.SALES_IG_RUNTIME ?? join(homedir(), "dev", "heyaudit-ig-runtime"),
    partnerPerDay: Number(process.env.SALES_PARTNER_PRO_TAG ?? 3),
    contentDir: process.env.CONTENT_STATE_DIR ?? join(homedir(), "dev", "tedos-runtime", "heyaudit-content"),
  };
}

/** Documented approvals for external actions (channel × purpose × volume). Empty = nothing external. */
export interface Freigabe { kanal: string; zweck: string; proTag: number; bis?: string; belegt: string }

/** Mail transport (injectable for tests). Returns the Message-ID. */
export type MailSender = (m: { an: string; betreff: string; text: string; html?: string }) => Promise<string>;
/** Returns earlier mails from the Sent folder to this domain ("YYYY-MM-DD addr"); empty = never written. */
export type GesendetPruefer = (domain: string) => Promise<string[]>;

export function gesendetPrueferFromEnv(): GesendetPruefer | undefined {
  const cfg = imapConfigFromEnv();
  return cfg ? (d) => gesendetAnDomain(cfg, d) : undefined;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Approved plain text → simple HTML paragraphs (links clickable) + the Gmail signature HTML. */
export function partnerHtml(text: string, signaturHtml: string): string {
  const paras = text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`);
  return `<div dir="ltr">${paras.join("")}${signaturHtml}</div>`;
}

export function smtpSenderFromEnv(): MailSender | undefined {
  const user = process.env.SALES_SMTP_USER ?? process.env.SALES_IMAP_USER;
  const pass = process.env.SALES_SMTP_PASS ?? process.env.SALES_IMAP_PASS;
  if (!user || !pass) return undefined;
  return async (m) => {
    const mod = "nodemailer";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodemailer = (await import(mod)) as any;
    const t = (nodemailer.default ?? nodemailer).createTransport({
      host: process.env.SALES_SMTP_HOST ?? "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
      connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000,
    });
    try {
      const info = await t.sendMail({ from: `Ted Osammor <${user}>`, to: m.an, subject: m.betreff, text: m.text, ...(m.html ? { html: m.html } : {}) });
      return String(info.messageId ?? "");
    } finally { t.close(); }
  };
}

export class SalesSystem {
  readonly approvals: ApprovalQueue;
  /** Letzter Stand des Content-Loop-Schritts (für AUFGABEN.md). */
  contentStand = "";
  constructor(readonly store: SalesStore, readonly cfg: Config, readonly sendMail: MailSender | undefined = undefined, readonly gesendetPruefer: GesendetPruefer | undefined = undefined) {
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
    const extra: string[] = [];
    try { const { ziele } = this.partnerZiele(); if (ziele.length) extra.push(partnerAbschnitt(ziele, this.store.read<PartnerBestand>("partner.json", {}))); } catch (e) { extra.push(`## Partner\n\nnicht lesbar: ${(e as Error).message}`); }
    try { extra.push(this.kanaeleText(states)); } catch (e) { extra.push(`## Kanäle\n\nnicht lesbar: ${(e as Error).message}`); }
    writeFileSync(join(this.store.dir, "AUFGABEN.md"), [md, ...extra].join("\n\n") + "\n", { mode: 0o600 });
  }

  // ── partner / channels helpers ───────────────────────────────────────
  partnerZiele(): { ziele: PartnerZiel[]; verworfen: number } {
    return ladeZiele(this.store.read<unknown>("partner-ziele.json", []));
  }

  igKontakte(): IgKontakt[] {
    const p = join(this.cfg.igRuntime, "growth", "ig-akquise.json");
    if (!existsSync(p)) return [];
    const b = JSON.parse(readFileSync(p, "utf8")) as { kontakte?: Record<string, IgKontakt> };
    return Object.values(b.kontakte ?? {});
  }

  /** Plain IG answers (kontaktErbeten false) without a later confirmed request from the same handle. */
  igAntwortenOhneKontaktwunsch(): number {
    const evs = Object.values(this.store.events()).filter((e) => e.origin === "instagram" && e.kind === "reply");
    const bestaetigt = new Set(evs.filter((e) => e.kontaktErbeten === true).map((e) => e.account));
    return evs.filter((e) => e.kontaktErbeten === false && !bestaetigt.has(e.account)).length;
  }

  private readGrowth<T>(file: string): T | undefined {
    const p = join(this.cfg.igRuntime, "growth", "eingang", file);
    try { return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : undefined; } catch { return undefined; }
  }

  kanaeleText(states: AccountState[]): string {
    const drafted = this.store.read<Record<string, string>>("ig-entwuerfe.json", {});
    const pendingIds = new Set(this.approvals.pending().map((a) => a.goalId));
    return kanaeleAbschnitt({
      igKontakte: this.igKontakte(),
      igOffeneEntwuerfe: Object.values(drafted).filter((g) => pendingIds.has(g)).length,
      igAntwortenOhneKontaktwunsch: this.igAntwortenOhneKontaktwunsch(),
      igFunnel: igFunnel(this.igKontakte(), states),
      ...(this.readGrowth<MetaZahlen>("meta.json") ? { meta: this.readGrowth<MetaZahlen>("meta.json") } : {}),
      ...(this.readGrowth<MetaAdsStand>("meta-ads.json") ? { metaAds: this.readGrowth<MetaAdsStand>("meta-ads.json") } : {}),
      metaLeadsHinweis: "kein Meta-Leadformular angebunden (braucht Seiten-Token mit leads_retrieval); Leads aus Export per Spool möglich",
      ...(this.store.jobs().growth?.lastResult ? { growthLauf: this.store.jobs().growth?.lastResult } : {}),
    }) + (this.contentStand ? `\n\n**Content (Redaktionsplan)**\n- ${this.contentStand}\n- Fällige Posts: \`npm run content -- ig-faellig\`, danach \`content -- veroeffentlicht <pubId> --url …\`` : "");
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
      { name: "instagram", schedule: { every: 15 }, run: async ({ now }) => this.jobInstagram(now) },
      { name: "partner", schedule: { at: { hour: 8, minute: 15 }, days: [1, 2, 3, 4, 5] }, run: async ({ now }) => this.jobPartner(now) },
      { name: "partner-versand", schedule: { every: 15 }, run: ({ now }) => this.jobPartnerVersand(now) },
      { name: "growth", schedule: { at: { hour: 8, minute: 0 }, days: [1, 2, 3, 4, 5, 6, 7] }, run: ({ now }) => this.jobGrowth(now) },
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
      // Partner replies (verband/großhandel/…): never leads — tracked in partner.json.
      const { ziele } = this.partnerZiele();
      if (ziele.length && mails.length) {
        const bestand = this.store.read<PartnerBestand>("partner.json", {});
        const hit = partnerAntworten(mails, ziele, bestand, now.toISOString());
        if (hit.length) { this.store.write("partner.json", bestand); imap += ` · Partner-Antwort: ${hit.join(", ")}`; }
      }
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

  /** Instagram replies (recorded by the IG-Runde session via `sales -- ig-antwort`) → DM answer drafts. */
  jobInstagram(now: Date): string {
    const drafted = this.store.read<Record<string, string>>("ig-entwuerfe.json", {});
    let neu = 0;
    for (const e of Object.values(this.store.events())) {
      // Drafts only for confirmed contact requests (and historical replies without the flag).
      if (e.origin !== "instagram" || e.kind !== "reply" || e.kontaktErbeten === false || drafted[e.id]) continue;
      const a = igAntwortFreigabe(e);
      this.approvals.enqueue(a);
      drafted[e.id] = a.goalId;
      neu++;
    }
    if (neu) this.store.write("ig-entwuerfe.json", drafted);
    const k = this.igKontakte();
    // Content-Bibliothek: freigegebene Wochenpläne übernehmen, fällige IG-Posts melden.
    // Fehler hier dürfen die DM-Verarbeitung nie stoppen.
    let content = "";
    if (this.cfg.contentDir) try { content = " · " + contentLoopSchritt(new ContentStore(this.cfg.contentDir), this.approvals.all(), now).text; }
    catch (e) { content = ` · Content: Fehler ${(e as Error).message.slice(0, 120)}`; }
    this.contentStand = content.replace(/^ · /, "");
    this.converge(now);
    return `Instagram: ${k.length} Firmen im Bestand, ${Object.keys(drafted).length} Antworten erfasst, +${neu} Antwortentwürfe in Freigabe${content}`;
  }

  /** Partner first-contact drafts → approval queue. Sends nothing. */
  jobPartner(now: Date): string {
    const { ziele, verworfen } = this.partnerZiele();
    if (!ziele.length) return "Partner: keine recherchierten Ziele (partner-ziele.json leer)";
    const bestand = this.store.read<PartnerBestand>("partner.json", {});
    const heute = naechsteEntwuerfe(ziele, bestand, this.cfg.partnerPerDay);
    for (const z of heute) {
      const a = partnerFreigabe(z);
      this.approvals.enqueue(a);
      bestand[z.id] = { ...(bestand[z.id] ?? {}), id: z.id, status: "entwurf", seit: now.toISOString(), entwurfGoalId: a.goalId };
    }
    this.store.write("partner.json", bestand);
    this.converge(now);
    return `Partner: ${heute.length} Entwürfe in Freigabe (${heute.map((z) => z.name).join(", ") || "—"}) · ${ziele.length} Ziele${verworfen ? `, ${verworfen} ohne Beleg verworfen` : ""} · nichts gesendet`;
  }

  /**
   * Sends APPROVED partner first-contact mails: only with a documented channel
   * approval (freigaben.json partner_mail/erstkontakt, volume per day), only
   * the exact approved text, only once per partner, Mon–Fri 09–17 Berlin.
   * Status goes to "sendet" BEFORE the SMTP call, so a crash never re-sends.
   */
  async jobPartnerVersand(now: Date): Promise<string> {
    const p = berlinParts(now);
    if (p.weekday > 5 || p.hour < 9 || p.hour >= 17) return "Partner-Versand: außerhalb Mo–Fr 09–17 Uhr";
    const kanal = this.store.read<Freigabe[]>("freigaben.json", []).find((f) => f.kanal === PARTNER_KANAL && f.zweck === PARTNER_ZWECK);
    if (!kanal) return "Partner-Versand: keine Kanalfreigabe";
    const { ziele } = this.partnerZiele();
    const bestand = this.store.read<PartnerBestand>("partner.json", {});
    const approvals = new Map(this.approvals.all().map((a) => [a.goalId, a]));
    const kandidaten = ziele.filter((z) => bestand[z.id]?.status === "entwurf" && approvals.get(`sales:partner:${z.id}`)?.status === "approved");
    if (!kandidaten.length) return "Partner-Versand: nichts freigegeben";
    if (!this.sendMail) throw new Error("Partner-Versand: kein SMTP-Zugang (SALES_IMAP_USER/PASS)");
    if (!this.gesendetPruefer) throw new Error("Partner-Versand: keine Prüfung des Gesendet-Ordners möglich (IMAP) — kein Versand");
    // Gmail signature of ted@heyaudit.de (contains the closing). Runtime only — the repo is public.
    const sigHtmlPath = join(this.store.dir, "signatur.html");
    const sigTextPath = join(this.store.dir, "signatur.txt");
    if (!existsSync(sigHtmlPath) || !existsSync(sigTextPath)) return "Partner-Versand: Signatur fehlt (signatur.html/.txt im Runtime-Ordner) — nichts gesendet";
    const sigHtml = readFileSync(sigHtmlPath, "utf8");
    const sigText = readFileSync(sigTextPath, "utf8").trim();
    const snapDir = join(this.store.dir, "sperrlisten");
    const gesperrt = loadBlocklist(existsSync(snapDir) ? readdirSync(snapDir).map((f) => join(snapDir, f)) : []);
    const heute = berlinDay(now);
    const out: string[] = [];
    for (const z of kandidaten) {
      const used = this.store.readLines<{ day: string; kanal: string }>("ausgefuehrt.jsonl").filter((x) => x.day === heute && x.kanal === PARTNER_KANAL).length;
      const goalId = `sales:partner:${z.id}`;
      const mail = freigegebeneMail(approvals.get(goalId)?.description ?? "");
      const chk = darfPartnerSenden({ ziel: z, stand: bestand[z.id], freigabeStatus: approvals.get(goalId)?.status, mail, kanalFreigabe: kanal, heute, wochentag: p.weekday, heuteGesendet: used, gesperrt });
      if (!chk.ok || !mail) { out.push(`${z.id}: ${chk.warum}`); if (/Tagesvolumen/.test(chk.warum)) break; continue; }
      // Never write twice: Ted's own mails from ted@heyaudit.de count as contact.
      const dom = registrableDomain(mail.an);
      const frueher = dom ? await this.gesendetPruefer(dom) : ["Domain unklar"];
      if (frueher.length) {
        bestand[z.id] = { ...(bestand[z.id] as NonNullable<PartnerBestand[string]>), status: "kontaktiert", seit: now.toISOString(), notiz: `bereits angeschrieben (Gesendet): ${frueher.slice(0, 3).join(", ")}` };
        this.store.write("partner.json", bestand);
        out.push(`${z.id}: übersprungen, schon angeschrieben (${frueher[0]})`);
        continue;
      }
      bestand[z.id] = { ...(bestand[z.id] as NonNullable<PartnerBestand[string]>), status: "sendet", seit: now.toISOString() };
      this.store.write("partner.json", bestand);
      this.store.append("ausgefuehrt.jsonl", { day: heute, kanal: PARTNER_KANAL, zweck: PARTNER_ZWECK, ziel: z.id, an: mail.an, at: now.toISOString(), freigabe: kanal.belegt });
      const messageId = await this.sendMail({ an: mail.an, betreff: mail.betreff, text: `${mail.text}\n\n${sigText}`, html: partnerHtml(mail.text, sigHtml) });
      bestand[z.id] = { ...(bestand[z.id] as NonNullable<PartnerBestand[string]>), status: "kontaktiert", seit: new Date().toISOString(), gesendet: { at: new Date().toISOString(), an: mail.an, messageId } };
      this.store.write("partner.json", bestand);
      this.approvals.markImplemented(goalId);
      out.push(`${z.id}: gesendet an ${mail.an}`);
    }
    this.converge(now);
    return `Partner-Versand: ${out.join(" · ")}`;
  }

  /**
   * Growth-OS daily run (read-only): Meta numbers + Meta-Ads analysis, Thursday
   * the Instagram content plan (draft + approval), then the growth briefing.
   * Deliberately NOT growth:ausfuehren (publishing / campaign changes).
   */
  async jobGrowth(now: Date): Promise<string> {
    const rt = this.cfg.igRuntime;
    const steps: Array<[string, string[]]> = [
      ["meta", ["src/growth-os/meta-run.ts", "--runtime", rt]],
      ["meta-ads", ["src/growth-os/meta-ads-run.ts", "--runtime", rt]],
    ];
    if (berlinParts(now).weekday === 4) steps.push(["content", ["src/growth-os/content-run.ts", "--runtime", rt, "--marketing", join(homedir(), "Desktop", "TedOS", "Marketing", "heyaudit-instagram")]]);
    const ein = join(rt, "growth", "eingang");
    // Built lazily: the briefing must see the files the Meta steps just wrote.
    const briefing = () => {
      const a = ["src/growth-os/briefing-run.ts", "--runtime", rt];
      for (const f of ["aktivierung", "meta", "meta-ads"]) if (existsSync(join(ein, `${f}.json`))) a.push(`--${f}`, join(ein, `${f}.json`));
      return a;
    };
    steps.push(["briefing", []]);
    const out: string[] = [];
    for (const [name, fixed] of steps) {
      const args = name === "briefing" ? briefing() : fixed;
      try {
        await run(process.execPath, ["--import", "tsx", ...args], { cwd: ENGINE_DIR, timeout: 240_000, env: process.env, maxBuffer: 4_000_000 });
        out.push(`${name} ok`);
      } catch (e) {
        out.push(`${name} FEHLER ${((e as { stderr?: string }).stderr ?? (e as Error).message).split("\n").filter(Boolean).at(-1)?.slice(0, 120) ?? ""}`);
      }
    }
    if (out.some((x) => x.startsWith("briefing FEHLER"))) throw new Error(`Growth: ${out.join(" · ")}`);
    return `Growth (${berlinDay(now)}): ${out.join(" · ")} · nichts veröffentlicht`;
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
