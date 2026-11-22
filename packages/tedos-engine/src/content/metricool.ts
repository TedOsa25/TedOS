// Metricool-Übergabe: standardmäßig nur Review-Warteschlange.
//
// API-Stand (geprüft 2026-11-22, help.metricool.com + app.metricool.com/api/swagger.json v2.0.0):
//   Basis https://app.metricool.com/api, Header X-Mc-Auth, Query userId + blogId.
//   API nur im Advanced-/Custom-Tarif. POST /v2/scheduler/posts (ScheduledPost:
//   publicationDate, text, providers, media, autoPublish, draft, instagramData …).
//   Tageslimits je Konto (rollierend 24 h): Instagram 50 (direkt) / 100 (über FB-Seite),
//   Facebook 30 Reels, YouTube 10 (frei) / 20, TikTok kein offizielles Limit (≥5 min Abstand).
//   Auto-Publish Reels/TikTok/Shorts/FB Reels laut Hilfe ja; LinkedIn-Video nicht bestätigt.
//
// Regeln: Ein freigegebener Beitrag geht als ENTWURF (draft:true) zu Metricool.
// Auto-Publish nur, wenn ALLE Bedingungen in autoPublishErlaubt() erfüllt sind.
// Doppelte Übergaben verhindert das Journal (pubId → Metricool-Post-ID).

import { anfrage, echterAbruf, type Abruf, type RetryOpt } from "./http.js";
import type { Plattform } from "./modell.js";
import type { Redaktionsplan, Veroeffentlichung } from "./wochenplan.js";
import { setzeStatus } from "./wochenplan.js";

export const TAGESLIMIT: Record<Plattform, number | undefined> = { instagram: 50, facebook: 30, youtube: 10, tiktok: undefined, linkedin: undefined };
export const AUTOPUBLISH_BELEGT: Record<Plattform, boolean> = { instagram: true, tiktok: true, youtube: true, facebook: true, linkedin: false };
const PROVIDER: Record<Plattform, string> = { instagram: "instagram", tiktok: "tiktok", youtube: "youtube", facebook: "facebook", linkedin: "linkedin" };

export interface MetricoolKonfig {
  token?: string;
  userId?: string;
  blogId?: string;
  /** Produktionsschalter: nur exakt "ja-auto-publish" schaltet Auto-Publish frei. */
  autoPublish?: string;
  /** Plattformen, deren Konto in Metricool verbunden UND geprüft ist (konten.json → metricool:true). */
  verbunden: Plattform[];
}

export function konfigAusUmgebung(verbunden: Plattform[]): MetricoolKonfig {
  const e = process.env;
  return {
    ...(e.METRICOOL_USER_TOKEN ? { token: e.METRICOOL_USER_TOKEN } : {}),
    ...(e.METRICOOL_USER_ID ? { userId: e.METRICOOL_USER_ID } : {}),
    ...(e.METRICOOL_BLOG_ID ? { blogId: e.METRICOOL_BLOG_ID } : {}),
    ...(e.CONTENT_AUTOPUBLISH ? { autoPublish: e.CONTENT_AUTOPUBLISH } : {}),
    verbunden,
  };
}

