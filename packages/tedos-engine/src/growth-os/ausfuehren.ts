// Ausfuehrer des Growth OS: setzt NUR freigegebene Vorschlaege um.
//
//   Instagram: Beitraege eines freigegebenen Wochenplans am geplanten Tag
//              veroeffentlichen (Feed und Story), je Beitrag hoechstens einmal.
//   Meta Ads:  freigegebene "growth:meta:start:<kampagne>" aktivieren,
//              "growth:meta:pause:<anzeige>" pausieren. Keine Budgets.
//
// Rein planend (welche Schritte sind faellig) plus duenner Graph-Client mit
// austauschbarem Abrufer. Verpasste Tage werden nicht nachgeholt, sondern
// gemeldet: ein Post von Montag am Mittwoch waere ein anderer Plan.

import type { ApprovalEntry } from "../approval-queue.js";
import type { PlanEintrag, Wochenplan } from "./content-plan.js";
import { META_API_VERSION, type Abrufer } from "./meta-insights.js";

export const HEYAUDIT_SEITE = "1124465204079003";

export interface Veroeffentlicht {
  [schluessel: string]: { mediaId: string; zeit: string };
}

export const postSchluessel = (e: Pick<PlanEintrag, "datum" | "motiv">) => `${e.datum}:${e.motiv.id}`;

/** Berliner Kalendertag (YYYY-MM-DD). */
export function berlinTag(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);
}

export interface Faellig {
  heute: PlanEintrag[];
  verpasst: PlanEintrag[];
}

/** Welche Beitraege freigegebener Plaene sind heute dran, welche wurden verpasst? */
export function faelligeBeitraege(
  plaene: Wochenplan[],
  freigaben: ApprovalEntry[],
  erledigt: Veroeffentlicht,
  jetzt: Date,
): Faellig {
  const frei = new Set(freigaben.filter((f) => f.status === "approved").map((f) => f.goalId));
  const heute = berlinTag(jetzt);
  const out: Faellig = { heute: [], verpasst: [] };
  for (const p of plaene) {
    const id = `growth:content:ig-${p.jahr}-kw${String(p.kw).padStart(2, "0")}`;
    if (!frei.has(id)) continue;
    for (const e of p.eintraege) {
      if (erledigt[postSchluessel(e)]) continue;
      if (e.datum === heute) out.heute.push(e);
      else if (e.datum < heute) out.verpasst.push(e);
    }
  }
  return out;
}

export type MetaAktion = { goalId: string; art: "start" | "pause"; objektId: string };

/** Freigegebene, noch nicht umgesetzte Meta-Vorschlaege. */
export function faelligeMetaAktionen(freigaben: ApprovalEntry[]): MetaAktion[] {
  const out: MetaAktion[] = [];
  for (const f of freigaben) {
    if (f.status !== "approved") continue;
    const m = /^growth:meta:(start|pause):(\d+)$/.exec(f.goalId);
    if (m) out.push({ goalId: f.goalId, art: m[1] as "start" | "pause", objektId: m[2]! });
  }
  return out;
}

const basis = `https://graph.facebook.com/${META_API_VERSION}`;

async function graph(abruf: Abrufer, methode: "GET" | "POST", pfad: string, token: string, felder: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const p = new URLSearchParams({ ...felder, access_token: token });
  const url = methode === "GET" ? `${basis}${pfad}?${p}` : `${basis}${pfad}`;
  const r =
    methode === "POST"
      ? await abruf(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: p.toString() })
      : await abruf(url);
  const j = (await r.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(`Meta ${methode} ${pfad}: ${j.error?.message ?? `HTTP ${r.status}`}`);
  return j;
}

/** Instagram-Konto hinter der HeyAudit-Seite. */
export async function instagramKonto(token: string, abruf: Abrufer = fetch as unknown as Abrufer): Promise<string> {
  const j = await graph(abruf, "GET", `/${HEYAUDIT_SEITE}`, token, { fields: "instagram_business_account" });
  const id = (j.instagram_business_account as { id?: string } | undefined)?.id;
  if (!id) throw new Error("Kein Instagram-Konto mit der HeyAudit-Seite verbunden oder kein Zugriff darauf.");
  return id;
}

/** Ein Beitrag: Container anlegen, dann veroeffentlichen. Gibt die Media-ID zurueck. */
export async function veroeffentliche(e: PlanEintrag, igId: string, bildBasis: string, token: string, abruf: Abrufer = fetch as unknown as Abrufer): Promise<string> {
  const bild = `${bildBasis.replace(/\/$/, "")}/${e.motiv.id}.png`;
  const felder: Record<string, string> = e.art === "story" ? { image_url: bild, media_type: "STORIES" } : { image_url: bild, caption: e.beitragstext };
  const container = await graph(abruf, "POST", `/${igId}/media`, token, felder);
  const fertig = await graph(abruf, "POST", `/${igId}/media_publish`, token, { creation_id: String(container.id) });
  return String(fertig.id);
}

/** Kampagne aktivieren bzw. Anzeige pausieren. */
export async function fuehreMetaAus(a: MetaAktion, token: string, abruf: Abrufer = fetch as unknown as Abrufer): Promise<void> {
  await graph(abruf, "POST", `/${a.objektId}`, token, { status: a.art === "start" ? "ACTIVE" : "PAUSED" });
}
