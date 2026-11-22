// HeyAudit Content-System CLI (Runbook: docs/heyaudit-content-system.md).
//
//   npm run content -- status
//   npm run content -- recherche-import <kandidaten.json>       Accounts prüfen + übernehmen (keine Leads!)
//   npm run content -- rangliste                                Accounts transparent ranken
//   npm run content -- apify-plan [--ziel 300]                  Batches + Kostenschätzung (läuft nichts)
//   npm run content -- apify-lauf [--batches 1]                 nur mit APIFY_TOKEN + CONTENT_APIFY_BUDGET_USD
//   npm run content -- video-import <videos.json>               Videos (manuell/Export) übernehmen + scoren
//   npm run content -- ideen                                    Ideenvorrat erzeugen (ideen/ideen.{json,md})
//   npm run content -- plan [--woche 2026-KW49] [--neu]         Redaktionsplan + Wochenfreigabe (Sales-Freigabe)
//   npm run content -- loop                                     wie der Sales-Job instagram: Freigaben übernehmen
//   npm run content -- uebergabe [--schreiben]                  Metricool-Übergabe (Standard: Trockenlauf)
//   npm run content -- ig-faellig                               heute fällige, freigegebene Instagram-Posts
//   npm run content -- veroeffentlicht <pubId> --url <url> [--at ISO]
//   npm run content -- kennzahlen <pubId> [--views n --likes n --kommentare n --shares n --linkklicks n --profilklicks n] --quelle "…"
//   npm run content -- verwerfen <pubId>
//   npm run content -- notion [--schreiben]                     Sync (Standard: Trockenlauf; ohne Token: Export)
//   npm run content -- bericht [--woche 2026-KW49]              Content → Sales Wochenbericht (liest Sales nur)
//
// Geheimnisse nur aus der Umgebung (content.sh liest sie aus dem Keychain). Nie geloggt.

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { ApprovalQueue } from "../approval-queue.js";
import { JsonFileStorage } from "../storage.js";
import { accountState, resolveAccounts } from "../sales/rules.js";
import { SalesStore } from "../sales/store.js";
import { ACTORS, ApifyClient, darfLaufen, normalisiere, planeBatches, type LaufEintrag } from "./apify.js";
import { wochenbericht } from "./bericht.js";
import { FAKTEN_STAND } from "./fakten.js";
import { generiereVorrat, renderIdee, type Idee } from "./ideen.js";
import { konfigAusUmgebung, MetricoolClient, uebergebe, type Journal } from "./metricool.js";
import type { Plattform, ReferenzAccount, VideoReferenz, Woche } from "./modell.js";
import { bewerteVideos, isoWoche, pruefeKandidat, rangiereAccounts, ACCOUNT_FORMEL, SCORE_FORMEL } from "./modell.js";
import { accountDatensatz, DB_REIHENFOLGE, exportCsv, ideeDatensatz, NotionClient, pubDatensatz, SCHEMA, synchronisiere, videoDatensatz, type DbName, type Datensatz, type NotionStand } from "./notion.js";
import { aktivePlattformen, contentLoopSchritt, ContentStore, meldeVeroeffentlicht } from "./zustand.js";
import { baueRedaktionsplan, findePub, renderPlan, setzeStatus, wochenFreigabe, zaehle } from "./wochenplan.js";

