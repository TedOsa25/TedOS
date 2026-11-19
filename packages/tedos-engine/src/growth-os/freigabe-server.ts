// Freigabe-Seite des Growth OS: offene Vorschlaege lesen, freigeben, ablehnen.
//
//   npm run growth:freigabe            # dann http://127.0.0.1:4600 oeffnen
//   GROWTH_FREIGABE_PORT=4601 npm run growth:freigabe
//
// Nur 127.0.0.1, keine Abhaengigkeiten. Setzt ausschliesslich den Status in
// der Growth-Warteschlange (<runtime>/growth/approval-queue.json) und
// protokolliert die Entscheidung. Fuehrt NICHTS aus: Veroeffentlichen,
// Kampagnen oder Budgets laufen getrennt und lesen nur freigegebene Eintraege.

import { homedir } from "node:os";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApprovalQueue, type ApprovalEntry } from "../approval-queue.js";
import { JsonFileStorage, type Storage } from "../storage.js";
import type { Wochenplan } from "./content-plan.js";
import { SignalLog, signal } from "./signal.js";

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Zu einem Vorschlag gehoerige Details (z. B. der Wochenplan), falls vorhanden. */
export function details(growthDir: string, e: ApprovalEntry): Wochenplan | null {
  const m = /^growth:content:ig-(\d{4})-kw(\d{2})$/.exec(e.goalId);
  if (!m) return null;
  const datei = join(growthDir, "content", `plan-${m[1]}-kw${m[2]}.json`);
  return existsSync(datei) ? (JSON.parse(readFileSync(datei, "utf8")) as Wochenplan) : null;
}

function planHtml(p: Wochenplan): string {
  return p.eintraege
    .map(
      (e) => `<div class="post"><div class="kopf"><b>${esc(e.wochentag)} ${esc(e.datum)}, ${esc(e.uhrzeit)}</b> · ${e.art === "feed" ? "Post" : "Story"} · ${esc(e.motiv.titel)}</div>
<div class="zeile">${esc(e.motiv.schlagzeile)}</div>
<pre>${esc(e.beitragstext)}</pre>
<div class="klein">Bild: <a href="${esc(e.motiv.quelle.canvas)}" target="_blank" rel="noopener">Canvas öffnen</a>, Artboard <code>${esc(e.motiv.quelle.artboard)}</code> · Link: <code>${esc(e.link)}</code></div>
${e.befunde.map((b) => `<div class="${b.stufe}">${b.stufe === "fehler" ? "Fehler" : "Hinweis"}: ${esc(b.text)}</div>`).join("")}</div>`,
    )
    .join("");
}

/** Rein: die ganze Seite. */
export function renderSeite(eintraege: { e: ApprovalEntry; plan: Wochenplan | null }[], entschieden: ApprovalEntry[]): string {
  const offen = eintraege.length
    ? eintraege
        .map(
          ({ e, plan }) => `<section><h2>${esc(e.title)}</h2>
<p class="klein">${esc(e.goalId)} · seit ${esc(e.createdAt.slice(0, 16).replace("T", " "))} · Risiko ${esc(e.risk)}</p>
<p>${esc(e.description)}</p>
${plan ? planHtml(plan) : ""}
<form method="post" action="/entscheiden"><input type="hidden" name="goalId" value="${esc(e.goalId)}">
<button name="aktion" value="freigeben" class="ja">Freigeben</button>
<button name="aktion" value="ablehnen" class="nein">Ablehnen</button></form></section>`,
        )
        .join("")
    : "<p>Keine offenen Vorschläge.</p>";
  const zuletzt = entschieden
    .slice(-10)
    .reverse()
    .map((e) => `<li>${e.status === "approved" ? "Freigegeben" : e.status === "rejected" ? "Abgelehnt" : esc(e.status)}: ${esc(e.title)} <span class="klein">(${esc((e.decidedAt ?? "").slice(0, 16).replace("T", " "))})</span></li>`)
    .join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Growth-Freigaben</title>
<style>
body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#0f1115;background:#F5F4F2}
section{background:#fff;border-radius:14px;padding:16px 20px;margin:16px 0}
.post{border-top:1px solid #EBE9E4;padding:12px 0}
pre{white-space:pre-wrap;font:14px/1.45 inherit;background:#F5F4F2;padding:10px;border-radius:8px}
.klein{font-size:13px;color:#57534E}.fehler{color:#b91c1c;font-weight:600}.hinweis{color:#92400e}
button{font:inherit;font-weight:600;padding:12px 22px;border-radius:10px;border:0;margin-right:8px;cursor:pointer;min-height:44px}
.ja{background:#F7D447;color:#0f1115}.nein{background:#EBE9E4;color:#0f1115}
</style></head><body>
<h1>Growth-Freigaben</h1>
<p class="klein">Freigeben setzt nur den Status. Ausgeführt wird erst von den jeweiligen Agenten, und nur, was hier freigegeben ist.</p>
${offen}
${zuletzt ? `<h2>Zuletzt entschieden</h2><ul>${zuletzt}</ul>` : ""}
</body></html>`;
}

function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((ok) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => ok(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", () => ok({}));
  });
}

export function createFreigabeServer(opt: { growthDir: string; storage?: Storage; jetzt?: () => Date }): Server {
  const jetzt = opt.jetzt ?? (() => new Date());
  const queue = () => new ApprovalQueue(opt.storage ?? new JsonFileStorage(opt.growthDir));
  return createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "")) {
      const q = queue();
      const html = renderSeite(
        q.pending().map((e) => ({ e, plan: details(opt.growthDir, e) })),
        q.all().filter((e) => e.status === "approved" || e.status === "rejected"),
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "POST" && req.url === "/entscheiden") {
      const f = await readForm(req);
      const q = queue();
      const e = q.pending().find((x) => x.goalId === f.goalId);
      if (!e || (f.aktion !== "freigeben" && f.aktion !== "ablehnen")) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Unbekannter oder schon entschiedener Vorschlag.");
        return;
      }
      if (f.aktion === "freigeben") q.approve(e.goalId);
      else q.reject(e.goalId);
      new SignalLog(join(opt.growthDir, "signale.jsonl")).anhaengen([
        signal(
          {
            von: "orchestrator",
            art: f.aktion === "freigeben" ? "freigabe.erteilt" : "freigabe.abgelehnt",
            modus: "execute_safe",
            betreff: e.title,
            daten: { goalId: e.goalId },
            belege: [],
          },
          jetzt(),
        ),
      ]);
      res.writeHead(303, { location: "/" });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

if (process.argv[1]?.endsWith("freigabe-server.ts")) {
  const runtime = resolve(process.env.GROWTH_RUNTIME ?? join(homedir(), "dev", "heyaudit-ig-runtime"));
  const port = Number(process.env.GROWTH_FREIGABE_PORT ?? 4600);
  createFreigabeServer({ growthDir: join(runtime, "growth") }).listen(port, "127.0.0.1", () => {
    console.log(`Growth-Freigaben → http://127.0.0.1:${port}`);
    console.log("Setzt nur den Status. Es wird nichts veröffentlicht oder ausgegeben.");
  });
}
