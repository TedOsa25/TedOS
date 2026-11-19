// HeyAudit Sales CLI.
//
//   npm run sales -- tick [--job <name>]          scheduler tick (launchd, every 5 min)
//   npm run sales -- ingest <file.ndjson>         add events from an export (pilot format accepted)
//   npm run sales -- ergebnis --konto <id|mail|firma> --ergebnis demo_held|no_show|won|lost
//                              [--fit yes|no] [--naechster-schritt "…"] [--faellig YYYY-MM-DD] [--wert 1188]
//                              [--herkunft "…"] [--suchfrage "…"]
//   npm run sales -- erledigt <aufgabe>
//   npm run sales -- aufgaben | status | konten
//   npm run sales -- pause [<job>] | weiter [<job>] | reset <job>
//   npm run sales -- webhook [--port 4610]        local receiver (HMAC, writes spool)
//   npm run sales -- ig-antwort --handle <h> --text "…" [--name "…"] [--at ISO]   IG-Runde: Antwort erfassen
//   npm run sales -- ig-gesendet <goalId>         IG-Runde: freigegebene Antwort wurde gesendet
//   npm run sales -- partner [<id> <status>]      Partnerliste / Status setzen (gespraech|partner|abgesagt|gesperrt|kontaktiert)
//   npm run sales -- freigaben                    offene Entwürfe in der Sales-Freigabe
//   npm run sales -- entwurf <goalId> | freigeben <goalId> | ablehnen <goalId>   (nur auf Teds Wort)
//
// State dir: SALES_STATE_DIR (default ~/dev/tedos-runtime/heyaudit-sales). HeyAudit only.

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { berlinDay, fromPilotEvent, normalizeEmail, validateEvent, type SalesEvent } from "./model.js";
import { setPaused, resetJob, tick } from "./scheduler.js";
import { LockBusyError, SalesStore } from "./store.js";
import { configFromEnv, gesendetPrueferFromEnv, SalesSystem, smtpSenderFromEnv } from "./system.js";
import { igAntwortEreignis, normHandle, pruefeIgAntwort } from "./kanaele.js";
import type { PartnerBestand, PartnerStatus } from "./partner.js";

const STATE = process.env.SALES_STATE_DIR ?? join(homedir(), "dev", "tedos-runtime", "heyaudit-sales");

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseLine(line: string): SalesEvent {
  const raw = JSON.parse(line) as Record<string, unknown>;
  // Pilot format (f42a6f7): {id, account, kind, at, source, fit, evidence}
  return "origin" in raw ? validateEvent(raw) : fromPilotEvent(raw);
}

