// Notion als Recherche- und Redaktionsbibliothek (NICHT als CRM).
//
// API-Stand (geprüft 2026-11-22, developers.notion.com):
//   Notion-Version 2026-03-11 (Data Sources seit 2025-09-03): Seiten einer
//   Datenbank haben parent {type:"data_source_id"}; Abfrage über
//   POST /v1/data_sources/{id}/query, page_size ≤ 100, next_cursor.
//   429/529 mit Retry-After; rich_text ≤ 2000 Zeichen je Element, ≤ 100 Elemente.
// Idempotenz: Schlüssel ist die Eigenschaft "Externe ID". Ein Journal
// (Externe ID → pageId + Fingerabdruck) überspringt Unverändertes und erlaubt
// Wiederaufnahme nach Teilfehlern: nach jedem erfolgreichen Upsert wird es
// geschrieben. Bestehende Seiten werden nur in den eigenen Eigenschaften
// geändert, nie gelöscht, Seiteninhalte (Blöcke) werden nicht angefasst.

import type { Idee } from "./ideen.js";
import { anfrage, echterAbruf, type Abruf, type RetryOpt } from "./http.js";
import type { AccountRang, ReferenzAccount, VideoReferenz } from "./modell.js";
import { fingerabdruck } from "./modell.js";
import type { Redaktionsplan, Veroeffentlichung } from "./wochenplan.js";

export const NOTION_VERSION = process.env.NOTION_VERSION ?? "2026-03-11";
const BASIS = "https://api.notion.com/v1";

export type DbName = "accounts" | "videos" | "ideen" | "veroeffentlichungen";
export const DB_TITEL: Record<DbName, string> = {
  accounts: "Content · Accounts (Vorbilder & Wettbewerber)",
  videos: "Content · Video-Referenzen",
  ideen: "Content · HeyAudit-Ideen & Skripte",
  veroeffentlichungen: "Content · Kampagnen & Veröffentlichungen",
};

type Typ = "title" | "rich_text" | "number" | "select" | "url" | "date" | "relation";
export interface Spalte { name: string; typ: Typ; ziel?: DbName; optionen?: string[] }

const sel = (name: string, optionen: string[]): Spalte => ({ name, typ: "select", optionen });
const PLATTF = ["instagram", "tiktok", "youtube", "facebook", "linkedin"];
const FUNNEL = ["TOFU", "MOFU", "BOFU"];

export const SCHEMA: Record<DbName, Spalte[]> = {
  accounts: [
    { name: "Handle", typ: "title" }, { name: "Externe ID", typ: "rich_text" }, sel("Plattform", PLATTF), { name: "Profil-URL", typ: "url" },
    { name: "Sprache/Markt", typ: "rich_text" }, sel("Gruppe", ["wettbewerber", "vorbild"]), { name: "Kategorie", typ: "rich_text" },
    sel("Zielgruppenpassung", ["hoch", "mittel", "niedrig"]), { name: "Follower", typ: "number" }, sel("Follower-Status", ["öffentlich gesehen", "geschätzt", "nicht erhoben"]),
    { name: "Rang", typ: "number" }, { name: "Rang-Lücken", typ: "rich_text" }, { name: "Quelle", typ: "url" }, { name: "Recherchiert am", typ: "date" },
    { name: "Begründung", typ: "rich_text" }, { name: "Unsicherheit", typ: "rich_text" },
  ],
  videos: [
    { name: "Video", typ: "title" }, { name: "Externe ID", typ: "rich_text" }, { name: "Account", typ: "relation", ziel: "accounts" }, sel("Plattform", PLATTF),
    { name: "URL", typ: "url" }, { name: "Veröffentlicht", typ: "date" }, { name: "Laufzeit (s)", typ: "number" }, { name: "Views", typ: "number" },
    { name: "Likes", typ: "number" }, { name: "Kommentare", typ: "number" }, { name: "Shares", typ: "number" }, { name: "Score", typ: "number" },
    { name: "Score-Lücken", typ: "rich_text" }, { name: "Hook (Analyse)", typ: "rich_text" }, { name: "First Frame", typ: "rich_text" },
    sel("Inhaltsart", ["transkript", "zusammenfassung", "nicht verfügbar"]), { name: "Inhalt", typ: "rich_text" }, { name: "Thema", typ: "rich_text" },
    { name: "Format", typ: "rich_text" }, sel("Funnel", FUNNEL), { name: "CTA", typ: "rich_text" }, { name: "Quelle & Rechte", typ: "rich_text" }, { name: "Abgerufen", typ: "date" },
  ],
  ideen: [
    { name: "Hook", typ: "title" }, { name: "Externe ID", typ: "rich_text" }, sel("Funnel", FUNNEL), { name: "Format", typ: "rich_text" }, { name: "Thema", typ: "rich_text" },
    { name: "Zielgruppe", typ: "rich_text" }, { name: "Problem", typ: "rich_text" }, { name: "First Frame", typ: "rich_text" }, { name: "Skriptgerüst", typ: "rich_text" },
    { name: "CTA", typ: "rich_text" }, { name: "Belege", typ: "rich_text" }, { name: "Offene Platzhalter", typ: "rich_text" }, { name: "Referenzmuster", typ: "rich_text" },
    sel("Status", ["entwurf", "gesperrt", "freigegeben", "verworfen"]), { name: "Referenzvideos", typ: "relation", ziel: "videos" },
  ],
  veroeffentlichungen: [
    { name: "Veröffentlichung", typ: "title" }, { name: "Externe ID", typ: "rich_text" }, { name: "Kampagnen-ID", typ: "rich_text" }, { name: "Content-ID", typ: "rich_text" },
    sel("Plattform", PLATTF), sel("Status", ["entwurf", "intern_pruefen", "freigegeben", "geplant", "veroeffentlicht", "manuell_veroeffentlichen", "fehlgeschlagen", "verworfen", "nicht_vorgesehen"]),
    { name: "Geplant", typ: "date" }, { name: "Veröffentlicht", typ: "date" }, { name: "Metricool-Status", typ: "rich_text" }, { name: "UTM-Link", typ: "url" },
    { name: "Views", typ: "number" }, { name: "Likes", typ: "number" }, { name: "Kommentare", typ: "number" }, { name: "Linkklicks", typ: "number" },
    { name: "Sales-Zuordnung", typ: "rich_text" }, { name: "Idee", typ: "relation", ziel: "ideen" },
  ],
};

