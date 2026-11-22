// HeyAudit Content-System — Datenmodell, stabile IDs, UTM, Statusfluss, Scoring.
//
// Grenzen (fest, nicht konfigurierbar):
//   * Recherche-Accounts und Video-Referenzen sind Musterquellen, KEINE Leads.
//     Nichts aus diesem Modul erzeugt SalesEvents. Leads entstehen nur im
//     Sales-System (src/sales) aus Formular, Buchung, Signup oder einer
//     ausdrücklichen Anfrage (sales -- ig-antwort).
//   * Zahlen werden nie plattformübergreifend verglichen: jeder Score ist ein
//     Perzentil innerhalb derselben Plattform.

import { createHash } from "node:crypto";

export const CONTENT_SCHEMA_VERSION = 1;

export type Plattform = "instagram" | "tiktok" | "youtube" | "facebook" | "linkedin";
export const PLATTFORMEN: readonly Plattform[] = ["instagram", "tiktok", "youtube", "facebook", "linkedin"];

/** Kürzel in utm_campaign. "ig"/"li" sind bereits im Growth-OS so belegt (ig-2026-kw47-<motiv>). */
export const KUERZEL: Record<Plattform, string> = { instagram: "ig", tiktok: "tt", youtube: "yt", facebook: "fb", linkedin: "li" };

export type Funnel = "TOFU" | "MOFU" | "BOFU";

// ── Recherche ────────────────────────────────────────────────────────────
export type Gruppe = "wettbewerber" | "vorbild";
export type Passung = "hoch" | "mittel" | "niedrig";
export type Wertstatus = "öffentlich gesehen" | "geschätzt" | "nicht erhoben";

export interface ReferenzAccount {
  /** Stabil: "<plattform>:<handle klein>". */
  id: string;
  plattform: Plattform;
  handle: string;
  profilUrl: string;
  sprache_markt: string;
  gruppe: Gruppe;
  kategorie: string;
  zielgruppenpassung: Passung;
  passungGrund?: string;
  follower: number | null;
  follower_status: Wertstatus;
  follower_stand?: string;
  aktivitaet?: string;
  formatqualitaet_notiz?: string;
  quelle: string;
  recherchiertAm: string;
  begruendung: string;
  unsicherheit?: string;
}

export interface VideoReferenz {
  /** Stabil: "<plattform>:<native Video-ID>". */
  id: string;
  plattform: Plattform;
  accountId: string;
  url: string;
  abgerufenAm: string;
  veroeffentlichtAm?: string;
  laufzeitSek?: number;
  views?: number;
  likes?: number;
  kommentare?: number;
  shares?: number;
  /** Followerzahl des Accounts zum Abrufzeitpunkt (für Views/Follower). */
  followerBeiAbruf?: number;
  /** Analytische Kurzfassung der Hook — NIE der Originalwortlaut. */
  hookAnalyse?: string;
  firstFrame?: string;
  /** Nur wenn rechtmäßig und dauerhaft verfügbar; sonst leer. */
  bildUrl?: string;
  inhalt?: { art: "transkript" | "zusammenfassung" | "nicht verfügbar"; text?: string; sprache?: string; quelle: string; konfidenz: "hoch" | "mittel" | "niedrig" };
  thema?: string;
  unterthema?: string;
  zielgruppe?: string;
  funnel?: Funnel;
  format?: string;
  cta?: string;
  score?: VideoScore;
  quelle: { methode: "apify" | "manuell" | "import"; laufId?: string; actor?: string; rechte: string };
  verarbeitetAm: string;
}

export const accountId = (p: Plattform, handle: string) => `${p}:${handle.trim().replace(/^@/, "").toLowerCase()}`;
export const videoId = (p: Plattform, nativeId: string) => `${p}:${nativeId.trim()}`;

// ── Scoring ──────────────────────────────────────────────────────────────
//
// Video-Score (0–100) je Plattform:
//   reichweite = views / followerBeiAbruf            (Accountgröße normalisiert)
//   interaktion = (likes + kommentare + shares) / views
//   tempo      = views / sqrt(alterTage)             (Performance-Geschwindigkeit)
// Jede Komponente wird in ein Perzentil (0–1) INNERHALB derselben Plattform
// umgerechnet. Gewichte 0.40 / 0.35 / 0.25; fehlende Komponenten fallen weg
// und die übrigen Gewichte werden neu normiert. Unter zwei Komponenten gibt es
// keinen Score (zu wenig Daten). Rohe Views oder Follower gehen nie direkt ein.

export const VIDEO_GEWICHTE = { reichweite: 0.4, interaktion: 0.35, tempo: 0.25 } as const;
export const SCORE_FORMEL =
  "Score = 100 × Σ(w·Perzentil)/Σw je Plattform; reichweite=Views/Follower (w .40), interaktion=(Likes+Kommentare+Shares)/Views (w .35), tempo=Views/√Alter in Tagen (w .25); fehlende Komponenten fallen weg; <2 Komponenten = kein Score.";

