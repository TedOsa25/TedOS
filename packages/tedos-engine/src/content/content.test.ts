import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ApprovalEntry } from "../approval-queue.js";
import { ERLAUBTE_PREISE } from "../growth-os/content-plan.js";
import type { SalesEvent } from "../sales/model.js";
import { accountState, resolveAccounts } from "../sales/rules.js";
import { darfLaufen, normalisiere, planeBatches, type Batch } from "./apify.js";
import { attribuiere, wochenbericht } from "./bericht.js";
import { FAKTEN } from "./fakten.js";
import { generiereVorrat, hookDubletten, SAMEN } from "./ideen.js";
import { anfrage, type Abruf } from "./http.js";
import { MetricoolClient, uebergebe, type Journal } from "./metricool.js";
import type { ReferenzAccount, VideoReferenz } from "./modell.js";
import { bewerteVideos, parseUtmCampaign, pruefeKandidat, rangiereAccounts, utmCampaign, utmLink, wechsle } from "./modell.js";
import { NotionClient, richText, synchronisiere, type Datensatz, type NotionStand } from "./notion.js";
import { baueRedaktionsplan, findePub, wochenFreigabeId, zaehle, type Redaktionsplan } from "./wochenplan.js";
import { contentLoopSchritt, ContentStore, meldeVeroeffentlicht } from "./zustand.js";

const JETZT = new Date("2026-11-22T10:00:00Z");
const W49 = { jahr: 2026, kw: 49 };
const ideen = () => generiereVorrat().ideen;
const ALLE_KONTEN = { instagram: { verbunden: true }, tiktok: { verbunden: true }, youtube: { verbunden: true }, facebook: { verbunden: true }, linkedin: { verbunden: true } };

// ── IDs / UTM / Status ────────────────────────────────────────────────────
test("utm_campaign trägt die Content-ID und ist rückwärts lesbar; Growth-Motive sind keine Content-Kampagne", () => {
  assert.equal(utmCampaign(W49, 3, "instagram"), "ig-2026-kw49-cv3");
  assert.deepEqual(parseUtmCampaign("ig-2026-kw49-cv3"), { plattform: "instagram", contentId: "cv-2026kw49-3", kampagnenId: "content-2026-kw49" });
  assert.equal(parseUtmCampaign("ig-2026-kw47-planung"), undefined);
  assert.equal(parseUtmCampaign(undefined), undefined);
  const u = new URL(utmLink("/demo", W49, 2, "tiktok", "idee-x"));
  assert.equal(u.searchParams.get("utm_source"), "tiktok");
  assert.equal(u.searchParams.get("utm_campaign"), "tt-2026-kw49-cv2");
});

test("Statusfluss: erlaubte Wechsel, idempotent, Verbotenes wirft", () => {
  assert.equal(wechsle("entwurf", "intern_pruefen"), "intern_pruefen");
  assert.equal(wechsle("veroeffentlicht", "veroeffentlicht"), "veroeffentlicht");
  assert.throws(() => wechsle("entwurf", "veroeffentlicht"));
  assert.throws(() => wechsle("verworfen", "freigegeben"));
  assert.throws(() => wechsle("nicht_vorgesehen", "freigegeben"));
});

// ── Scoring ───────────────────────────────────────────────────────────────
const vid = (id: string, p: VideoReferenz["plattform"], x: Partial<VideoReferenz>): VideoReferenz => ({
  id, plattform: p, accountId: `${p}:a`, url: "https://x/" + id, abgerufenAm: JETZT.toISOString(), verarbeitetAm: JETZT.toISOString(),
  quelle: { methode: "manuell", rechte: "test" }, ...x,
});