// ── Werte → Notion-Eigenschaften ─────────────────────────────────────────
export interface Datensatz { externeId: string; werte: Record<string, string | number | null | undefined | string[]> }

/** Text in ≤2000-Zeichen-Stücke, höchstens 100 Stücke. */
export function richText(t: string): Array<{ type: "text"; text: { content: string } }> {
  const out = [];
  for (let i = 0; i < t.length && out.length < 100; i += 2000) out.push({ type: "text" as const, text: { content: t.slice(i, i + 2000) } });
  return out;
}

export function eigenschaften(db: DbName, d: Datensatz, relationen: (ziel: DbName, externeIds: string[]) => string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const s of SCHEMA[db]) {
    const v = s.name === "Externe ID" ? d.externeId : d.werte[s.name];
    if (v === undefined) continue;
    switch (s.typ) {
      case "title": props[s.name] = { title: richText(String(v ?? "")).slice(0, 1) }; break;
      case "rich_text": props[s.name] = { rich_text: v === null ? [] : richText(String(v)) }; break;
      case "number": props[s.name] = { number: v === null || v === "" ? null : Number(v) }; break;
      case "select": props[s.name] = { select: v ? { name: String(v) } : null }; break;
      case "url": props[s.name] = { url: v ? String(v).slice(0, 2000) : null }; break;
      case "date": props[s.name] = { date: v ? { start: String(v) } : null }; break;
      case "relation": props[s.name] = { relation: relationen(s.ziel!, Array.isArray(v) ? v : [String(v)]).slice(0, 100).map((id) => ({ id })) }; break;
    }
  }
  return props;
}

// ── Abbildung der Content-Objekte ────────────────────────────────────────
export function accountDatensatz(a: ReferenzAccount, r?: AccountRang): Datensatz {
  return { externeId: a.id, werte: {
    Handle: a.handle, Plattform: a.plattform, "Profil-URL": a.profilUrl, "Sprache/Markt": a.sprache_markt, Gruppe: a.gruppe, Kategorie: a.kategorie,
    Zielgruppenpassung: a.zielgruppenpassung, Follower: a.follower, "Follower-Status": a.follower_status, Rang: r?.rang ?? null,
    "Rang-Lücken": r ? r.luecken.join("; ") : "noch nicht gerankt", Quelle: a.quelle, "Recherchiert am": a.recherchiertAm.slice(0, 10),
    Begründung: a.begruendung, Unsicherheit: a.unsicherheit ?? "",
  } };
}