const SALES_DIR = process.env.SALES_STATE_DIR ?? join(homedir(), "dev", "tedos-runtime", "heyaudit-sales");
const arg = (a: string[], n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
const flag = (a: string[], n: string) => a.includes(n);

function parseWoche(s: string | undefined, jetzt: Date): Woche {
  if (!s) { const w = isoWoche(new Date(jetzt.getTime() + 7 * 86_400_000)); return w; } // Standard: nächste Woche
  const m = s.match(/^(\d{4})-?KW(\d{1,2})$/i);
  if (!m) throw new Error("--woche im Format 2026-KW49");
  return { jahr: Number(m[1]), kw: Number(m[2]) };
}

function salesApprovals(sales: SalesStore) { return new ApprovalQueue(new JsonFileStorage(join(sales.dir, "approvals"))); }

async function main(): Promise<void> {
  const [cmd = "status", ...a] = process.argv.slice(2);
  const st = new ContentStore();
  const jetzt = new Date();
  switch (cmd) {
    case "status": {
      const acc = st.lies<ReferenzAccount[]>("recherche/accounts.json", []);
      const vid = st.lies<VideoReferenz[]>("recherche/videos.json", []);
      const ideen = st.lies<Idee[]>("ideen/ideen.json", []);
      const plaene = st.plaene();
      const env = (n: string) => (process.env[n] ? "gesetzt" : "nicht gesetzt");
      console.log([
        `Content-Zustand: ${st.dir}`,
        `Accounts: ${acc.length} · Videos: ${vid.length} · Ideen: ${ideen.length} · Pläne: ${plaene.map((p) => `${p.kampagnenId} (${zaehle(p).veroeffentlichungen} Versionen)`).join(", ") || "keine"}`,
        `Aktive Plattformen: ${aktivePlattformen(st.konten()).join(", ")}`,
        `Zugänge: APIFY_TOKEN ${env("APIFY_TOKEN")}, CONTENT_APIFY_BUDGET_USD ${env("CONTENT_APIFY_BUDGET_USD")}, NOTION_TOKEN ${env("NOTION_TOKEN")}, NOTION_PARENT_PAGE ${env("NOTION_PARENT_PAGE")}, METRICOOL_USER_TOKEN ${env("METRICOOL_USER_TOKEN")}, CONTENT_AUTOPUBLISH ${process.env.CONTENT_AUTOPUBLISH === "ja-auto-publish" ? "SCHARF" : "aus"}`,
        `Faktenkatalog Stand ${FAKTEN_STAND}`,
      ].join("\n"));
      return;
    }
    case "recherche-import": {
      const datei = a[0];
      if (!datei) throw new Error("Datei fehlt");
      const roh = JSON.parse(readFileSync(datei, "utf8")) as unknown[];
      const tag = datei.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? jetzt.toISOString().slice(0, 10);
      const bestand = new Map(st.lies<ReferenzAccount[]>("recherche/accounts.json", []).map((x) => [x.id, x]));
      const verworfen: string[] = [];
      let neu = 0, aktualisiert = 0;
      for (const r of roh) {
        const [acc, grund] = pruefeKandidat(r, tag);
        if (!acc) { verworfen.push(grund ?? "?"); continue; }
        bestand.has(acc.id) ? aktualisiert++ : neu++;
        bestand.set(acc.id, acc);
      }
      st.schreibe("recherche/accounts.json", [...bestand.values()]);
      console.log(`Accounts: +${neu} neu, ${aktualisiert} aktualisiert, ${verworfen.length} verworfen${verworfen.length ? `\n- ${verworfen.join("\n- ")}` : ""}\nHinweis: Diese Accounts sind Musterquellen, keine Leads — sie gehen nie ins Sales-System.`);
      return;
    }
    case "rangliste": {
      const acc = st.lies<ReferenzAccount[]>("recherche/accounts.json", []);
      const vid = st.lies<VideoReferenz[]>("recherche/videos.json", []);
      const fq = st.lies<Record<string, number>>("recherche/formatqualitaet.json", {});
      const r = rangiereAccounts(acc, vid, jetzt, fq);
      st.schreibe("recherche/rangliste.json", r);
      const nach = new Map(acc.map((x) => [x.id, x]));
      const zeilen = [`# Rangliste Referenz-Accounts (${jetzt.toISOString().slice(0, 10)})`, "", `Formel: ${ACCOUNT_FORMEL}`, "", "Getrennt nach Plattform und Gruppe; Ränge sind nur innerhalb einer Plattform vergleichbar.", ""];
      for (const p of ["instagram", "tiktok", "youtube", "linkedin", "facebook"] as Plattform[]) for (const g of ["wettbewerber", "vorbild"] as const) {
        const teil = r.filter((x) => nach.get(x.accountId)?.plattform === p && nach.get(x.accountId)?.gruppe === g);
        if (!teil.length) continue;
        zeilen.push(`## ${p} · ${g} (${teil.length})`, "", "| # | Handle | Rang | Passung | Follower | Videos | Lücken |", "|---|---|---:|---|---|---:|---|");
        teil.forEach((x, i) => { const c = nach.get(x.accountId)!; zeilen.push(`| ${i + 1} | [${c.handle}](${c.profilUrl}) | ${x.rang} | ${c.zielgruppenpassung} | ${c.follower ?? "n. e."} (${c.follower_status}) | ${x.videos} | ${x.luecken.join("; ")} |`); });
        zeilen.push("");
      }
      st.schreibe("recherche/rangliste.md", zeilen.join("\n") + "\n");
      console.log(`Rangliste: ${r.length} Accounts → ${st.pfad("recherche/rangliste.md")}`);
      return;
    }
    case "apify-plan":
    case "apify-lauf": {
      const acc = st.lies<ReferenzAccount[]>("recherche/accounts.json", []);
      const rang = new Map(st.lies<Array<{ accountId: string; rang: number }>>("recherche/rangliste.json", []).map((x) => [x.accountId, x.rang]));
      const sortiert = [...acc].sort((x, y) => (rang.get(y.id) ?? 0) - (rang.get(x.id) ?? 0));
      const stand = st.lies<{ erledigt: string[] }>("recherche/apify-stand.json", { erledigt: [] });
      const vids = st.lies<VideoReferenz[]>("recherche/videos.json", []);
      const ziel = Number(arg(a, "--ziel") ?? 300);
      const { batches, hinweise } = planeBatches({ accounts: sortiert, erledigt: new Set(stand.erledigt), bisherVideos: vids.length, ziel });
      const laeufe = st.zeilen<LaufEintrag>("recherche/apify-laeufe.jsonl");
      const budget = process.env.CONTENT_APIFY_BUDGET_USD ? Number(process.env.CONTENT_APIFY_BUDGET_USD) : undefined;
      const summe = batches.reduce((s, b) => s + b.schaetzungUsd, 0);
      if (cmd === "apify-plan") {
        console.log([`Ziel ${ziel} Videos (bisher ${vids.length}) · ${batches.length} Batches · geschätzt ${summe.toFixed(2)} $ (Obergrenze mit Puffer ${batches.reduce((s, b) => s + b.maxUsd, 0).toFixed(2)} $)`,
          ...batches.map((b, i) => `${i + 1}. ${b.plattform} ${ACTORS[b.plattform]!.actor}: ${b.handles.join(", ")} · ≤${b.handles.length * b.proAccount} Videos · ~${b.schaetzungUsd} $ (max ${b.maxUsd} $)`),
          ...hinweise.map((h) => `Hinweis: ${h}`), `Budget: ${budget === undefined ? "NICHT konfiguriert → kein Lauf möglich" : `${budget} $, verbraucht ${laeufe.reduce((s, l) => s + (l.kostenUsd ?? 0), 0).toFixed(2)} $`}`].join("\n"));
        return;
      }
      const token = process.env.APIFY_TOKEN;
      if (!token) throw new Error("APIFY_TOKEN fehlt (Keychain heyaudit-apify, über content.sh) — blockiert");
      const client = new ApifyClient(token);
      const max = Number(arg(a, "--batches") ?? 1);
      const follower = Object.fromEntries(acc.filter((x) => x.follower).map((x) => [x.id, x.follower as number]));
      const alle = new Map(vids.map((v) => [v.id, v]));
      for (const b of batches.slice(0, max)) {
        const ok = darfLaufen(budget, laeufe, b);
        if (!ok.ok) { console.log(`Stopp: ${ok.grund}`); break; }
        const prof = ACTORS[b.plattform]!;
        const seit = new Date(jetzt.getTime() - 120 * 86_400_000).toISOString();
        const eingabe = prof.eingabe(b.handles, b.proAccount, seit);
        const eintrag: LaufEintrag = { zeit: jetzt.toISOString(), plattform: b.plattform, actor: prof.actor, eingabe, status: "GESTARTET", ergebnisse: 0, maxUsd: b.maxUsd };
        try {
          const info = await client.actorInfo(prof.actor);
          const build = info.data.taggedBuilds?.latest?.buildNumber;
          if (build) eintrag.build = build;
          const { run, items } = await client.lauf(prof.actor, eingabe, b.maxUsd, b.handles.length * b.proAccount);
          eintrag.runId = run.id; eintrag.status = run.status; eintrag.ergebnisse = items.length;
          if (run.usageTotalUsd !== undefined) eintrag.kostenUsd = run.usageTotalUsd;
          for (const it of items) { const v = normalisiere(b.plattform, it, { laufId: run.id, actor: prof.actor, jetzt, follower }); if (v) alle.set(v.id, v); }
          if (run.status === "SUCCEEDED") stand.erledigt.push(...b.handles.map((h) => `${b.plattform}:${h.toLowerCase()}`));
        } catch (e) { eintrag.status = "FEHLER"; eintrag.fehler = (e as Error).message; }
        st.anhaengen("recherche/apify-laeufe.jsonl", eintrag);
        laeufe.push(eintrag);
        st.schreibe("recherche/videos.json", bewerteVideos([...alle.values()], jetzt));
        st.schreibe("recherche/apify-stand.json", stand);
        console.log(`${b.plattform}: ${eintrag.status}, ${eintrag.ergebnisse} Ergebnisse, Kosten ${eintrag.kostenUsd ?? "?"} $${eintrag.fehler ? ` — ${eintrag.fehler}` : ""}`);
        if (eintrag.status !== "SUCCEEDED") break;
      }
      return;
    }
    case "video-import": {
      const roh = JSON.parse(readFileSync(a[0] ?? "", "utf8")) as VideoReferenz[];
      const alle = new Map(st.lies<VideoReferenz[]>("recherche/videos.json", []).map((v) => [v.id, v]));
      const fehler: string[] = [];
      for (const v of roh) {
        if (!v.id || !v.plattform || !v.accountId || !/^https:\/\//.test(v.url ?? "") || !v.quelle?.rechte) { fehler.push(String(v.id ?? "ohne id")); continue; }
        alle.set(v.id, { ...alle.get(v.id), ...v });
      }
      const bewertet = bewerteVideos([...alle.values()], jetzt);
      st.schreibe("recherche/videos.json", bewertet);
      console.log(`Videos: ${bewertet.length} gesamt, ${fehler.length} verworfen (Pflichtfelder: id, plattform, accountId, url, quelle.rechte)\nFormel: ${SCORE_FORMEL}`);
      return;
    }
    case "ideen": {
      const { ideen, dubletten, verteilung } = generiereVorrat();
      if (dubletten.length) throw new Error(`Zu ähnliche Hooks: ${dubletten.map((d) => d.join(" ~ ")).join("; ")}`);
      st.schreibe("ideen/ideen.json", ideen);
      st.schreibe("ideen/ideen.md", [`# HeyAudit Ideenvorrat (${ideen.length}, freigebbar TOFU ${verteilung.TOFU} / MOFU ${verteilung.MOFU} / BOFU ${verteilung.BOFU})`, "", `Faktenkatalog Stand ${FAKTEN_STAND}. Platzhalter [[…]] vor Produktion ersetzen.`, "", ...ideen.map(renderIdee)].join("\n\n") + "\n");
      console.log(`Ideen: ${ideen.length} (TOFU ${verteilung.TOFU}, MOFU ${verteilung.MOFU}, BOFU ${verteilung.BOFU}, gesperrt ${ideen.filter((i) => i.status === "gesperrt").length}) → ${st.pfad("ideen/ideen.md")}`);
      return;
    }
    case "plan": {
      const w = parseWoche(arg(a, "--woche"), jetzt);
      const ideen = st.lies<Idee[]>("ideen/ideen.json", []);
      if (!ideen.length) throw new Error("Erst `content -- ideen` ausführen");
      const vorhanden = st.plaene().find((p) => p.woche.jahr === w.jahr && p.woche.kw === w.kw);
      if (vorhanden && !flag(a, "--neu")) { console.log(`Plan ${vorhanden.kampagnenId} existiert (idempotent). Neu nur mit --neu und solange nichts freigegeben ist.`); return; }
      if (vorhanden && vorhanden.kernvideos.some((k) => k.veroeffentlichungen.some((v) => !["entwurf", "intern_pruefen", "nicht_vorgesehen"].includes(v.status)))) throw new Error("Plan hat freigegebene/veröffentlichte Einträge — nicht neu erzeugen");
      const zuletzt: Record<string, string> = {};
      for (const p of st.plaene()) for (const k of p.kernvideos) if ((zuletzt[k.ideeId] ?? "") < k.datum) zuletzt[k.ideeId] = k.datum;
      const mix = st.lies<{ wochenmix?: { TOFU: number; MOFU: number; BOFU: number } }>("konten.json", {}).wochenmix;
      const plan = baueRedaktionsplan({ woche: w, ideen, konten: st.konten(), zuletzt, jetzt, ...(mix ? { mix } : {}) });
      for (const k of plan.kernvideos) for (const v of k.veroeffentlichungen) if (v.status === "entwurf") setzeStatus(v, "intern_pruefen", "content plan", jetzt);
      const datei = st.speicherePlan(plan);
      st.schreibe(`plaene/${plan.kampagnenId}.md`, renderPlan(plan, new Map(ideen.map((i) => [i.id, i]))));
      const sales = new SalesStore(SALES_DIR);
      sales.withLock(() => salesApprovals(sales).enqueue(wochenFreigabe(plan, st.pfad(`plaene/${plan.kampagnenId}.md`))));
      const z = zaehle(plan);
      console.log(`${plan.kampagnenId}: ${z.kernvideos} Kernvideos, ${z.veroeffentlichungen} Plattformversionen (${z.nichtVorgesehen} nicht vorgesehen) → ${datei}\nFreigabe: npm run sales -- entwurf content:woche:${plan.kampagnenId} · freigeben nur auf Teds Wort`);
      return;
    }
    case "loop": {
      const sales = new SalesStore(SALES_DIR);
      console.log(contentLoopSchritt(st, salesApprovals(sales).all(), jetzt, "cli").text);
      return;
    }
    case "uebergabe": {
      const konten = st.konten();
      const verbunden = (Object.entries(konten) as Array<[Plattform, { metricool?: boolean }]>).filter(([, k]) => k?.metricool).map(([p]) => p);
      const konfig = konfigAusUmgebung(verbunden);
      const client = konfig.token && konfig.userId && konfig.blogId ? new MetricoolClient({ token: konfig.token, userId: konfig.userId, blogId: konfig.blogId }) : undefined;
      const journal = st.lies<Journal>("metricool-journal.json", {});
      const medien = st.lies<Record<string, string>>("medien.json", {});
      const schreiben = flag(a, "--schreiben");
      for (const plan of st.plaene()) {
        const r = await uebergebe({ plan, konfig, ...(client ? { client } : {}), journal, medien, schreiben, jetzt, speichereJournal: (j) => st.schreibe("metricool-journal.json", j) });
        if (schreiben) st.speicherePlan(plan);
        for (const x of r) console.log(`${x.pubId}: ${x.aktion} — ${x.grund}`);
      }
      if (!client) console.log("Metricool: kein Zugang konfiguriert (METRICOOL_USER_TOKEN/USER_ID/BLOG_ID) — freigegebene Posts gehen in die manuelle Veröffentlichung.");
      return;
    }
    case "ig-faellig": {
      const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(jetzt);
      const ideen = new Map(st.lies<Idee[]>("ideen/ideen.json", []).map((i) => [i.id, i]));
      let n = 0;
      for (const p of st.plaene()) for (const k of p.kernvideos) for (const v of k.veroeffentlichungen) {
        if (v.plattform !== "instagram" || !["freigegeben", "manuell_veroeffentlichen"].includes(v.status) || (v.geplant ?? "").slice(0, 10) > heute) continue;
        n++;
        console.log(`\n== ${v.id} (${v.status}, geplant ${v.geplant}) — ${ideen.get(k.ideeId)?.hook ?? k.ideeId}\nLink in Bio: ${v.link}\nCaption:\n${v.variante?.caption}\nManuell: ${v.variante?.manuell.join("; ")}`);
      }
      if (!n) console.log("Keine freigegebenen Instagram-Posts fällig.");
      return;
    }
    case "veroeffentlicht":
    case "kennzahlen":
    case "verwerfen": {
      const id = a[0] ?? "";
      for (const plan of st.plaene()) {
        const v = findePub(plan, id);
        if (!v) continue;
        if (cmd === "veroeffentlicht") console.log(meldeVeroeffentlicht(v, arg(a, "--url") ?? "", arg(a, "--at") ? new Date(arg(a, "--at")!) : jetzt, "cli"));
        else if (cmd === "verwerfen") { setzeStatus(v, "verworfen", "cli", jetzt); console.log(`${id}: verworfen`); }
        else {
          const quelle = arg(a, "--quelle");
          if (!quelle) throw new Error("--quelle ist Pflicht (z. B. \"Instagram Insights 2026-11-30\")");
          const n = (k: string) => (arg(a, `--${k}`) !== undefined ? Number(arg(a, `--${k}`)) : undefined);
          const kz: NonNullable<typeof v.kennzahlen> = { stand: jetzt.toISOString(), quelle };
          for (const k of ["views", "likes", "kommentare", "shares", "linkklicks", "profilklicks"] as const) { const x = n(k); if (x !== undefined && Number.isFinite(x) && x >= 0) kz[k] = x; }
          v.kennzahlen = kz;
          console.log(`${id}: Kennzahlen gespeichert`);
        }
        st.speicherePlan(plan);
        return;
      }
      throw new Error(`Veröffentlichung ${id} nicht gefunden`);
    }
    case "notion": {
      const acc = st.lies<ReferenzAccount[]>("recherche/accounts.json", []);
      const rang = new Map(st.lies<Array<{ accountId: string; rang: number; luecken: string[]; komponenten: Record<string, number>; videos: number; formel: string }>>("recherche/rangliste.json", []).map((r) => [r.accountId, r]));
      const vid = st.lies<VideoReferenz[]>("recherche/videos.json", []);
      const ideen = st.lies<Idee[]>("ideen/ideen.json", []);
      const daten: Record<DbName, Datensatz[]> = {
        accounts: acc.map((x) => accountDatensatz(x, rang.get(x.id))),
        videos: vid.map(videoDatensatz),
        ideen: ideen.map((i) => ideeDatensatz(i)),
        veroeffentlichungen: st.plaene().flatMap((p) => p.kernvideos.flatMap((k) => k.veroeffentlichungen.map((v) => pubDatensatz(p, v, k.ideeId)))),
      };
      const token = process.env.NOTION_TOKEN;
      if (!token) {
        for (const db of DB_REIHENFOLGE) st.schreibe(`notion-export/${db}.csv`, exportCsv(db, daten[db]));
        st.schreibe("notion-export/schema.json", SCHEMA);
        console.log(`Notion: BLOCKIERT (kein NOTION_TOKEN). Importdateien: ${st.pfad("notion-export")} (${DB_REIHENFOLGE.map((d) => `${d} ${daten[d].length}`).join(", ")})`);
        return;
      }
      const schreiben = flag(a, "--schreiben");
      const client = new NotionClient(token);
      const stand = st.lies<NotionStand>("notion.json", { datenbanken: {}, journal: {} });
      const vorgegeben: Partial<Record<DbName, string | undefined>> = { accounts: process.env.NOTION_DB_ACCOUNTS, videos: process.env.NOTION_DB_VIDEOS, ideen: process.env.NOTION_DB_IDEEN, veroeffentlichungen: process.env.NOTION_DB_VEROEFFENTLICHUNGEN };
      for (const db of DB_REIHENFOLGE) {
        if (stand.datenbanken[db]) continue;
        const id = vorgegeben[db];
        if (id) { // bestehende Datenbank wiederverwenden, Schema nur prüfen
          const ds = await client.dataSourceVon(id);
          const vorhanden = new Set(await client.spaltenVon(ds));
          const luecke = SCHEMA[db].map((s) => s.name).filter((n) => !vorhanden.has(n));
          if (luecke.length) { console.log(`${db}: bestehende Datenbank fehlen Spalten ${luecke.join(", ")} — bitte in Notion ergänzen; nicht synchronisiert`); continue; }
          stand.datenbanken[db] = { databaseId: id, dataSourceId: ds };
        } else if (schreiben) {
          const parent = process.env.NOTION_PARENT_PAGE;
          if (!parent) throw new Error("NOTION_PARENT_PAGE fehlt — ohne geklärte Elternseite wird keine Datenbank angelegt");
          const ziele = Object.fromEntries(Object.entries(stand.datenbanken).map(([k, v]) => [k, v!.dataSourceId])) as Partial<Record<DbName, string>>;
          stand.datenbanken[db] = await client.legeDatenbankAn(parent, db, ziele);
        }
        st.schreibe("notion.json", stand);
      }
      for (const db of DB_REIHENFOLGE) {
        const r = await synchronisiere({ client, stand, db, datensaetze: daten[db], schreiben, speichere: (s) => st.schreibe("notion.json", s) });
        console.log(`${db}: ${schreiben ? "" : "(Trockenlauf) "}neu ${r.neu}, geändert ${r.geaendert}, unverändert ${r.unveraendert}${r.dubletten.length ? `, Dubletten ${r.dubletten.join(", ")}` : ""}${r.fehler.length ? `\n  Fehler: ${r.fehler.join("; ")}` : ""}`);
      }
      return;
    }
    case "bericht": {
      const w = arg(a, "--woche") ? parseWoche(arg(a, "--woche"), jetzt) : isoWoche(jetzt);
      const sales = new SalesStore(SALES_DIR);
      const states = resolveAccounts(Object.values(sales.events())).map(accountState);
      const text = wochenbericht({ woche: w, plaene: st.plaene(), states, jetzt, salesStand: jetzt.toISOString().slice(0, 16) });
      const n = `berichte/${w.jahr}-KW${String(w.kw).padStart(2, "0")}-content.md`;
      st.schreibe(n, text);
      console.log(text + `\n→ ${st.pfad(n)}`);
      return;
    }
    default:
      throw new Error(`Unbekannter Befehl ${cmd}`);
  }
}

main().catch((e) => { console.error(`Fehler: ${(e as Error).message}`); process.exit(1); });