test("Scoring normalisiert je Plattform und nach Accountgröße — rohe Views entscheiden nicht", () => {
  const vs = bewerteVideos([
    vid("gross", "instagram", { views: 50_000, followerBeiAbruf: 1_000_000, likes: 100, kommentare: 1, shares: 0, veroeffentlichtAm: "2026-11-01T00:00:00Z" }),
    vid("klein", "instagram", { views: 5_000, followerBeiAbruf: 1_000, likes: 600, kommentare: 40, shares: 30, veroeffentlichtAm: "2026-11-01T00:00:00Z" }),
    vid("tt", "tiktok", { views: 10, followerBeiAbruf: 1_000_000, likes: 0, veroeffentlichtAm: "2026-11-01T00:00:00Z" }),
  ], JETZT);
  const g = vs.find((v) => v.id === "gross")!.score!, k = vs.find((v) => v.id === "klein")!.score!;
  assert.ok(k.wert! > g.wert!, "kleiner Account mit besserer Relation gewinnt");
  assert.equal(vs.find((v) => v.id === "tt")!.score!.wert, 50, "einziges TikTok-Video = Mittelwert, nicht mit Instagram verglichen");
  const leer = bewerteVideos([vid("x", "youtube", { views: 100 })], JETZT)[0]!.score!;
  assert.equal(leer.wert, null);
  assert.ok(leer.luecken.length > 0);
});

test("Account-Ranking legt Lücken offen", () => {
  const a: ReferenzAccount = { id: "instagram:a", plattform: "instagram", handle: "a", profilUrl: "https://i/a", sprache_markt: "DE", gruppe: "vorbild", kategorie: "x", zielgruppenpassung: "hoch", follower: null, follower_status: "nicht erhoben", quelle: "https://q", recherchiertAm: "2026-11-22", begruendung: "b" };
  const [r] = rangiereAccounts([a], [], JETZT);
  assert.equal(r!.rang, 100);
  assert.ok(r!.luecken.includes("keine bewerteten Videos"));
});

test("Kandidaten-Import: Format der Recherche, ohne Quelle verworfen", () => {
  const [ok] = pruefeKandidat({ plattform: "Instagram", handle: "@Papershift", profilUrl: "https://www.instagram.com/papershift/", gruppe: "wettbewerber", zielgruppenpassung: "hoch – passt", follower: { wert: 2014, stand: "Snippet" }, follower_status: "öffentlich gesehen", quelle: "https://www.papershift.com", begruendung: "b" }, "2026-11-22");
  assert.equal(ok?.id, "instagram:papershift");
  assert.equal(ok?.follower, 2014);
  assert.equal(ok?.zielgruppenpassung, "hoch");
  const [nein, grund] = pruefeKandidat({ plattform: "TikTok", handle: "x", profilUrl: "https://t/x", gruppe: "vorbild", zielgruppenpassung: "mittel", quelle: "" }, "2026-11-22");
  assert.equal(nein, undefined);
  assert.match(grund!, /Quellnachweis/);
});

// ── Ideen ─────────────────────────────────────────────────────────────────
test("Ideenvorrat: ≥30 freigebbar, ausgeglichen, keine Hook-Dubletten, nur belegte Fakten", () => {
  const { ideen: is, dubletten, verteilung } = generiereVorrat();
  assert.deepEqual(dubletten, []);
  assert.ok(verteilung.TOFU + verteilung.MOFU + verteilung.BOFU >= 30);
  for (const f of ["TOFU", "MOFU", "BOFU"] as const) assert.ok(verteilung[f] >= 9, `${f} ${verteilung[f]}`);
  for (const i of is) {
    assert.ok(i.hook && i.firstFrame && i.relevanz && i.cta.text && i.skript.length >= 3, i.id);
    assert.equal(i.skript[0]!.sek, "0–2");
    assert.ok(i.muster.length && i.unterschied, i.id);
  }
  const gesperrt = is.filter((i) => i.status === "gesperrt");
  assert.deepEqual(gesperrt.map((i) => i.format).sort(), ["kundengeschichte", "vorher_nachher_echt"]);
  assert.ok(gesperrt.every((i) => i.sperrgrund));
});

