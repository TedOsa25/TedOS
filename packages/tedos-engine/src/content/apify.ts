// Apify-Erhebung öffentlicher Videos — nur mit Budget, nur in Batches.
//
// Stand der Actors/Preise: Apify Store, geprüft 2026-11-22 (Pay-per-Event,
// Preise je 1.000 Ergebnisse im Free-Tarif, auf bezahlten Tarifen niedriger).
// Vor dem ersten echten Lauf werden Actor, Build und Preis zur Laufzeit
// gelesen (GET /v2/acts/{id}); weicht der Preis ab, gilt der höhere Wert.
// Ohne CONTENT_APIFY_BUDGET_USD läuft NICHTS — es gibt nur Plan + Kostenschätzung.
// Jeder Lauf trägt maxTotalChargeUsd (harte Kostengrenze bei Apify).

import { anfrage, echterAbruf, type Abruf, type RetryOpt } from "./http.js";
import type { Plattform, ReferenzAccount, VideoReferenz } from "./modell.js";
import { accountId, videoId } from "./modell.js";

export interface ActorProfil {
  actor: string;
  usdJe1000: number;
  preisStand: string;
  eingabe: (handles: string[], proAccount: number, seitISO: string) => Record<string, unknown>;
  felder: string;
}

export const ACTORS: Partial<Record<Plattform, ActorProfil>> = {
  instagram: {
    actor: "apify/instagram-scraper", usdJe1000: 2.7, preisStand: "2026-11-22 Free-Tarif",
    eingabe: (h, n, seit) => ({ directUrls: h.map((x) => `https://www.instagram.com/${x}/`), resultsType: "posts", resultsLimit: n, onlyPostsNewerThan: seit.slice(0, 10) }),
    felder: "videoViewCount/videoPlayCount, likesCount (-1 = verborgen), commentsCount, videoDuration, timestamp, caption; Follower nur im Modus details; kein Transkript",
  },
  tiktok: {
    actor: "clockworks/tiktok-scraper", usdJe1000: 1.7, preisStand: "2026-11-22 ab-Preis (Events nicht verifiziert → Puffer 1,5×)",
    eingabe: (h, n, seit) => ({ profiles: h, resultsPerPage: n, oldestPostDateUnified: seit.slice(0, 10) }),
    felder: "playCount, diggCount, commentCount, shareCount, videoMeta.duration, createTimeISO, text, authorMeta.fans, videoMeta.subtitleLinks",
  },
  youtube: {
    actor: "streamers/youtube-shorts-scraper", usdJe1000: 2.4, preisStand: "2026-11-22 ab-Preis",
    eingabe: (h, n, seit) => ({ channels: h, maxResultsShorts: n, oldestPostDate: seit.slice(0, 10) }),
    felder: "viewCount, likes, commentsCount, duration, date, numberOfSubscribers, subtitles",
  },
  facebook: {
    actor: "apify/facebook-reels-scraper", usdJe1000: 3.16, preisStand: "2026-11-22 ab-Preis",
    eingabe: (h, n, seit) => ({ startUrls: h.map((x) => ({ url: `https://www.facebook.com/${x}` })), resultsLimit: n, onlyPostsNewerThan: seit.slice(0, 10) }),
    felder: "playCountRounded, Länge, time, text; Likes/Kommentare/Shares/Follower fehlen in der Beispielausgabe",
  },
  // LinkedIn: nur Drittanbieter-Actors ohne Views/Videolänge → nicht automatisch erhoben (manuelle Sichtung).
};

export const PILOT_MAX = 300;
export const GESAMT_MAX = 1000;
export const PUFFER = 1.5;

export interface Batch { plattform: Plattform; handles: string[]; proAccount: number; schaetzungUsd: number; maxUsd: number }

