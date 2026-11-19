// Partner, Instagram and Meta channel tests (offline, deterministic).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { RawMail } from "./inbound.js";
import { igAntwortEreignis, igFunnel, metaLeadEreignis, pruefeIgAntwort } from "./kanaele.js";
import { ladeZiele, naechsteEntwuerfe, partnerAntworten, partnerEntwurf, type PartnerBestand } from "./partner.js";
import { SalesStore } from "./store.js";
import { SalesSystem } from "./system.js";

const T0 = new Date("2026-11-19T07:20:00Z"); // Thursday 08:20 Berlin

function fresh(igRuntime = "/nonexistent-ig"): SalesSystem {
  const dir = mkdtempSync(join(tmpdir(), "sales-kanal-"));
  return new SalesSystem(new SalesStore(dir), { capacity: 6, researchLimit: 10, blocklists: [], igRuntime, partnerPerDay: 2 });
}

const ZIELE = [
  { id: "biv", name: "Bundesinnungsverband des Gebäudereiniger-Handwerks", typ: "verband", website: "https://www.die-gebaeudedienstleister.de", warum: "Dachverband der Innungen", kontakt: "info@die-gebaeudedienstleister.de", beleg: "https://www.die-gebaeudedienstleister.de/kontakt", prioritaet: 1, sicherheit: "high" },
  { id: "igefa", name: "igefa", typ: "grosshandel", website: "https://www.igefa.de", warum: "Großhandel für Reinigungsbedarf", kontakt: "https://www.igefa.de/kontakt", beleg: "https://www.igefa.de/", prioritaet: 1, sicherheit: "high" },
  { id: "fachblatt", name: "Fachblatt", typ: "medien", website: "https://fachblatt.example", warum: "Leser sind Gebäudereiniger", kontakt: "redaktion@fachblatt.example", beleg: "https://fachblatt.example/mediadaten", prioritaet: 2 },
  { id: "ohne-beleg", name: "Ohne Beleg GmbH", typ: "grosshandel", website: "https://x.example", warum: "?" },
  { id: "falscher-typ", name: "Bank", typ: "bank", website: "https://bank.example", warum: "?", beleg: "https://bank.example" },
];

test("partner targets: only sourced entries survive; drafts by priority, never twice", () => {
  const { ziele, verworfen } = ladeZiele(ZIELE);
  assert.equal(ziele.length, 3);
  assert.equal(verworfen, 2);
  assert.equal(ziele.find((z) => z.id === "igefa")?.kontaktArt, "formular");
  const b: PartnerBestand = {};
  const first = naechsteEntwuerfe(ziele, b, 2).map((z) => z.id);
  assert.deepEqual(first, ["biv", "igefa"]);
  for (const id of first) b[id] = { id, status: "entwurf", seit: T0.toISOString() };
  assert.deepEqual(naechsteEntwuerfe(ziele, b, 2).map((z) => z.id), ["fachblatt"]);
  const e = partnerEntwurf(ziele[0]!);
  assert.match(e.text, /Guten Tag/);
  assert.match(e.text, /Vorteil für Ihre Mitgliedsbetriebe/);
  assert.equal(e.an, "info@die-gebaeudedienstleister.de");
});