async function main(): Promise<void> {
  const [cmd = "status", ...args] = process.argv.slice(2);
  if (process.env.REVENUE_BRAND && process.env.REVENUE_BRAND !== "heyaudit") throw new Error("Sales-System ist nur für HeyAudit (REVENUE_BRAND≠heyaudit)");
  const store = new SalesStore(STATE);
  const sys = new SalesSystem(store, configFromEnv(), smtpSenderFromEnv(), gesendetPrueferFromEnv());
  const now = new Date();

  switch (cmd) {
    case "tick": {
      try {
        const recs = await store.withLock(() => tick(store, sys.jobs(), now, arg(args, "--job")));
        for (const r of recs) console.log(`${r.startedAt} ${r.job} ${r.outcome} ${r.durationMs}ms${r.commit ? ` @${r.commit}` : ""} ${r.result ?? r.error ?? ""}`);
        if (!recs.length) console.log(`${now.toISOString()} tick: nichts fällig`);
      } catch (e) {
        if (e instanceof LockBusyError) {
          store.append("runs.jsonl", { job: "*", runId: "-", startedAt: now.toISOString(), durationMs: 0, outcome: "skipped", result: e.message, trigger: "schedule" });
          console.log(`${now.toISOString()} übersprungen: ${e.message}`);
          return;
        }
        throw e;
      }
      return;
    }
    case "ingest": {
      const file = args[0];
      if (!file) throw new Error("Pfad zur NDJSON-Datei fehlt");
      const events = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()).map(parseLine);
      console.log(store.withLock(() => sys.ingest(events, now)));
      return;
    }
    case "ergebnis": {
      const konto = arg(args, "--konto");
      const kind = arg(args, "--ergebnis") as SalesEvent["kind"] | undefined;
      if (!konto || !kind || !["demo_held", "no_show", "won", "lost"].includes(kind)) throw new Error("--konto und --ergebnis demo_held|no_show|won|lost sind Pflicht");
      const st = findAccount(sys, konto);
      const meeting = [...st.meetings].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      const fit = arg(args, "--fit");
      const ev: Record<string, unknown> = {
        // One entry per account+outcome+meeting: re-entering the same result is a no-op.
        id: `manual:${kind}:${st.account.id}:${meeting?.id ?? berlinDay(now)}`,
        kind, at: now.toISOString(), origin: "manual", account: undefined,
        email: st.email, company: st.account.name,
        ...(meeting ? { meetingId: meeting.id } : {}),
        ...(fit ? { fit } : {}),
        ...(arg(args, "--naechster-schritt") ? { nextStep: arg(args, "--naechster-schritt") } : {}),
        ...(arg(args, "--faellig") ? { nextStepDue: `${arg(args, "--faellig")}T09:00:00+01:00` } : {}),
        ...(arg(args, "--wert") ? { valueEur: arg(args, "--wert") } : {}),
        ...(arg(args, "--herkunft") ? { statedOrigin: arg(args, "--herkunft"), source: arg(args, "--herkunft") } : {}),
        ...(arg(args, "--suchfrage") ? { searchQuery: arg(args, "--suchfrage") } : {}),
      };
      // Bind to the account through its strongest key.
      const key = st.account.keys.find((k) => k.startsWith("dom:")) ?? st.account.keys.find((k) => k.startsWith("mail:"));
      if (key?.startsWith("dom:")) ev.website = key.slice(4);
      console.log(store.withLock(() => sys.ingest([validateEvent(ev)], now)));
      return;
    }
    case "erledigt": {
      const id = args[0];
      store.withLock(() => {
        const tasks = store.tasks();
        const t = id ? tasks[id] : undefined;
        if (!t) throw new Error(`Aufgabe ${id} nicht gefunden`);
        t.status = "done"; t.updatedAt = now.toISOString(); t.closedReason = "von Ted erledigt";
        store.saveTasks(tasks);
        if (t.approvalGoalId) sys.approvals.markImplemented(t.approvalGoalId);
      });
      console.log(`erledigt: ${id}`);
      return;
    }
    case "aufgaben": {
      store.withLock(() => sys.converge(now));
      console.log(readFileSync(join(STATE, "AUFGABEN.md"), "utf8"));
      return;
    }
    case "konten": {
      for (const st of sys.states().filter((s) => s.lead || args.includes("--alle"))) {
        console.log(`${st.account.id} · ${st.account.name} · lead=${st.lead} · quelle=${st.source} · fit=${st.q.fit} · absicht=${st.q.intent} · ${st.account.events.map((e) => e.kind).join(",")}`);
      }
      return;
    }
    case "status": {
      store.withLock(() => sys.jobMonitor(now));
      console.log(readFileSync(join(STATE, "STATUS.md"), "utf8"));
      const runs = store.runs().slice(-10);
      for (const r of runs) console.log(`${r.startedAt} ${r.job} ${r.outcome} ${r.result ?? r.error ?? ""}`.slice(0, 220));
      return;
    }
    case "pause":
    case "weiter": {
      const job = args[0];
      if (!job) {
        if (cmd === "pause") writeFileSync(join(STATE, "PAUSE"), now.toISOString()); else rmSync(join(STATE, "PAUSE"), { force: true });
        console.log(cmd === "pause" ? "global pausiert" : "global fortgesetzt");
      } else {
        setPaused(store, job, cmd === "pause");
        console.log(`${job}: ${cmd === "pause" ? "pausiert" : "fortgesetzt"}`);
      }
      return;
    }
    case "reset": {
      if (!args[0]) throw new Error("Job fehlt");
      resetJob(store, args[0]);
      console.log(`${args[0]}: Dead-Letter/Retry zurückgesetzt`);
      return;
    }
    case "webhook": {
      const secret = process.env.SALES_WEBHOOK_SECRET;
      if (!secret) throw new Error("SALES_WEBHOOK_SECRET fehlt");
      const port = Number(arg(args, "--port") ?? 4610);
      const spool = join(STATE, "eingang");
      mkdirSync(spool, { recursive: true, mode: 0o700 });
      createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/sales/event") { res.writeHead(404).end(); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (c: Buffer) => { size += c.length; if (size > 256_000) req.destroy(); else chunks.push(c); });
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          const sig = String(req.headers["x-sales-signature"] ?? "");
          const want = createHmac("sha256", secret).update(body).digest("hex");
          if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) { res.writeHead(401).end(); return; }
          try {
            const ev = validateEvent({ ...JSON.parse(body.toString("utf8")), origin: "webhook" });
            const tmp = join(spool, `.${ev.id.replace(/[^\w.-]/g, "_")}.tmp`);
            writeFileSync(tmp, JSON.stringify(ev) + "\n", { mode: 0o600 });
            renameSync(tmp, join(spool, `${Date.now()}-${ev.id.replace(/[^\w.-]/g, "_")}.json`));
            res.writeHead(202).end("angenommen");
            // Event-driven: process immediately; if a run holds the lock, the next tick picks it up.
            void store.withLock(() => tick(store, sys.jobs(), new Date(), "inbound")).catch(() => undefined);
          } catch (e) {
            res.writeHead(400).end((e as Error).message);
          }
        });
      }).listen(port, "127.0.0.1", () => console.log(`Webhook-Empfänger auf 127.0.0.1:${port}/sales/event`));
      return;
    }
    case "ig-antwort": {
      const a = pruefeIgAntwort({ handle: arg(args, "--handle"), text: arg(args, "--text"), name: arg(args, "--name"), at: arg(args, "--at") ?? now.toISOString() });
      if (!a) throw new Error("--handle und --text sind Pflicht (Handle ohne @, Zeit als ISO)");
      const k = sys.igKontakte().find((x) => normHandle(x.handle) === a.handle);
      const ev = igAntwortEreignis(a, k);
      console.log(store.withLock(() => { const r = sys.ingest([ev], now); sys.jobInstagram(now); return `${ev.id} · ${r}`; }));
      return;
    }
    case "ig-gesendet": {
      const g = args[0];
      const e = sys.approvals.all().find((x) => x.goalId === g);
      if (!e || !g?.startsWith("sales:ig-antwort:")) throw new Error(`Kein IG-Antwortentwurf ${g ?? ""}`);
      if (e.status !== "approved") throw new Error(`Entwurf ist nicht freigegeben (Status ${e.status}) — nicht senden`);
      store.withLock(() => sys.approvals.markImplemented(g));
      console.log(`gesendet vermerkt: ${g}`);
      return;
    }
    case "partner": {
      const { ziele, verworfen } = sys.partnerZiele();
      const [id, status] = args;
      if (id && status) {
        const ok: PartnerStatus[] = ["kontaktiert", "gespraech", "partner", "abgesagt", "gesperrt"];
        if (!ok.includes(status as PartnerStatus)) throw new Error(`Status ${status} unbekannt (${ok.join("|")})`);
        if (!ziele.some((z) => z.id === id)) throw new Error(`Partner ${id} nicht in partner-ziele.json`);
        store.withLock(() => {
          const b = store.read<PartnerBestand>("partner.json", {});
          b[id] = { ...(b[id] ?? { id }), id, status: status as PartnerStatus, seit: now.toISOString() };
          store.write("partner.json", b);
          sys.converge(now);
        });
        console.log(`${id}: ${status}`);
        return;
      }
      const b = store.read<PartnerBestand>("partner.json", {});
      for (const z of ziele) console.log(`${z.prioritaet} · ${z.id} · ${z.typ} · ${b[z.id]?.status ?? "recherchiert"} · ${z.name} · ${z.kontakt ?? "—"}`);
      console.log(`${ziele.length} Ziele${verworfen ? `, ${verworfen} verworfen (ohne Beleg)` : ""}`);
      return;
    }
    case "smtp-pruefen": {
      // Login check only — sends nothing.
      const user = process.env.SALES_SMTP_USER ?? process.env.SALES_IMAP_USER;
      const pass = process.env.SALES_SMTP_PASS ?? process.env.SALES_IMAP_PASS;
      if (!user || !pass) throw new Error("kein SMTP-Zugang");
      const mod = "nodemailer";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nm = (await import(mod)) as any;
      const t = (nm.default ?? nm).createTransport({ host: process.env.SALES_SMTP_HOST ?? "smtp.gmail.com", port: 465, secure: true, auth: { user, pass }, connectionTimeout: 15000 });
      await t.verify();
      t.close();
      console.log(`SMTP-Login ok (${user}), nichts gesendet`);
      return;
    }
    case "freigeben":
    case "ablehnen": {
      const g = args[0];
      const e = sys.approvals.all().find((x) => x.goalId === g);
      if (!e) throw new Error(`Kein Eintrag ${g ?? ""}`);
      if (e.status !== "pending") throw new Error(`${g} ist schon ${e.status}`);
      store.withLock(() => (cmd === "freigeben" ? sys.approvals.approve(g as string) : sys.approvals.reject(g as string)));
      console.log(`${g}: ${cmd === "freigeben" ? "freigegeben" : "abgelehnt"}`);
      return;
    }
    case "entwurf": {
      const e = sys.approvals.all().find((x) => x.goalId === args[0]);
      if (!e) throw new Error(`Kein Eintrag ${args[0] ?? ""}`);
      console.log(`${e.title} [${e.status}]\n\n${e.description}`);
      return;
    }
    case "freigaben": {
      for (const e of sys.approvals.pending()) console.log(`${e.goalId} · ${e.title}`);
      console.log(`${sys.approvals.pending().length} offen · Freigeben: Datei approvals/ oder Freigabe-Seite`);
      return;
    }
    default:
      throw new Error(`Unbekannter Befehl ${cmd}`);
  }
}

function findAccount(sys: SalesSystem, q: string) {
  const states = sys.states();
  const mail = normalizeEmail(q);
  const needle = q.toLowerCase();
  const hits = states.filter((s) => s.account.id === q || s.account.keys.includes(q)
    || (mail && s.account.keys.includes(`mail:${mail}`))
    || s.account.name.toLowerCase().includes(needle));
  if (hits.length !== 1) throw new Error(hits.length ? `Mehrdeutig: ${hits.map((h) => h.account.id).join(", ")}` : `Kein Konto für „${q}“`);
  return hits[0] as (typeof states)[number];
}

main().catch((e) => {
  console.error(`FEHLER: ${(e as Error).message}`);
  process.exitCode = 1;
});