export function videoDatensatz(v: VideoReferenz): Datensatz {
  return { externeId: v.id, werte: {
    Video: v.id, Account: [v.accountId], Plattform: v.plattform, URL: v.url, "Veröffentlicht": v.veroeffentlichtAm?.slice(0, 10) ?? null,
    "Laufzeit (s)": v.laufzeitSek ?? null, Views: v.views ?? null, Likes: v.likes ?? null, Kommentare: v.kommentare ?? null, Shares: v.shares ?? null,
    Score: v.score?.wert ?? null, "Score-Lücken": v.score?.luecken.join("; ") ?? "nicht bewertet", "Hook (Analyse)": v.hookAnalyse ?? "nicht erhoben",
    "First Frame": v.firstFrame ?? "nicht erhoben", Inhaltsart: v.inhalt?.art ?? "nicht verfügbar",
    Inhalt: v.inhalt?.text ? `${v.inhalt.text} [Quelle: ${v.inhalt.quelle}, Konfidenz ${v.inhalt.konfidenz}]` : "", Thema: v.thema ?? "", Format: v.format ?? "",
    Funnel: v.funnel ?? null, CTA: v.cta ?? "", "Quelle & Rechte": `${v.quelle.methode}${v.quelle.actor ? ` ${v.quelle.actor}` : ""}${v.quelle.laufId ? ` Lauf ${v.quelle.laufId}` : ""} · ${v.quelle.rechte}`,
    Abgerufen: v.abgerufenAm.slice(0, 10),
  } };
}

export function ideeDatensatz(i: Idee, referenzvideos: string[] = []): Datensatz {
  return { externeId: i.id, werte: {
    Hook: i.hook, Funnel: i.funnel, Format: i.format, Thema: `${i.thema} / ${i.unterthema}`, Zielgruppe: i.zielgruppe, Problem: i.schmerz,
    "First Frame": i.firstFrame, Skriptgerüst: i.skript.map((b) => `${b.nr}. [${b.sek}s] ${b.sprecher} — ${b.bild}`).join("\n"),
    CTA: `${i.cta.text} → ${i.cta.ziel}`, Belege: i.faktencheck.map((f) => `${f.id}: ${f.quelle}`).join("\n") || "keine Produktaussage",
    "Offene Platzhalter": i.offen.join(" · "), Referenzmuster: `${i.muster.map((m) => m.id).join(", ")} — ${i.unterschied}`, Status: i.status,
    Referenzvideos: referenzvideos,
  } };
}

export function pubDatensatz(p: Redaktionsplan, v: Veroeffentlichung, ideeId: string, salesZuordnung = ""): Datensatz {
  return { externeId: v.id, werte: {
    "Veröffentlichung": v.id, "Kampagnen-ID": p.kampagnenId, "Content-ID": v.contentId, Plattform: v.plattform, Status: v.status,
    Geplant: v.geplant ?? null, "Veröffentlicht": v.veroeffentlichtAm ?? null, "Metricool-Status": v.metricool?.status ?? v.grund ?? "",
    "UTM-Link": v.link ?? null, Views: v.kennzahlen?.views ?? null, Likes: v.kennzahlen?.likes ?? null, Kommentare: v.kennzahlen?.kommentare ?? null,
    Linkklicks: v.kennzahlen?.linkklicks ?? null, "Sales-Zuordnung": salesZuordnung, Idee: [ideeId],
  } };
}

// ── Client ───────────────────────────────────────────────────────────────
export interface NotionStand { datenbanken: Partial<Record<DbName, { databaseId: string; dataSourceId: string }>>; journal: Partial<Record<DbName, Record<string, { pageId: string; hash: string }>>> }