export interface VideoScore { wert: number | null; komponenten: Partial<Record<keyof typeof VIDEO_GEWICHTE, number>>; luecken: string[]; formel: string }

type Roh = Partial<Record<keyof typeof VIDEO_GEWICHTE, number>>;

function rohwerte(v: VideoReferenz, jetzt: Date): { roh: Roh; luecken: string[] } {
  const roh: Roh = {};
  const luecken: string[] = [];
  if (v.views !== undefined && v.followerBeiAbruf) roh.reichweite = v.views / v.followerBeiAbruf;
  else luecken.push(v.views === undefined ? "views fehlen" : "follower fehlen");
  const inter = [v.likes, v.kommentare, v.shares].filter((x): x is number => x !== undefined);
  if (v.views && inter.length) {
    roh.interaktion = inter.reduce((a, b) => a + b, 0) / v.views;
    if (inter.length < 3) luecken.push("interaktion unvollständig (" + ["likes", "kommentare", "shares"].filter((_, i) => [v.likes, v.kommentare, v.shares][i] === undefined).join(", ") + " fehlen)");
  } else luecken.push("interaktion nicht berechenbar");
  if (v.views !== undefined && v.veroeffentlichtAm) {
    const tage = Math.max(1, (jetzt.getTime() - Date.parse(v.veroeffentlichtAm)) / 86_400_000);
    roh.tempo = v.views / Math.sqrt(tage);
  } else luecken.push("tempo nicht berechenbar (Datum oder Views fehlen)");
  return { roh, luecken };
}

/** Perzentil-Rang (0–1, Mittelrang bei Gleichstand). */
export function perzentil(werte: number[], x: number): number {
  if (werte.length <= 1) return 0.5;
  const kleiner = werte.filter((w) => w < x).length;
  const gleich = werte.filter((w) => w === x).length;
  return (kleiner + (gleich - 1) / 2) / (werte.length - 1);
}

/** Scores für alle Videos, getrennt je Plattform. Gibt neue Objekte zurück. */
export function bewerteVideos(videos: VideoReferenz[], jetzt: Date): VideoReferenz[] {
  const roh = new Map(videos.map((v) => [v.id, rohwerte(v, jetzt)]));
  const out: VideoReferenz[] = [];
  for (const p of PLATTFORMEN) {
    const gruppe = videos.filter((v) => v.plattform === p);
    const spalten = Object.fromEntries(
      (Object.keys(VIDEO_GEWICHTE) as Array<keyof typeof VIDEO_GEWICHTE>).map((k) => [k, gruppe.map((v) => roh.get(v.id)?.roh[k]).filter((x): x is number => x !== undefined)]),
    ) as Record<keyof typeof VIDEO_GEWICHTE, number[]>;
    for (const v of gruppe) {
      const r = roh.get(v.id)!;
      const komp: VideoScore["komponenten"] = {};
      let summe = 0, gewicht = 0;
      for (const k of Object.keys(VIDEO_GEWICHTE) as Array<keyof typeof VIDEO_GEWICHTE>) {
        const x = r.roh[k];
        if (x === undefined) continue;
        const pz = perzentil(spalten[k], x);
        komp[k] = Math.round(pz * 1000) / 1000;
        summe += VIDEO_GEWICHTE[k] * pz;
        gewicht += VIDEO_GEWICHTE[k];
      }
      const n = Object.keys(komp).length;
      const luecken = [...r.luecken];
      if (spalten.reichweite.length < 5) luecken.push(`kleine Vergleichsmenge auf ${p} (${gruppe.length} Videos)`);
      out.push({ ...v, score: { wert: n >= 2 ? Math.round((100 * summe) / gewicht) : null, komponenten: komp, luecken, formel: SCORE_FORMEL } });
    }
  }
  return out;
}

// Account-Ranking (0–100): Relevanz .40 · Median-Videoscore .30 · Aktualität .15 · Formatqualität .15.
// Fehlende Komponenten fallen weg (Gewichte neu normiert) und stehen in `luecken`.
export const ACCOUNT_FORMEL =
  "Rang = 100 × Σ(w·x)/Σw; Relevanz (hoch 1/mittel .6/niedrig .2, w .40), Median-Videoscore/100 (w .30), Aktualität (letztes Video ≤30 T = 1, ≤90 T = .5, älter 0; w .15), Formatqualität 0–1 manuell (w .15).";