/** Validierung einer Variante gegen bekannte Plattformgrenzen. Leere Liste = gültig. */
export function validiere(v: Veroeffentlichung, medienUrl: string | undefined): string[] {
  const f: string[] = [];
  if (!medienUrl) f.push("kein fertiges Video (medien-URL fehlt)");
  const c = v.variante?.caption ?? "";
  if (!c.trim()) f.push("Caption leer");
  if (/\[\[/.test(c)) f.push("Caption enthält offene Platzhalter");
  if (v.variante?.befunde.length) f.push(`Markenprüfung: ${v.variante.befunde.join("; ")}`);
  const tags = (c.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  if (v.plattform === "instagram" && tags > 5) f.push("Instagram: mehr als 5 Hashtags");
  if (v.plattform === "instagram" && c.length > 2200) f.push("Instagram: Caption > 2200 Zeichen");
  if (v.plattform === "tiktok" && /\n/.test(c)) f.push("TikTok: Zeilenumbrüche werden von Metricool nicht unterstützt");
  if (v.plattform === "youtube" && (v.variante?.titel ?? "").length > 100) f.push("YouTube: Titel > 100 Zeichen");
  return f;
}

export function autoPublishErlaubt(k: MetricoolKonfig, v: Veroeffentlichung, fehler: string[]): { ja: boolean; grund: string } {
  if (k.autoPublish !== "ja-auto-publish") return { ja: false, grund: "Produktionsschalter CONTENT_AUTOPUBLISH nicht gesetzt" };
  if (!k.token || !k.userId || !k.blogId) return { ja: false, grund: "Metricool-Zugang unvollständig" };
  if (!k.verbunden.includes(v.plattform)) return { ja: false, grund: `${v.plattform} in Metricool nicht als verbunden bestätigt` };
  if (!AUTOPUBLISH_BELEGT[v.plattform]) return { ja: false, grund: `Auto-Publish für ${v.plattform} nicht belegt` };
  if (fehler.length) return { ja: false, grund: `Validierung: ${fehler.join("; ")}` };
  return { ja: true, grund: "alle Bedingungen erfüllt" };
}

export interface Journal { [pubId: string]: { postId: string; zeit: string; draft: boolean } }

export interface UebergabeErgebnis { pubId: string; aktion: "übersprungen" | "entwurf" | "geplant" | "manuell" | "fehler" | "trocken"; grund: string }

export class MetricoolClient {
  constructor(private readonly k: Required<Pick<MetricoolKonfig, "token" | "userId" | "blogId">>, private readonly abruf: Abruf = echterAbruf, private readonly retry: RetryOpt = {}) {}
  private q() { return `userId=${encodeURIComponent(this.k.userId)}&blogId=${encodeURIComponent(this.k.blogId)}`; }
  private h() { return { "X-Mc-Auth": this.k.token, "Content-Type": "application/json" }; }
  marken() { return anfrage<unknown>("Metricool", this.abruf, `https://app.metricool.com/api/admin/simpleProfiles?userId=${encodeURIComponent(this.k.userId)}`, { method: "GET", headers: this.h() }, this.retry); }
  geplante(von: string, bis: string) {
    return anfrage<{ data?: Array<{ id?: number | string; text?: string; publicationDate?: { dateTime?: string } }> }>("Metricool", this.abruf, `https://app.metricool.com/api/v2/scheduler/posts?${this.q()}&start=${von}&end=${bis}`, { method: "GET", headers: this.h() }, this.retry);
  }
  lege(body: Record<string, unknown>) {
    return anfrage<{ data?: { id?: number | string } }>("Metricool", this.abruf, `https://app.metricool.com/api/v2/scheduler/posts?${this.q()}`, { method: "POST", headers: this.h(), body }, this.retry);
  }
}

/**
 * Übergibt freigegebene Varianten. Ohne Zugang → manuell_veroeffentlichen.
 * schreiben=false → nur Prüfung (Trockenlauf), keine Statusänderung.
 */
export async function uebergebe(o: {
  plan: Redaktionsplan; konfig: MetricoolKonfig; client?: MetricoolClient; journal: Journal; medien: Record<string, string>;
  schreiben: boolean; jetzt: Date; speichereJournal: (j: Journal) => void;
}): Promise<UebergabeErgebnis[]> {
  const out: UebergabeErgebnis[] = [];
  const proTag = new Map<string, number>();
  for (const k of o.plan.kernvideos) for (const v of k.veroeffentlichungen) {
    if (v.status !== "freigegeben") continue;
    if (o.journal[v.id]) { out.push({ pubId: v.id, aktion: "übersprungen", grund: `schon übergeben (${o.journal[v.id]!.postId})` }); continue; }
    const fehler = validiere(v, o.medien[k.contentId]);
    if (!o.client || !o.konfig.verbunden.includes(v.plattform)) {
      if (o.schreiben) { setzeStatus(v, "manuell_veroeffentlichen", "content-uebergabe", o.jetzt); v.metricool = { status: "Metricool nicht verbunden — manuell", aktualisiert: o.jetzt.toISOString() }; }
      out.push({ pubId: v.id, aktion: o.schreiben ? "manuell" : "trocken", grund: "Metricool für diese Plattform nicht verbunden" });
      continue;
    }
    const tagKey = `${v.plattform}:${(v.geplant ?? "").slice(0, 10)}`;
    const limit = TAGESLIMIT[v.plattform];
    if (limit !== undefined && (proTag.get(tagKey) ?? 0) >= limit) { out.push({ pubId: v.id, aktion: "fehler", grund: "Tageslimit erreicht" }); continue; }
    const auto = autoPublishErlaubt(o.konfig, v, fehler);
    if (!o.schreiben) { out.push({ pubId: v.id, aktion: "trocken", grund: auto.ja ? "würde geplant (Auto-Publish)" : `würde als Entwurf übergeben (${auto.grund})` }); continue; }
    if (fehler.length && auto.ja === false && fehler.some((f) => f.startsWith("kein fertiges Video"))) { out.push({ pubId: v.id, aktion: "übersprungen", grund: fehler.join("; ") }); continue; }
    try {
      // Doppelte Übergabe trotz verlorenem Journal: gleicher Text am gleichen Tag → übernehmen statt neu anlegen.
      const tag = (v.geplant ?? o.jetzt.toISOString()).slice(0, 10);
      const vorhanden = (await o.client.geplante(`${tag}T00:00:00`, `${tag}T23:59:59`)).data?.find((p) => p.text === v.variante?.caption);
      let postId = vorhanden?.id !== undefined ? String(vorhanden.id) : undefined;
      if (!postId) {
        const r = await o.client.lege({
          publicationDate: { dateTime: v.geplant, timezone: "Europe/Berlin" }, text: v.variante?.caption ?? "",
          providers: [{ network: PROVIDER[v.plattform] }], media: [o.medien[k.contentId]], autoPublish: auto.ja, draft: !auto.ja,
          ...(v.plattform === "youtube" && v.variante?.titel ? { youtubeData: { title: v.variante.titel, type: "short", privacy: "public", madeForKids: false } } : {}),
          ...(v.plattform === "instagram" ? { instagramData: { type: "REEL", showReelOnFeed: true, autoPublish: auto.ja } } : {}),
        });
        postId = String(r.data?.id ?? "unbekannt");
      }
      o.journal[v.id] = { postId, zeit: o.jetzt.toISOString(), draft: !auto.ja };
      o.speichereJournal(o.journal);
      if (auto.ja) setzeStatus(v, "geplant", "content-uebergabe", o.jetzt);
      v.metricool = { status: auto.ja ? "geplant (Auto-Publish)" : "Entwurf in Metricool, Freigabe dort", postId, aktualisiert: o.jetzt.toISOString() };
      proTag.set(tagKey, (proTag.get(tagKey) ?? 0) + 1);
      out.push({ pubId: v.id, aktion: auto.ja ? "geplant" : "entwurf", grund: auto.grund });
    } catch (e) {
      v.metricool = { status: "Fehler", fehler: (e as Error).message, aktualisiert: o.jetzt.toISOString() };
      out.push({ pubId: v.id, aktion: "fehler", grund: (e as Error).message });
    }
  }
  return out;
}