/** Batches über die gerankten Accounts; nimmt nur noch nicht erhobene. */
export function planeBatches(o: { accounts: ReferenzAccount[]; erledigt: Set<string>; bisherVideos: number; ziel: number; proAccount?: number; batchGroesse?: number }): { batches: Batch[]; hinweise: string[] } {
  const proAccount = o.proAccount ?? 12;
  const groesse = o.batchGroesse ?? 5;
  const ziel = Math.min(o.ziel, GESAMT_MAX);
  let rest = Math.max(0, ziel - o.bisherVideos);
  const batches: Batch[] = [];
  const hinweise: string[] = [];
  // Gleichmäßig über die Plattformen: Quote je Plattform, Batches reihum.
  const offenJe = (Object.keys(ACTORS) as Plattform[])
    .map((p) => ({ p, offen: o.accounts.filter((a) => a.plattform === p && !o.erledigt.has(a.id) && a.zielgruppenpassung !== "niedrig") }))
    .filter((x) => x.offen.length);
  const quote = new Map(offenJe.map((x) => [x.p, Math.ceil(rest / Math.max(1, offenJe.length))]));
  const zeiger = new Map(offenJe.map((x) => [x.p, 0]));
  let weiter = true;
  while (rest > 0 && weiter) {
    weiter = false;
    for (const { p, offen } of offenJe) {
      const i = zeiger.get(p)!;
      const q = quote.get(p)!;
      if (i >= offen.length || q <= 0 || rest <= 0) continue;
      const handles = offen.slice(i, i + groesse).map((a) => a.handle.replace(/^@/, ""));
      const n = Math.min(handles.length * proAccount, q, rest);
      const usd = (n / 1000) * ACTORS[p]!.usdJe1000;
      batches.push({ plattform: p, handles, proAccount, schaetzungUsd: Math.round(usd * 100) / 100, maxUsd: Math.round(usd * PUFFER * 100) / 100 + 0.01 });
      zeiger.set(p, i + groesse); quote.set(p, q - n); rest -= n; weiter = true;
    }
  }
  if (o.accounts.some((a) => a.plattform === "linkedin")) hinweise.push("LinkedIn wird nicht automatisch erhoben (kein Actor mit Views/Videolänge) — manuelle Sichtung.");
  if (rest > 0) hinweise.push(`Ziel ${ziel} Videos mit den vorhandenen Accounts nicht erreichbar (fehlen ${rest}).`);
  return { batches, hinweise };
}

export interface LaufEintrag {
  zeit: string; plattform: Plattform; actor: string; build?: string; runId?: string; eingabe: Record<string, unknown>;
  status: string; ergebnisse: number; kostenUsd?: number; maxUsd: number; fehler?: string;
}

export function verbraucht(laeufe: LaufEintrag[]): number {
  return laeufe.reduce((s, l) => s + (l.kostenUsd ?? (l.status === "SUCCEEDED" ? l.maxUsd : 0)), 0);
}

/** Budgetprüfung VOR jedem Lauf. Ohne Budget: nie. */
export function darfLaufen(budgetUsd: number | undefined, laeufe: LaufEintrag[], b: Batch): { ok: boolean; grund: string } {
  if (budgetUsd === undefined || !Number.isFinite(budgetUsd) || budgetUsd <= 0) return { ok: false, grund: "kein Budget konfiguriert (CONTENT_APIFY_BUDGET_USD) — nur Plan und Kostenschätzung" };
  const rest = budgetUsd - verbraucht(laeufe);
  if (b.maxUsd > rest) return { ok: false, grund: `Budgetrest ${rest.toFixed(2)} $ < Lauf-Obergrenze ${b.maxUsd.toFixed(2)} $` };
  return { ok: true, grund: `Budgetrest ${rest.toFixed(2)} $` };
}

export class ApifyClient {
  constructor(private readonly token: string, private readonly abruf: Abruf = echterAbruf, private readonly retry: RetryOpt = {}) {}
  private h() { return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }; }
  private url(p: string) { return `https://api.apify.com/v2${p}`; }
  actorInfo(actor: string) {
    return anfrage<{ data: { id: string; name: string; taggedBuilds?: Record<string, { buildNumber?: string }> } }>("Apify", this.abruf, this.url(`/acts/${actor.replace("/", "~")}`), { method: "GET", headers: this.h() }, this.retry);
  }
  /** Startet und wartet (max. 300 s je Abfrage); harte Kostengrenze maxTotalChargeUsd. */
  async lauf(actor: string, eingabe: Record<string, unknown>, maxUsd: number, maxItems: number) {
    const q = `?waitForFinish=60&maxTotalChargeUsd=${maxUsd.toFixed(2)}&maxItems=${maxItems}&timeout=900`;
    let run = (await anfrage<{ data: { id: string; status: string; defaultDatasetId: string; usageTotalUsd?: number; buildNumber?: string } }>("Apify", this.abruf, this.url(`/acts/${actor.replace("/", "~")}/runs${q}`), { method: "POST", headers: this.h(), body: eingabe }, this.retry)).data;
    for (let i = 0; i < 15 && ["READY", "RUNNING"].includes(run.status); i++) {
      run = (await anfrage<{ data: typeof run }>("Apify", this.abruf, this.url(`/actor-runs/${run.id}?waitForFinish=60`), { method: "GET", headers: this.h() }, this.retry)).data;
    }
    const items = run.status === "SUCCEEDED" ? await anfrage<unknown[]>("Apify", this.abruf, this.url(`/datasets/${run.defaultDatasetId}/items?clean=true&limit=${maxItems}`), { method: "GET", headers: this.h() }, this.retry) : [];
    return { run, items };
  }
}

