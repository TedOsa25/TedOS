// Revenue Center — local approval UI (dependency-free, localhost only).
//
// The existing Sales/crm-heycarbo/revenue-center.html persists approvals to the
// browser's localStorage — they never reach the engine, so they cannot gate a
// send. THIS server closes that gap: Approve/Reject/Skip write to the SAME
// lead-status store that sendApprovedBatch() reads. Only then can a lead be sent.
//
// It only ever changes STATUS. It never sends — sending stays in
// sendApprovedBatch(), behind the master switch (REVENUE_SEND_ENABLED). Bind is
// 127.0.0.1 only; there is no external surface.
//
//   npm run approval:ui        # then open http://127.0.0.1:4599

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { Storage } from "./../storage.js";
import { createStorage } from "./../storage.js";
import type { Account } from "./accounts.js";
import { approveLeads, rejectLeads, skipLeads, leadReviewList, type LeadReviewRow } from "./batch-send.js";
import { lifecycleCounts } from "./reporting.js";

const esc = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface ApprovalServerOptions {
  storage?: Storage;
  accounts?: Account[];
  accountsPath?: string;
  limit?: number;
}

/** Read a JSON request body (small, bounded). */
function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

/** The approval page — server-rendered shell + embedded review data. */
function page(rows: LeadReviewRow[], counts: Record<string, number>): string {
  const data = JSON.stringify(rows).replace(/</g, "\\u003c");
  const countLine = Object.entries(counts).filter(([, n]) => n > 0).map(([s, n]) => `${s}: ${n}`).join(" · ") || "—";
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Revenue Center — Approval</title>
<style>
:root{--bg:#0e1116;--panel:#161b22;--line:#232a33;--txt:#e6edf3;--mut:#8b949e;--acc:#13A6A6;--ok:#238636;--no:#a1242f;--sk:#8a6d1a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 Inter,Arial,sans-serif}
header{padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
h1{font-size:16px;margin:0 0 4px}.mut{color:var(--mut);font-size:12px}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
button{background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer}
button:hover{border-color:var(--acc)}button.primary{background:var(--acc);border-color:var(--acc);color:#04211f;font-weight:600}
.wrap{padding:16px 20px;overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:900px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px}
.co{font-weight:600}.badge{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line)}
.b-approved{color:#7fd1c8;border-color:#1f5c56}.b-lost{color:#e0918f;border-color:#5c2b2b}.b-pending{color:#d9b25a;border-color:#5c4a1f}
.b-sent{color:#8ab4f8;border-color:#274268}.b-unsubscribed{color:#c98bd6;border-color:#4a2b52}.b-active{color:var(--mut)}
.act button{padding:4px 9px;margin-right:4px}
.ap{color:#7fd1c8}.rj{color:#e0918f}.sk{color:#d9b25a}
dialog{background:var(--panel);color:var(--txt);border:1px solid var(--line);border-radius:12px;width:min(680px,94vw);padding:0}
dialog header{position:static;border:0}iframe{width:100%;height:60vh;border:1px solid var(--line);border-radius:8px;background:#fff}
.note{background:#1c2530;border:1px solid var(--line);border-radius:8px;padding:8px 12px;color:var(--mut);font-size:12px;margin-top:10px}
</style></head><body>
<header>
  <h1>Revenue Center — Approval</h1>
  <div class="mut" id="counts">${esc(countLine)}</div>
  <div class="bar">
    <button class="primary" data-bulk="visible">Approve All Visible</button>
    <button data-bulk="top10">Approve Top 10</button>
    <button data-bulk="top20">Approve Top 20</button>
    <button data-bulk="selected">Approve Selected</button>
  </div>
  <div class="note">„Approve" setzt nur den Status. Der Versand erfolgt separat über <code>sendApprovedBatch()</code> und bleibt gated (<code>REVENUE_SEND_ENABLED</code>). Diese Seite sendet nie.</div>
</header>
<div class="wrap">
  <table><thead><tr>
    <th><input type="checkbox" id="all"></th><th>Firma</th><th>Ansprechpartner</th><th>E-Mail</th>
    <th>Branche</th><th>Prio</th><th>Betreff</th><th>Status</th><th>Aktion</th><th>Vorschau</th>
  </tr></thead><tbody id="rows"></tbody></table>
</div>
<dialog id="pv"><header style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)">
  <strong id="pvT"></strong><button onclick="pv.close()">✕</button></header>
  <div style="padding:14px 16px"><iframe id="pvF"></iframe></div></dialog>
<script>
const ROWS = ${data};
const BADGE = s => '<span class="badge b-'+s+'">'+s+'</span>';
function row(r){
  return '<tr data-id="'+r.accountId+'">'
    +'<td><input type="checkbox" class="sel"></td>'
    +'<td class="co">'+esc(r.company)+'</td><td>'+esc(r.contact||'—')+'</td><td>'+esc(r.email||'—')+'</td>'
    +'<td>'+esc(r.industry)+'</td><td>'+r.priority+'</td><td>'+esc(r.subject)+'</td>'
    +'<td class="st">'+BADGE(r.status)+'</td>'
    +'<td class="act"><button class="ap" data-a="approve">✓</button><button class="rj" data-a="reject">✗</button><button class="sk" data-a="skip">☐</button></td>'
    +'<td><button data-pv="'+r.accountId+'">Vorschau</button></td></tr>';
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
document.getElementById('rows').innerHTML = ROWS.map(row).join('');
function idsOf(sel){return [].map.call(document.querySelectorAll(sel),function(el){return el.closest('tr').getAttribute('data-id')});}
async function act(action, ids){
  if(!ids.length) return;
  const res = await fetch('/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:action,ids:ids})});
  const j = await res.json();
  (j.statuses||[]).forEach(function(s){ const tr=document.querySelector('tr[data-id="'+s.id+'"]'); if(tr) tr.querySelector('.st').innerHTML=BADGE(s.status); });
  if(j.counts) document.getElementById('counts').textContent = Object.keys(j.counts).filter(k=>j.counts[k]>0).map(k=>k+': '+j.counts[k]).join(' · ')||'—';
}
document.getElementById('rows').addEventListener('click',function(e){
  const a=e.target.getAttribute('data-a'); if(a){ act(a,[e.target.closest('tr').getAttribute('data-id')]); return; }
  const pv=e.target.getAttribute('data-pv'); if(pv){ const r=ROWS.find(x=>x.accountId===pv); document.getElementById('pvT').textContent=r.company; document.getElementById('pvF').srcdoc=r.emailHtml; document.getElementById('pv').showModal(); }
});
document.getElementById('all').addEventListener('change',function(e){ [].forEach.call(document.querySelectorAll('.sel'),function(c){c.checked=e.target.checked}); });
document.querySelectorAll('[data-bulk]').forEach(function(b){ b.onclick=function(){
  const k=b.getAttribute('data-bulk'); let ids;
  if(k==='visible') ids=ROWS.map(r=>r.accountId);
  else if(k==='top10') ids=ROWS.slice(0,10).map(r=>r.accountId);
  else if(k==='top20') ids=ROWS.slice(0,20).map(r=>r.accountId);
  else if(k==='selected') ids=idsOf('.sel:checked');
  act('approve', ids);
};});
</script></body></html>`;
}

/** Create (but do not start) the local approval server. */
export function createApprovalServer(opts: ApprovalServerOptions = {}): Server {
  const storage = opts.storage ?? createStorage();
  const reviewOpts = { ...(opts.accounts ? { accounts: opts.accounts } : {}), ...(opts.accountsPath ? { accountsPath: opts.accountsPath } : {}), ...(opts.limit ? { limit: opts.limit } : {}) };

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        const rows = leadReviewList(storage, reviewOpts);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page(rows, lifecycleCounts(storage)));
        return;
      }
      if (req.method === "POST" && req.url === "/api/action") {
        const body = await readJson(req);
        const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
        const action = body.action;
        if (action === "approve") approveLeads(storage, ids);
        else if (action === "reject") rejectLeads(storage, ids);
        else if (action === "skip") skipLeads(storage, ids);
        else { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "unknown action" })); return; }
        // Report back each affected lead's new status (unsubscribed leads are untouched).
        const rows = leadReviewList(storage, reviewOpts);
        const byId = new Map(rows.map((r) => [r.accountId, r.status]));
        const statuses = ids.map((id) => ({ id, status: byId.get(id) ?? "active" }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, statuses, counts: lifecycleCounts(storage) }));
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`error: ${(e as Error).message}`);
    }
  });
}