test("partner job: drafts land in approval queue, nothing sent, no lead events, idempotent", () => {
  const s = fresh();
  s.store.write("partner-ziele.json", ZIELE);
  const r1 = s.jobPartner(T0);
  assert.match(r1, /2 Entwürfe/);
  assert.match(r1, /nichts gesendet/);
  const pend = s.approvals.pending().filter((a) => a.goalId.startsWith("sales:partner:"));
  assert.deepEqual(pend.map((a) => a.goalId).sort(), ["sales:partner:biv", "sales:partner:igefa"]);
  assert.ok(pend.every((a) => a.risk === "HIGH" && /nicht gesendet/.test(a.title)));
  // Next day: the third one, not the same two again.
  s.jobPartner(new Date(T0.getTime() + 86_400_000));
  assert.equal(s.approvals.pending().filter((a) => a.goalId.startsWith("sales:partner:")).length, 3);
  assert.equal(Object.keys(s.store.events()).length, 0, "partners never enter the lead ledger");
  assert.match(readFileSync(join(s.store.dir, "AUFGABEN.md"), "utf8"), /## Partner/);
});

test("partner reply from partner domain → status antwort, idempotent, not a lead", () => {
  const { ziele } = ladeZiele(ZIELE);
  const b: PartnerBestand = { biv: { id: "biv", status: "kontaktiert", seit: T0.toISOString() } };
  const m: RawMail = { messageId: "p1@x", from: "jemand@die-gebaeudedienstleister.de", subject: "AW: Kooperation", date: T0.toISOString(), text: "Gern, rufen Sie an." };
  const other: RawMail = { ...m, messageId: "p2@x", from: "kunde@glanz.de" };
  assert.deepEqual(partnerAntworten([m, other], ziele, b, T0.toISOString()), ["biv"]);
  assert.deepEqual(partnerAntworten([m], ziele, b, T0.toISOString()), [], "same Message-ID twice = no-op");
  assert.equal(b.biv?.status, "antwort");
  assert.equal(b.biv?.antworten?.length, 1);
});

test("instagram reply → lead (source instagram) + review task + exactly one DM draft", () => {
  const ig = mkdtempSync(join(tmpdir(), "ig-rt-"));
  mkdirSync(join(ig, "growth"), { recursive: true });
  writeFileSync(join(ig, "growth", "ig-akquise.json"), JSON.stringify({ kontakte: {
    "glanz.reinigung": { handle: "glanz.reinigung", name: "Glanz Reinigung", status: "angeschrieben", gefolgtAm: "2026-11-17T08:00:00Z", angeschriebenAm: "2026-11-18T08:00:00Z" },
    "b.clean": { handle: "b.clean", name: "B Clean", status: "gefolgt", gefolgtAm: "2026-11-18T09:00:00Z" },
  } }));
  const s = fresh(ig);
  const a = pruefeIgAntwort({ handle: "@Glanz.Reinigung", text: "Klingt gut, was kostet das für 12 Leute?", at: "2026-11-19T07:00:00Z" });
  assert.ok(a);
  const k = s.igKontakte().find((x) => x.handle === "glanz.reinigung");
  const e = igAntwortEreignis(a, k);
  assert.equal(e.campaign, "ig-dm-folgen");
  assert.match(s.ingest([e], T0), /\+1 neu/);
  assert.match(s.ingest([igAntwortEreignis(a, k)], T0), /1 doppelt/, "replay = duplicate");
  const st = s.states().find((x) => x.account.keys.includes("acct:ig:glanz.reinigung"));
  assert.ok(st?.lead);
  assert.equal(st?.source, "instagram");
  assert.ok(Object.values(s.store.tasks()).some((t) => t.type === "review_reply" && t.status === "open"));
  s.jobInstagram(T0);
  s.jobInstagram(T0);
  const drafts = s.approvals.all().filter((x) => x.goalId.startsWith("sales:ig-antwort:"));
  assert.equal(drafts.length, 1);
  assert.match(drafts[0]!.description, /was kostet das/);
  const f = igFunnel(s.igKontakte(), s.states());
  assert.equal(f[0]?.week, "2026-KW47");
  assert.deepEqual({ g: f[0]?.gefolgt, a: f[0]?.angeschrieben, antw: f[0]?.antworten, l: f[0]?.leads }, { g: 2, a: 1, antw: 1, l: 1 });
  assert.match(readFileSync(join(s.store.dir, "AUFGABEN.md"), "utf8"), /## Kanäle[\s\S]*Instagram/);
});

test("instagram input is validated (handle, text, time)", () => {
  assert.equal(pruefeIgAntwort({ handle: "x y", text: "hi", at: "2026-11-19T07:00:00Z" }), undefined);
  assert.equal(pruefeIgAntwort({ handle: "ok", text: "", at: "2026-11-19T07:00:00Z" }), undefined);
  assert.equal(pruefeIgAntwort({ handle: "ok", text: "hi", at: "gestern" }), undefined);
});

test("meta lead form lead → inquiry with source meta; incomplete lead skipped", () => {
  const e = metaLeadEreignis({ id: "991", created_time: "2026-11-19T06:00:00+0000", campaign_name: "meta-2026-kw47-umstieg", field_data: [{ name: "email", values: ["chef@sauber-gmbh.de"] }, { name: "company_name", values: ["Sauber GmbH"] }] });
  assert.equal(e?.kind, "inquiry");
  assert.equal(e?.source, "meta");
  assert.equal(e?.id, "meta-lead:991");
  assert.equal(metaLeadEreignis({ id: "992", created_time: "2026-11-19T06:00:00+0000", field_data: [{ name: "full_name", values: ["X"] }] }), undefined);
});

test("growth job never runs the publishing executor", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "system.ts"), "utf8");
  assert.ok(!/ausfuehren/.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "system.ts must not call growth:ausfuehren");
  const names = fresh().jobs().map((j) => j.name);
  for (const n of ["instagram", "partner", "growth"]) assert.ok(names.includes(n));
});