export interface AccountRang { accountId: string; rang: number; komponenten: Record<string, number>; luecken: string[]; videos: number; formel: string }

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function rangiereAccounts(accounts: ReferenzAccount[], videos: VideoReferenz[], jetzt: Date, formatqualitaet: Record<string, number> = {}): AccountRang[] {
  const rel = { hoch: 1, mittel: 0.6, niedrig: 0.2 } as const;
  return accounts.map((a) => {
    const eigene = videos.filter((v) => v.accountId === a.id);
    const scores = eigene.map((v) => v.score?.wert).filter((x): x is number => typeof x === "number");
    const komp: Record<string, number> = { relevanz: rel[a.zielgruppenpassung] };
    const w: Record<string, number> = { relevanz: 0.4 };
    const luecken: string[] = [];
    const med = median(scores);
    if (med !== undefined) { komp.performance = med / 100; w.performance = 0.3; } else luecken.push("keine bewerteten Videos");
    const letzte = eigene.map((v) => (v.veroeffentlichtAm ? Date.parse(v.veroeffentlichtAm) : NaN)).filter((x) => !Number.isNaN(x));
    if (letzte.length) {
      const tage = (jetzt.getTime() - Math.max(...letzte)) / 86_400_000;
      komp.aktualitaet = tage <= 30 ? 1 : tage <= 90 ? 0.5 : 0; w.aktualitaet = 0.15;
    } else luecken.push("Aktualität unbekannt");
    const fq = formatqualitaet[a.id];
    if (fq !== undefined) { komp.format = Math.min(1, Math.max(0, fq)); w.format = 0.15; } else luecken.push("Formatqualität nicht bewertet");
    const sw = Object.values(w).reduce((x, y) => x + y, 0);
    const rang = Math.round((100 * Object.entries(w).reduce((s, [k, g]) => s + g * (komp[k] ?? 0), 0)) / sw);
    return { accountId: a.id, rang, komponenten: komp, luecken, videos: eigene.length, formel: ACCOUNT_FORMEL };
  }).sort((x, y) => y.rang - x.rang);
}

// ── Kampagnen, Content-IDs, UTM ──────────────────────────────────────────
//
// Kampagne   = eine Redaktionswoche:          content-2026-kw49
// Content-ID = ein Kernvideo dieser Woche:    cv-2026kw49-3   (3 = Slot 1..7)
// Veröffentl.= Kernvideo × Plattform:         cv-2026kw49-3.ig
// utm_campaign trägt die Content-ID, weil die App nur utm_source + utm_campaign
// an das Sales-System meldet (utm_content geht verloren):
//   utm_source=instagram  utm_medium=social-video  utm_campaign=ig-2026-kw49-cv3  utm_content=<ideeId>

export interface Woche { jahr: number; kw: number }
export const kampagnenId = (w: Woche) => `content-${w.jahr}-kw${String(w.kw).padStart(2, "0")}`;
export const contentId = (w: Woche, slot: number) => `cv-${w.jahr}kw${String(w.kw).padStart(2, "0")}-${slot}`;
export const veroeffentlichungsId = (cid: string, p: Plattform) => `${cid}.${KUERZEL[p]}`;

export function utmCampaign(w: Woche, slot: number, p: Plattform): string {
  return `${KUERZEL[p]}-${w.jahr}-kw${String(w.kw).padStart(2, "0")}-cv${slot}`;
}

const UTM_MUSTER = /^(ig|tt|yt|fb|li)-(\d{4})-kw(\d{2})-cv([1-9])$/;

/** utm_campaign → Content-Bezug; undefined, wenn es keine Content-Kampagne ist (z. B. ig-2026-kw47-planung). */
export function parseUtmCampaign(c: string | undefined): { plattform: Plattform; contentId: string; kampagnenId: string } | undefined {
  const m = c?.trim().toLowerCase().match(UTM_MUSTER);
  if (!m) return undefined;
  const plattform = (Object.entries(KUERZEL).find(([, k]) => k === m[1])?.[0]) as Plattform;
  const w = { jahr: Number(m[2]), kw: Number(m[3]) };
  return { plattform, contentId: contentId(w, Number(m[4])), kampagnenId: kampagnenId(w) };
}

export const ZIEL_BASIS = "https://www.heyaudit.de";

export function utmLink(ziel: string, w: Woche, slot: number, p: Plattform, ideeId: string): string {
  const u = new URL(ziel.startsWith("http") ? ziel : ZIEL_BASIS + ziel);
  u.searchParams.set("utm_source", p);
  u.searchParams.set("utm_medium", "social-video");
  u.searchParams.set("utm_campaign", utmCampaign(w, slot, p));
  u.searchParams.set("utm_content", ideeId);
  return u.toString();
}

// ── Statusfluss einer Veröffentlichung ───────────────────────────────────
export type PubStatus =
  | "entwurf" | "intern_pruefen" | "freigegeben" | "geplant" | "veroeffentlicht"
  | "manuell_veroeffentlichen" | "fehlgeschlagen" | "verworfen" | "nicht_vorgesehen";