export class NotionClient {
  constructor(private readonly token: string, private readonly abruf: Abruf = echterAbruf, private readonly retry: RetryOpt = {}) {}
  private h() { return { Authorization: `Bearer ${this.token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" }; }
  req<T>(method: string, pfad: string, body?: unknown): Promise<T> {
    return anfrage<T>("Notion", this.abruf, BASIS + pfad, { method, headers: this.h(), ...(body !== undefined ? { body } : {}) }, this.retry);
  }
  async dataSourceVon(databaseId: string): Promise<string> {
    const r = await this.req<{ data_sources?: Array<{ id: string }> }>("GET", `/databases/${databaseId}`);
    const id = r.data_sources?.[0]?.id;
    if (!id) throw new Error(`Notion-Datenbank ${databaseId} hat keine Data Source (falsche ID oder Integration nicht freigegeben)`);
    return id;
  }
  async spaltenVon(dataSourceId: string): Promise<string[]> {
    const r = await this.req<{ properties?: Record<string, unknown> }>("GET", `/data_sources/${dataSourceId}`);
    return Object.keys(r.properties ?? {});
  }
  /** Alle Seiten mit dieser Externen ID (paginiert). */
  async sucheExtern(dataSourceId: string, externeId: string): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.req<{ results: Array<{ id: string }>; has_more: boolean; next_cursor: string | null }>("POST", `/data_sources/${dataSourceId}/query`, {
        filter: { property: "Externe ID", rich_text: { equals: externeId } }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
      });
      ids.push(...r.results.map((x) => x.id));
      cursor = r.has_more && r.next_cursor ? r.next_cursor : undefined;
    } while (cursor);
    return ids;
  }
  async legeDatenbankAn(parentPageId: string, db: DbName, ziele: Partial<Record<DbName, string>>): Promise<{ databaseId: string; dataSourceId: string }> {
    const properties: Record<string, unknown> = {};
    for (const s of SCHEMA[db]) {
      if (s.typ === "relation") {
        const ziel = ziele[s.ziel!];
        if (!ziel) throw new Error(`Relation ${s.name}: Ziel ${s.ziel} fehlt`);
        properties[s.name] = { relation: { data_source_id: ziel, single_property: {} } };
      } else if (s.typ === "select") properties[s.name] = { select: { options: (s.optionen ?? []).map((name) => ({ name })) } };
      else properties[s.name] = { [s.typ]: {} };
    }
    const r = await this.req<{ id: string; data_sources?: Array<{ id: string }> }>("POST", "/databases", {
      parent: { type: "page_id", page_id: parentPageId }, title: richText(DB_TITEL[db]), initial_data_source: { properties },
    });
    const ds = r.data_sources?.[0]?.id ?? (await this.dataSourceVon(r.id));
    return { databaseId: r.id, dataSourceId: ds };
  }
}

export const DB_REIHENFOLGE: DbName[] = ["accounts", "videos", "ideen", "veroeffentlichungen"];

export interface SyncErgebnis { db: DbName; neu: number; geaendert: number; unveraendert: number; dubletten: string[]; fehler: string[] }

/**
 * Idempotenter Upsert. `speichere` wird nach JEDEM erfolgreichen Schreibvorgang
 * aufgerufen (Wiederaufnahme). Bei schreiben=false wird nichts gesendet
 * (Trockenlauf: nur gezählt, ohne Abfrage).
 */
export async function synchronisiere(o: {
  client: NotionClient | undefined; stand: NotionStand; db: DbName; datensaetze: Datensatz[]; schreiben: boolean; speichere: (s: NotionStand) => void; maxFehler?: number;
}): Promise<SyncErgebnis> {
  const erg: SyncErgebnis = { db: o.db, neu: 0, geaendert: 0, unveraendert: 0, dubletten: [], fehler: [] };
  const journal = (o.stand.journal[o.db] ??= {});
  const ds = o.stand.datenbanken[o.db]?.dataSourceId;
  const rel = (ziel: DbName, ext: string[]) => ext.map((e) => o.stand.journal[ziel]?.[e]?.pageId).filter((x): x is string => !!x);
  const gesehen = new Set<string>();
  for (const d of o.datensaetze) {
    if (!d.externeId) { erg.fehler.push("Datensatz ohne Externe ID übersprungen"); continue; }
    if (gesehen.has(d.externeId)) { erg.dubletten.push(d.externeId); continue; }
    gesehen.add(d.externeId);
    const props = eigenschaften(o.db, d, rel);
    const hash = fingerabdruck(props);
    const bekannt = journal[d.externeId];
    if (bekannt?.hash === hash) { erg.unveraendert++; continue; }
    if (!o.schreiben || !o.client || !ds) { bekannt ? erg.geaendert++ : erg.neu++; continue; }
    try {
      let pageId = bekannt?.pageId;
      if (!pageId) {
        const treffer = await o.client.sucheExtern(ds, d.externeId);
        if (treffer.length > 1) erg.dubletten.push(`${d.externeId} (${treffer.length}× in Notion, erste wird gepflegt)`);
        pageId = treffer[0];
      }
      if (pageId) { await o.client.req("PATCH", `/pages/${pageId}`, { properties: props }); erg.geaendert++; }
      else { const r = await o.client.req<{ id: string }>("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds }, properties: props }); pageId = r.id; erg.neu++; }
      journal[d.externeId] = { pageId, hash };
      o.speichere(o.stand);
    } catch (e) {
      erg.fehler.push(`${d.externeId}: ${(e as Error).message}`);
      if (erg.fehler.length >= (o.maxFehler ?? 5)) { erg.fehler.push("Abbruch nach zu vielen Fehlern — erneut starten setzt fort"); break; }
    }
  }
  return erg;
}

// ── Fallback ohne Notion: Schema- und Importdateien ─────────────────────
export function csvZeile(werte: Array<string | number | null | undefined>): string {
  return werte.map((v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",");
}

export function exportCsv(db: DbName, datensaetze: Datensatz[]): string {
  const spalten = SCHEMA[db].map((s) => s.name);
  return [csvZeile(spalten), ...datensaetze.map((d) => csvZeile(spalten.map((s) => {
    const v = s === "Externe ID" ? d.externeId : d.werte[s];
    return Array.isArray(v) ? v.join("; ") : v;
  })))].join("\n") + "\n";
}