// ── Partner-Versand ─────────────────────────────────────────────────────
const MO_10 = new Date("2026-11-23T09:00:00Z"); // Monday 10:00 Berlin
function versandSys(sent: Array<{ an: string; betreff: string; text: string }>, fail = false) {
  const dir = mkdtempSync(join(tmpdir(), "sales-versand-"));
  const s = new SalesSystem(new SalesStore(dir), { capacity: 6, researchLimit: 10, blocklists: [], igRuntime: "/nonexistent-ig", partnerPerDay: 5 },
    async (m) => { if (fail) throw new Error("SMTP kaputt"); sent.push(m); return `<id${sent.length}@x>`; });
  s.store.write("partner-ziele.json", ZIELE);
  s.jobPartner(MO_10);
  return s;
}

test("partner mail: nothing without channel approval or single approval", async () => {
  const sent: Array<{ an: string; betreff: string; text: string }> = [];
  const s = versandSys(sent);
  assert.match(await s.jobPartnerVersand(MO_10), /keine Kanalfreigabe/);
  s.store.write("freigaben.json", [{ kanal: "partner_mail", zweck: "erstkontakt", proTag: 3, belegt: "Test" }]);
  assert.match(await s.jobPartnerVersand(MO_10), /nichts freigegeben/);
  assert.equal(sent.length, 0);
});

test("partner mail: approved email partner sent once with exact text; form partner never; volume cap", async () => {
  const sent: Array<{ an: string; betreff: string; text: string }> = [];
  const s = versandSys(sent);
  s.store.write("freigaben.json", [{ kanal: "partner_mail", zweck: "erstkontakt", proTag: 1, belegt: "Test" }]);
  s.approvals.approve("sales:partner:biv");
  s.approvals.approve("sales:partner:igefa");
  s.approvals.approve("sales:partner:fachblatt");
  const r = await s.jobPartnerVersand(MO_10);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.an, "info@die-gebaeudedienstleister.de");
  assert.match(sent[0]!.text, /^Guten Tag,/);
  assert.ok(!/---|Warum:|Beleg:/.test(sent[0]!.text), "internal notes are never sent");
  assert.match(r, /Tagesvolumen 1 erreicht/);
  await s.jobPartnerVersand(new Date(MO_10.getTime() + 3_600_000));
  assert.equal(sent.length, 1, "cap holds the same day; biv never twice");
  const r2 = await s.jobPartnerVersand(new Date(MO_10.getTime() + 86_400_000));
  assert.match(r2, /igefa: nur Kontaktformular/);
  assert.deepEqual(sent.map((m) => m.an), ["info@die-gebaeudedienstleister.de", "redaktion@fachblatt.example"]);
  const b = s.store.read<PartnerBestand>("partner.json", {});
  assert.equal(b.biv?.status, "kontaktiert");
  assert.equal(b.biv?.gesendet?.messageId, "<id1@x>");
  assert.equal(b.igefa?.status, "entwurf");
});

test("partner mail: weekend/night, blocklisted domain, SMTP crash never re-sends", async () => {
  const sent: Array<{ an: string; betreff: string; text: string }> = [];
  const s = versandSys(sent, true);
  s.store.write("freigaben.json", [{ kanal: "partner_mail", zweck: "erstkontakt", proTag: 3, belegt: "Test" }]);
  s.approvals.approve("sales:partner:biv");
  s.approvals.approve("sales:partner:fachblatt");
  assert.match(await s.jobPartnerVersand(new Date("2026-11-22T10:00:00Z")), /außerhalb/);
  mkdirSync(join(s.store.dir, "sperrlisten"), { recursive: true });
  writeFileSync(join(s.store.dir, "sperrlisten", "x.json"), JSON.stringify(["redaktion@fachblatt.example"]));
  await assert.rejects(s.jobPartnerVersand(MO_10), /SMTP kaputt/);
  const b = s.store.read<PartnerBestand>("partner.json", {});
  assert.equal(b.biv?.status, "sendet");
  assert.equal(b.fachblatt?.status, "entwurf");
  const r = await s.jobPartnerVersand(new Date(MO_10.getTime() + 600_000));
  assert.match(r, /fachblatt: Adresse\/Domain auf Sperrliste/);
  assert.ok(!/biv/.test(r), "a crashed send is not retried");
  assert.equal(sent.length, 0);
});