// ── Normalisierung der Actor-Ausgaben → VideoReferenz ────────────────────
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const pfad = (o: unknown, ...k: string[]): unknown => k.reduce<unknown>((a, s) => (a && typeof a === "object" ? (a as Record<string, unknown>)[s] : undefined), o);

const RECHTE = "Öffentlich sichtbarer Beitrag; nur Kennzahlen und eigene Analyse gespeichert, kein Video, kein Originaltext übernommen.";

/** Captions werden NICHT gespeichert (Urheberrecht/Datenminimierung) — nur Sprache/Länge als Hinweis für die manuelle Analyse. */
export function normalisiere(p: Plattform, roh: unknown, o: { laufId?: string; actor: string; jetzt: Date; follower?: Record<string, number> }): VideoReferenz | undefined {
  const r = roh as Record<string, unknown>;
  let nativ: string | undefined, handle: string | undefined, url: string | undefined;
  const v: { [K in keyof VideoReferenz]?: VideoReferenz[K] | undefined } = {};
  if (p === "instagram") {
    if (str(r.type) && r.type !== "Video") return undefined;
    nativ = str(r.shortCode) ?? str(r.id); handle = str(r.ownerUsername); url = str(r.url);
    v.views = num(r.videoPlayCount) ?? num(r.videoViewCount); v.likes = num(r.likesCount); v.kommentare = num(r.commentsCount);
    v.laufzeitSek = num(r.videoDuration); const t = str(r.timestamp); if (t) v.veroeffentlichtAm = t;
  } else if (p === "tiktok") {
    nativ = str(r.id); handle = str(pfad(r, "authorMeta", "name")); url = str(r.webVideoUrl);
    v.views = num(r.playCount); v.likes = num(r.diggCount); v.kommentare = num(r.commentCount); v.shares = num(r.shareCount);
    v.laufzeitSek = num(pfad(r, "videoMeta", "duration")); const t = str(r.createTimeISO); if (t) v.veroeffentlichtAm = t;
    const f = num(pfad(r, "authorMeta", "fans")); if (f) v.followerBeiAbruf = f;
  } else if (p === "youtube") {
    nativ = str(r.id); handle = str(r.channelUsername) ?? str(r.channelName); url = str(r.url);
    v.views = num(r.viewCount); v.likes = num(r.likes); v.kommentare = num(r.commentsCount);
    const d = str(r.date); if (d) v.veroeffentlichtAm = d; const s = num(r.numberOfSubscribers); if (s) v.followerBeiAbruf = s;
  } else if (p === "facebook") {
    nativ = str(r.id) ?? str(r.post_id); handle = str(r.pageName) ?? str(pfad(r, "owner", "name")); url = str(r.url);
    v.views = num(r.playCountRounded); v.laufzeitSek = num(pfad(r, "playback_video", "length_in_second"));
    const t = r.time; if (typeof t === "number") v.veroeffentlichtAm = new Date(t * 1000).toISOString(); else if (str(t)) v.veroeffentlichtAm = str(t)!;
  }
  if (!nativ || !handle || !url) return undefined;
  const aid = accountId(p, handle);
  if (!v.followerBeiAbruf && o.follower?.[aid]) v.followerBeiAbruf = o.follower[aid];
  const jetzt = o.jetzt.toISOString();
  const gesetzt = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<VideoReferenz>;
  return {
    ...gesetzt, id: videoId(p, nativ), plattform: p, accountId: aid, url, abgerufenAm: jetzt,
    inhalt: { art: "nicht verfügbar", quelle: "kein Transkript erhoben (Actor-Option aus, Kosten/Rechte)", konfidenz: "hoch" },
    quelle: { methode: "apify", actor: o.actor, ...(o.laufId ? { laufId: o.laufId } : {}), rechte: RECHTE },
    verarbeitetAm: jetzt,
  };
}