test("Generator erfindet keine Preise; Plattformgrenzen eingehalten", () => {
  for (const f of FAKTEN) for (const m of f.aussage.matchAll(/(\d+)\s?€/g)) assert.ok(ERLAUBTE_PREISE.includes(Number(m[1])), `${f.id} ${m[0]}`);
  for (const i of ideen()) for (const v of i.varianten) {
    assert.deepEqual(v.befunde, [], `${i.id}/${v.plattform}: ${v.befunde.join(";")}`);
    if (v.plattform === "instagram") assert.ok((v.caption.match(/#/g) ?? []).length <= 5);
    if (v.plattform === "tiktok") assert.ok(!v.caption.includes("\n"));
    if (v.plattform === "youtube") assert.ok((v.titel ?? "").length <= 100);
  }
});

test("Hook-Prüfung erkennt Umformulierungen", () => {
  const a = SAMEN[0]!;
  assert.equal(hookDubletten([a, { ...a, key: "kopie", hook: "5:45 Uhr: die erste Krankmeldung kommt als Sprachnachricht!" }]).length, 1);
});

// ── Wochenplan ────────────────────────────────────────────────────────────
test("Wochenplan: 7 Kernvideos 3/2/2; nur verbundene Konten zählen; höchstens 35", () => {
  const p = baueRedaktionsplan({ woche: W49, ideen: ideen(), jetzt: JETZT });
  const z = zaehle(p);
  assert.equal(z.kernvideos, 7);
  assert.equal(z.veroeffentlichungen, 7, "Standard: nur Instagram belegt");
  assert.equal(z.nichtVorgesehen, 28);
  assert.deepEqual(p.kernvideos.map((k) => k.funnel), ["TOFU", "MOFU", "TOFU", "BOFU", "TOFU", "MOFU", "BOFU"]);
  assert.ok(p.kernvideos.every((k) => !k.ideeId.includes("vorher-nachher") && !k.ideeId.includes("kundengeschichte")));
  const voll = baueRedaktionsplan({ woche: W49, ideen: ideen(), konten: ALLE_KONTEN, jetzt: JETZT });
  const zv = zaehle(voll);
  assert.ok(zv.veroeffentlichungen <= 35 && zv.veroeffentlichungen >= 30);
  const li = voll.kernvideos.flatMap((k) => k.veroeffentlichungen).filter((v) => v.plattform === "linkedin" && v.status === "nicht_vorgesehen");
  assert.ok(li.length >= 1 && li.every((v) => /Formatfit/.test(v.grund!)));
});

test("Rotation: Folgewoche nimmt andere Ideen", () => {
  const p1 = baueRedaktionsplan({ woche: W49, ideen: ideen(), jetzt: JETZT });
  const zuletzt = Object.fromEntries(p1.kernvideos.map((k) => [k.ideeId, k.datum]));
  const p2 = baueRedaktionsplan({ woche: { jahr: 2026, kw: 50 }, ideen: ideen(), zuletzt, jetzt: JETZT });
  const doppelt = p2.kernvideos.filter((k) => zuletzt[k.ideeId]);
  assert.equal(doppelt.length, 0);
});

// ── Loop / Freigabe / Doppelpost ─────────────────────────────────────────
function planImStore(): { st: ContentStore; plan: Redaktionsplan } {
  const st = new ContentStore(mkdtempSync(join(tmpdir(), "content-")));
  const plan = baueRedaktionsplan({ woche: { jahr: 2026, kw: 47 }, ideen: ideen(), jetzt: JETZT });
  for (const k of plan.kernvideos) for (const v of k.veroeffentlichungen) if (v.status === "entwurf") v.status = "intern_pruefen";
  st.speicherePlan(plan);
  return { st, plan };
}
const freigabe = (goalId: string, status: ApprovalEntry["status"]): ApprovalEntry => ({ goalId, status, title: "", description: "", businessImpact: 0, revenueImpact: 0, customerValue: 0, risk: "HIGH", priorityScore: 0, files: [], estimatedEffort: "", createdAt: "" });

test("Loop: ohne Freigabe passiert nichts; nach Freigabe freigegeben; Wiederholung idempotent", () => {
  const { st, plan } = planImStore();
  const r0 = contentLoopSchritt(st, [], JETZT);
  assert.equal(r0.freigegeben.length, 0);
  assert.equal(r0.faelligIg.length, 0, "nicht freigegeben = nie fällig");
  const r1 = contentLoopSchritt(st, [freigabe(wochenFreigabeId(plan), "approved")], JETZT);
  assert.equal(r1.freigegeben.length, 7);
  assert.equal(r1.faelligIg.length, 7, "KW47 liegt in der Vergangenheit → fällig");
  const r2 = contentLoopSchritt(st, [freigabe(wochenFreigabeId(plan), "approved")], JETZT);
  assert.equal(r2.freigegeben.length, 0);
  assert.equal(st.zeilen("laeufe.jsonl").length, 3, "jeder Lauf protokolliert");
});

test("Loop: abgelehnte Woche wird verworfen", () => {
  const { st, plan } = planImStore();
  const r = contentLoopSchritt(st, [freigabe(wochenFreigabeId(plan), "rejected")], JETZT);
  assert.equal(r.verworfen.length, 7);
  assert.ok(st.plaene()[0]!.kernvideos.every((k) => k.veroeffentlichungen.every((v) => v.status !== "freigegeben")));
});

test("Veröffentlicht melden: gleiche URL idempotent, zweite URL = Doppelpost-Sperre, ohne Freigabe nicht möglich", () => {
  const { plan } = planImStore();
  const v = plan.kernvideos[0]!.veroeffentlichungen.find((x) => x.plattform === "instagram")!;
  assert.throws(() => meldeVeroeffentlicht(v, "https://instagram.com/p/1", JETZT, "t"), "intern_pruefen → veröffentlicht verboten");
  v.status = "freigegeben";
  meldeVeroeffentlicht(v, "https://instagram.com/p/1", JETZT, "t");
  assert.equal(v.status, "veroeffentlicht");
  assert.match(meldeVeroeffentlicht(v, "https://instagram.com/p/1", JETZT, "t"), /schon/);
  assert.throws(() => meldeVeroeffentlicht(v, "https://instagram.com/p/2", JETZT, "t"), /kein zweiter Post/);
});

// ── Metricool ─────────────────────────────────────────────────────────────
function fakeAbruf(antworten: Array<{ status: number; body: unknown; retryAfter?: string }>, log: Array<{ url: string; method: string; body?: string }>): Abruf {
  return async (url, init) => {
    log.push({ url, method: init.method, ...(init.body ? { body: init.body } : {}) });
    const a = antworten.shift() ?? { status: 200, body: {} };
    return { status: a.status, headers: { get: (n: string) => (n === "retry-after" ? a.retryAfter ?? null : null) }, text: async () => JSON.stringify(a.body) };
  };
}

test("Metricool: ohne Zugang → manuell; Trockenlauf ändert nichts", async () => {
  const { plan } = planImStore();
  plan.kernvideos.forEach((k) => k.veroeffentlichungen.forEach((v) => { if (v.status === "intern_pruefen") v.status = "freigegeben"; }));
  const trocken = await uebergebe({ plan, konfig: { verbunden: [] }, journal: {}, medien: {}, schreiben: false, jetzt: JETZT, speichereJournal: () => {} });
  assert.ok(trocken.every((r) => r.aktion === "trocken"));
  assert.ok(plan.kernvideos.every((k) => k.veroeffentlichungen.every((v) => v.status !== "manuell_veroeffentlichen")));
  const r = await uebergebe({ plan, konfig: { verbunden: [] }, journal: {}, medien: {}, schreiben: true, jetzt: JETZT, speichereJournal: () => {} });
  assert.equal(r.filter((x) => x.aktion === "manuell").length, 7);
});

test("Metricool: Auto-Publish aus → Entwurf; Journal verhindert Doppelübergabe; vorhandener Post wird übernommen", async () => {
  const { plan } = planImStore();
  plan.kernvideos.forEach((k) => k.veroeffentlichungen.forEach((v) => { if (v.status === "intern_pruefen") v.status = "freigegeben"; }));
  const medien = Object.fromEntries(plan.kernvideos.map((k) => [k.contentId, `https://cdn/${k.contentId}.mp4`]));
  const log: Array<{ url: string; method: string; body?: string }> = [];
  const ersteCaption = plan.kernvideos[0]!.veroeffentlichungen.find((v) => v.plattform === "instagram")!.variante!.caption;
  const antworten: Array<{ status: number; body: unknown }> = [{ status: 200, body: { data: [{ id: 77, text: ersteCaption }] } }];
  for (let i = 0; i < 6; i++) antworten.push({ status: 200, body: { data: [] } }, { status: 200, body: { data: { id: 100 + i } } });
  const client = new MetricoolClient({ token: "t", userId: "u", blogId: "b" }, fakeAbruf(antworten, log), { schlaf: async () => {} });
  const journal: Journal = {};
  const konfig = { token: "t", userId: "u", blogId: "b", verbunden: ["instagram" as const] };
  const r = await uebergebe({ plan, konfig, client, journal, medien, schreiben: true, jetzt: JETZT, speichereJournal: () => {} });
  assert.ok(r.every((x) => x.aktion === "entwurf"), JSON.stringify(r));
  assert.equal(journal[plan.kernvideos[0]!.veroeffentlichungen[0]!.id]!.postId, "77", "bestehender Post übernommen");
  const posts = log.filter((l) => l.method === "POST");
  assert.equal(posts.length, 6);
  assert.ok(posts.every((p) => JSON.parse(p.body!).draft === true && JSON.parse(p.body!).autoPublish === false));
  const n = log.length;
  const r2 = await uebergebe({ plan, konfig, client, journal, medien, schreiben: true, jetzt: JETZT, speichereJournal: () => {} });
  assert.ok(r2.every((x) => x.aktion === "übersprungen"));
  assert.equal(log.length, n, "zweiter Lauf ohne API-Aufruf");
});

test("Metricool: Auto-Publish nur mit Schalter, Zugang, verbundener Plattform und gültiger Variante", async () => {
  const { autoPublishErlaubt } = await import("./metricool.js");
  const { plan } = planImStore();
  const v = plan.kernvideos[0]!.veroeffentlichungen[0]!;
  const voll = { token: "t", userId: "u", blogId: "b", verbunden: ["instagram" as const] };
  assert.equal(autoPublishErlaubt(voll, v, []).ja, false);
  assert.equal(autoPublishErlaubt({ ...voll, autoPublish: "ja" }, v, []).ja, false);
  assert.equal(autoPublishErlaubt({ ...voll, autoPublish: "ja-auto-publish" }, v, ["kein Video"]).ja, false);
  assert.equal(autoPublishErlaubt({ ...voll, autoPublish: "ja-auto-publish" }, v, []).ja, true);
});

// ── Notion ────────────────────────────────────────────────────────────────
test("Notion: idempotenter Upsert, 429 mit Retry-After, Wiederaufnahme nach Teilfehler", async () => {
  const log: Array<{ url: string; method: string; body?: string }> = [];
  const pausen: number[] = [];
  const antworten: Array<{ status: number; body: unknown; retryAfter?: string }> = [
    { status: 429, body: { code: "rate_limited" }, retryAfter: "2" },
    { status: 200, body: { results: [], has_more: false, next_cursor: null } }, // suche a
    { status: 200, body: { id: "page-a" } },                                    // anlegen a
    { status: 200, body: { results: [], has_more: false, next_cursor: null } }, // suche b
    { status: 400, body: { message: "validation_error" } },                    // b scheitert
  ];
  const client = new NotionClient("secret_x", fakeAbruf(antworten, log), { schlaf: async (ms) => { pausen.push(ms); } });
  const stand: NotionStand = { datenbanken: { ideen: { databaseId: "db", dataSourceId: "ds" } }, journal: {} };
  const d = (id: string, hook: string): Datensatz => ({ externeId: id, werte: { Hook: hook, Funnel: "TOFU" } });
  let gespeichert = 0;
  const r1 = await synchronisiere({ client, stand, db: "ideen", datensaetze: [d("a", "A"), d("b", "B"), d("a", "A")], schreiben: true, speichere: () => { gespeichert++; } });
  assert.equal(r1.neu, 1);
  assert.deepEqual(r1.dubletten, ["a"]);
  assert.equal(r1.fehler.length, 1);
  assert.deepEqual(pausen, [2000]);
  assert.equal(gespeichert, 1, "Journal nach jedem Erfolg");
  assert.ok(!log.some((l) => (l.body ?? "").includes("secret_x")));
  log.length = 0;
  antworten.push({ status: 200, body: { results: [{ id: "page-b-alt" }], has_more: false, next_cursor: null } }, { status: 200, body: {} });
  const r2 = await synchronisiere({ client, stand, db: "ideen", datensaetze: [d("a", "A"), d("b", "B")], schreiben: true, speichere: () => {} });
  assert.equal(r2.unveraendert, 1, "a unverändert → kein Aufruf");
  assert.equal(r2.geaendert, 1, "b fand vorhandene Seite → PATCH statt Dublette");
  assert.equal(log.filter((l) => l.method === "PATCH").length, 1);
  log.length = 0;
  const r3 = await synchronisiere({ client, stand, db: "ideen", datensaetze: [d("a", "A2")], schreiben: false, speichere: () => {} });
  assert.equal(r3.geaendert, 1);
  assert.equal(log.length, 0, "Trockenlauf sendet nichts");
});

test("Notion: rich_text in 2000er-Stücke", () => {
  const t = richText("x".repeat(4500));
  assert.deepEqual(t.map((x) => x.text.content.length), [2000, 2000, 500]);
});

test("HTTP: nicht wiederholbare Fehler sofort, ohne Token in der Meldung", async () => {
  const abruf = fakeAbruf([{ status: 401, body: { message: "token=abc123 invalid" } }], []);
  await assert.rejects(anfrage("X", abruf, "https://x", { method: "GET", headers: {} }, { schlaf: async () => {} }), (e: Error) => !e.message.includes("abc123"));
});

// ── Apify ─────────────────────────────────────────────────────────────────
test("Apify: ohne Budget nie; Budget-Rest begrenzt; Batches nach Ziel, ohne niedrige Passung", () => {
  const b: Batch = { plattform: "tiktok", handles: ["a"], proAccount: 12, schaetzungUsd: 0.02, maxUsd: 0.05 };
  assert.equal(darfLaufen(undefined, [], b).ok, false);
  assert.equal(darfLaufen(1, [{ zeit: "", plattform: "tiktok", actor: "x", eingabe: {}, status: "SUCCEEDED", ergebnisse: 1, kostenUsd: 0.99, maxUsd: 1 }], b).ok, false);
  assert.equal(darfLaufen(1, [], b).ok, true);
  const acc = (h: string, p: "hoch" | "niedrig"): ReferenzAccount => ({ id: `tiktok:${h}`, plattform: "tiktok", handle: h, profilUrl: "https://t", sprache_markt: "DE", gruppe: "vorbild", kategorie: "", zielgruppenpassung: p, follower: null, follower_status: "nicht erhoben", quelle: "https://q", recherchiertAm: "", begruendung: "" });
  const { batches } = planeBatches({ accounts: [acc("a", "hoch"), acc("b", "hoch"), acc("c", "niedrig")], erledigt: new Set(["tiktok:b"]), bisherVideos: 0, ziel: 300 });
  assert.deepEqual(batches.map((x) => x.handles), [["a"]]);
});

test("Apify-Normalisierung: TikTok-Felder, keine Caption gespeichert, Rechtehinweis", () => {
  const v = normalisiere("tiktok", { id: "123", authorMeta: { name: "Firma", fans: 1000 }, webVideoUrl: "https://tiktok.com/@firma/video/123", playCount: 500, diggCount: 20, commentCount: 2, shareCount: 1, createTimeISO: "2026-11-01T00:00:00Z", text: "CAPTIONXYZ der Caption", videoMeta: { duration: 20 } }, { actor: "clockworks/tiktok-scraper", laufId: "r1", jetzt: JETZT })!;
  assert.equal(v.id, "tiktok:123");
  assert.equal(v.accountId, "tiktok:firma");
  assert.equal(v.followerBeiAbruf, 1000);
  assert.ok(!JSON.stringify(v).includes("CAPTIONXYZ"));
  assert.equal(v.inhalt?.art, "nicht verfügbar");
  assert.equal(normalisiere("tiktok", { id: "1" }, { actor: "x", jetzt: JETZT }), undefined);
});

// ── Attribution / Sales ──────────────────────────────────────────────────
const ev = (x: Partial<SalesEvent> & Pick<SalesEvent, "id" | "kind" | "at">): SalesEvent => ({ origin: "imap", ...x });

test("Attribution: beobachtet vs. selbst angegeben; Umsatz einmal, letzter Contentkontakt; keine Leads aus Nicht-Interesse", () => {
  const states = resolveAccounts([
    ev({ id: "signup-mail:a@glanz.de", kind: "signup", at: "2026-12-01T09:00:00Z", email: "a@glanz.de", company: "Glanz GmbH", source: "instagram", campaign: "ig-2026-kw49-cv1" }),
    ev({ id: "gmail:2", kind: "inquiry", at: "2026-12-03T09:00:00Z", email: "a@glanz.de", source: "tiktok", campaign: "tt-2026-kw49-cv4" }),
    ev({ id: "manual:won", kind: "won", at: "2026-12-10T09:00:00Z", email: "a@glanz.de", valueEur: 1188 }),
    ev({ id: "signup-mail:b@sauber.de", kind: "signup", at: "2026-12-02T09:00:00Z", email: "b@sauber.de", company: "Sauber KG", statedOrigin: "instagram" }),
    ev({ id: "places:x", kind: "target", at: "2026-12-02T09:00:00Z", website: "https://ziel.de", company: "Ziel GmbH" }),
  ]).map(accountState);
  const a = attribuiere(states);
  assert.equal(a.length, 2, "target ist kein Lead");
  const glanz = a.find((x) => x.art === "beobachtet")!;
  assert.equal(glanz.erstkontakt, "cv-2026kw49-1");
  assert.equal(glanz.letzterKontakt, "cv-2026kw49-4");
  assert.equal(glanz.umsatzEur, 1188);
  assert.equal(a.find((x) => x.art === "selbst angegeben")!.plattform, "instagram");
  const text = wochenbericht({ woche: W49, plaene: [], states, jetzt: JETZT });
  assert.match(text, /Umsatz 1\.188 €/);
  assert.match(text, /keine Kausalaussage/);
  assert.match(text, /Kleine Stichprobe/);
});

test("Content-Modul legt nie Sales-Ereignisse an und schickt nichts", () => {
  const dir = join(import.meta.dirname, ".");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.ok(!/\.ingest\(|validateEvent\(|nodemailer|smtp/i.test(src), `${f} darf keine Sales-Ereignisse/Mails erzeugen`);
  }
});

test("Content-Status findet Veröffentlichung", () => {
  const p = baueRedaktionsplan({ woche: W49, ideen: ideen(), jetzt: JETZT });
  assert.equal(findePub(p, "cv-2026kw49-1.ig")?.plattform, "instagram");
});

test("Sales-Job instagram ruft den Content-Schritt auf; ohne contentDir bleibt er aus", async () => {
  const { SalesSystem } = await import("../sales/system.js");
  const { SalesStore } = await import("../sales/store.js");
  const { st, plan } = planImStore();
  const salesDir = mkdtempSync(join(tmpdir(), "sales-"));
  const mit = new SalesSystem(new SalesStore(salesDir), { capacity: 6, researchLimit: 10, blocklists: [], igRuntime: "/nonexistent-ig", partnerPerDay: 3, contentDir: st.dir });
  mit.approvals.enqueue({ goalId: wochenFreigabeId(plan), title: "t", description: "", businessImpact: 1, revenueImpact: 1, customerValue: 1, risk: "HIGH", priorityScore: 1, files: [], estimatedEffort: "" });
  assert.match(mit.jobInstagram(JETZT), /Content: 0 freigegebene IG-Posts/);
  mit.approvals.approve(wochenFreigabeId(plan));
  assert.match(mit.jobInstagram(JETZT), /Content: 7 freigegebene IG-Posts fällig.*\+7 freigegeben/);
  assert.match(mit.jobInstagram(JETZT), /Content: 7 freigegebene IG-Posts fällig \(/);
  const ohne = new SalesSystem(new SalesStore(mkdtempSync(join(tmpdir(), "sales-"))), { capacity: 6, researchLimit: 10, blocklists: [], igRuntime: "/nonexistent-ig", partnerPerDay: 3 });
  assert.doesNotMatch(ohne.jobInstagram(JETZT), /Content/);
});