const UEBERGAENGE: Record<PubStatus, PubStatus[]> = {
  entwurf: ["intern_pruefen", "verworfen"],
  intern_pruefen: ["freigegeben", "entwurf", "verworfen"],
  freigegeben: ["geplant", "manuell_veroeffentlichen", "verworfen"],
  geplant: ["veroeffentlicht", "fehlgeschlagen", "verworfen"],
  manuell_veroeffentlichen: ["veroeffentlicht", "verworfen"],
  fehlgeschlagen: ["geplant", "manuell_veroeffentlichen", "verworfen"],
  veroeffentlicht: [],
  verworfen: [],
  nicht_vorgesehen: [],
};

export function darfWechseln(von: PubStatus, nach: PubStatus): boolean {
  return UEBERGAENGE[von].includes(nach);
}

export function wechsle(von: PubStatus, nach: PubStatus): PubStatus {
  if (von === nach) return von; // idempotent
  if (!darfWechseln(von, nach)) throw new Error(`Statuswechsel ${von} → ${nach} ist nicht erlaubt`);
  return nach;
}

/** Inhaltlicher Fingerabdruck für idempotente Syncs (unverändert = überspringen). */
export function fingerabdruck(x: unknown): string {
  return createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
}

// ── ISO-Woche (Europe/Berlin) ────────────────────────────────────────────
export function isoWoche(d: Date): Woche {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [y, m, t] = p.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, t));
  const wd = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - wd + 3);
  const jahr = date.getUTCFullYear();
  const erster = new Date(Date.UTC(jahr, 0, 4));
  const kw = 1 + Math.round(((date.getTime() - erster.getTime()) / 86_400_000 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7);
  return { jahr, kw };
}

/** Montag (YYYY-MM-DD) einer ISO-Woche. */
export function montag(w: Woche): string {
  const jan4 = new Date(Date.UTC(w.jahr, 0, 4));
  const mo = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (w.kw - 1) * 7 * 86_400_000);
  return mo.toISOString().slice(0, 10);
}

// ── Import der Recherche-Kandidaten (JSON aus öffentlicher Recherche) ────
/** Prüft und normalisiert einen Kandidaten; undefined = verworfen (mit Grund im zweiten Feld). */
export function pruefeKandidat(raw: unknown, recherchiertAm: string): [ReferenzAccount | undefined, string?] {
  if (!raw || typeof raw !== "object") return [undefined, "kein Objekt"];
  const r = raw as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const p = s("plattform").toLowerCase() as Plattform;
  if (!PLATTFORMEN.includes(p)) return [undefined, `unbekannte Plattform ${s("plattform")}`];
  const handle = s("handle").replace(/^@/, "");
  const url = s("profilUrl");
  if (!handle || !/^https:\/\//.test(url)) return [undefined, `${p}: Handle oder Profil-URL fehlt`];
  if (!/^https:\/\//.test(s("quelle"))) return [undefined, `${p}:${handle}: kein Quellnachweis`];
  const g = s("gruppe");
  if (g !== "wettbewerber" && g !== "vorbild") return [undefined, `${p}:${handle}: Gruppe ${g}`];
  const pz = s("zielgruppenpassung");
  const passung = (["hoch", "mittel", "niedrig"] as Passung[]).find((x) => pz.toLowerCase().startsWith(x));
  if (!passung) return [undefined, `${p}:${handle}: Zielgruppenpassung fehlt`];
  const f = r.follower;
  const fw = typeof f === "number" ? f : f && typeof f === "object" && typeof (f as { wert?: unknown }).wert === "number" ? (f as { wert: number }).wert : null;
  const fstand = f && typeof f === "object" && typeof (f as { stand?: unknown }).stand === "string" ? (f as { stand: string }).stand : undefined;
  const fs = s("follower_status") as Wertstatus;
  const grund = pz.replace(/^(hoch|mittel|niedrig)\s*[–-]?\s*/i, "");
  return [{
    id: accountId(p, handle), plattform: p, handle, profilUrl: url, sprache_markt: s("sprache_markt") || "unbekannt", gruppe: g,
    kategorie: s("kategorie"), zielgruppenpassung: passung, ...(grund ? { passungGrund: grund } : {}),
    follower: fw, follower_status: fw === null ? "nicht erhoben" : (["öffentlich gesehen", "geschätzt"].includes(fs) ? fs : "geschätzt"),
    ...(fstand ? { follower_stand: fstand } : {}), ...(s("aktivitaet") ? { aktivitaet: s("aktivitaet") } : {}),
    ...(s("formatqualitaet_notiz") ? { formatqualitaet_notiz: s("formatqualitaet_notiz") } : {}),
    quelle: s("quelle"), recherchiertAm, begruendung: s("begruendung"), ...(s("unsicherheit") ? { unsicherheit: s("unsicherheit") } : {}),
  }];
}
