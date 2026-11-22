// Redaktionsplan: 7 Kernvideos je Woche × bis zu 5 Plattformvarianten.
// Eine Variante ohne verbundenes Konto oder ohne Formatfit ist
// "nicht_vorgesehen" und zählt NICHT als Veröffentlichung.

import type { ApprovalInput } from "../approval-queue.js";
import type { Idee, PlattformVariante } from "./ideen.js";
import type { Funnel, Plattform, PubStatus, Woche } from "./modell.js";
import { contentId, kampagnenId, montag, PLATTFORMEN, utmCampaign, utmLink, veroeffentlichungsId, wechsle } from "./modell.js";

/** Welche HeyAudit-Konten existieren und benutzt werden dürfen. Nur bestätigte Konten zählen. */
export interface KontoStand { verbunden: boolean; handle?: string; belegt?: string; metricool?: boolean }
export type Konten = Partial<Record<Plattform, KontoStand>>;

/** Standard: nur Instagram ist als HeyAudit-Konto belegt (@heyauditapp, IG-Runde). Rest bestätigt der Gründer in konten.json. */
export const STANDARD_KONTEN: Konten = {
  instagram: { verbunden: true, handle: "heyauditapp", belegt: "IG-Runde / growth-os seit 11.11.2026", metricool: false },
};

export const STANDARD_MIX: Record<Funnel, number> = { TOFU: 3, MOFU: 2, BOFU: 2 };
/** Reihenfolge der Funnel-Stufen Mo–So beim Standardmix. */
const TAGESFOLGE: Funnel[] = ["TOFU", "MOFU", "TOFU", "BOFU", "TOFU", "MOFU", "BOFU"];
export const UHRZEIT_ANNAHME = "07:30"; // Annahme wie im bestehenden IG-Tagesplan; anhand echter Daten anpassen.

export interface Veroeffentlichung {
  id: string;
  contentId: string;
  plattform: Plattform;
  status: PubStatus;
  grund?: string;
  variante?: PlattformVariante;
  utmCampaign?: string;
  link?: string;
  geplant?: string;
  veroeffentlichtAm?: string;
  url?: string;
  metricool?: { status: string; postId?: string; aktualisiert?: string; fehler?: string };
  kennzahlen?: { stand: string; views?: number; likes?: number; kommentare?: number; shares?: number; profilklicks?: number; linkklicks?: number; quelle: string };
  verlauf: Array<{ zeit: string; von: PubStatus; nach: PubStatus; wer: string }>;
}

export interface Kernvideo { contentId: string; slot: number; datum: string; ideeId: string; funnel: Funnel; hook: string; veroeffentlichungen: Veroeffentlichung[] }

export interface Redaktionsplan {
  schema: 1;
  kampagnenId: string;
  woche: Woche;
  erstellt: string;
  mix: Record<Funnel, number>;
  kernvideos: Kernvideo[];
  hinweise: string[];
}

/** Formatfit: Muss eine Plattform eine Idee bekommen? Sonst Grund. */
export function formatFit(i: Idee, p: Plattform): string | undefined {
  if (p === "linkedin" && i.funnel === "TOFU" && (i.format === "pov_alltag" || i.format === "problembeobachtung")) return "Formatfit: Alltags-POV ohne Fachaussage bringt auf LinkedIn keinen Mehrwert";
  if (p === "tiktok" && i.format === "ehrliche_grenze") return "Formatfit: Abgrenzungsvideo ohne Unterhaltungswert auf TikTok nicht vorgesehen";
  return undefined;
}

export function waehleIdeen(ideen: Idee[], mix: Record<Funnel, number>, zuletzt: Record<string, string>): Idee[] {
  const frei = ideen.filter((i) => i.status !== "gesperrt");
  const out: Idee[] = [];
  for (const f of ["TOFU", "MOFU", "BOFU"] as Funnel[]) {
    const kandidaten = frei.filter((i) => i.funnel === f)
      .map((i, n) => ({ i, n, d: zuletzt[i.id] ?? "" }))
      .sort((a, b) => (a.d === b.d ? a.n - b.n : a.d < b.d ? -1 : 1));
    const themen = new Set<string>();
    for (const { i } of kandidaten) { // pro Funnel-Stufe kein Thema doppelt, wenn möglich
      if (out.filter((x) => x.funnel === f).length >= mix[f]) break;
      if (themen.has(i.thema)) continue;
      out.push(i); themen.add(i.thema);
    }
    for (const { i } of kandidaten) if (out.filter((x) => x.funnel === f).length < mix[f] && !out.includes(i)) out.push(i);
    if (out.filter((x) => x.funnel === f).length < mix[f]) throw new Error(`Zu wenige freie ${f}-Ideen für den Mix (${mix[f]} verlangt)`);
  }
  return out;
}

function tagesfolge(mix: Record<Funnel, number>): Funnel[] {
  const sum = mix.TOFU + mix.MOFU + mix.BOFU;
  if (sum === 7 && mix.TOFU === 3 && mix.MOFU === 2 && mix.BOFU === 2) return TAGESFOLGE;
  return [...Array(mix.TOFU).fill("TOFU"), ...Array(mix.MOFU).fill("MOFU"), ...Array(mix.BOFU).fill("BOFU")];
}

export function baueRedaktionsplan(o: { woche: Woche; ideen: Idee[]; konten?: Konten; mix?: Record<Funnel, number>; zuletzt?: Record<string, string>; jetzt: Date }): Redaktionsplan {
  const mix = o.mix ?? STANDARD_MIX;
  const konten = o.konten ?? STANDARD_KONTEN;
  if (mix.TOFU + mix.MOFU + mix.BOFU > 7) throw new Error("Höchstens 7 Kernvideos je Woche");
  const gewaehlt = waehleIdeen(o.ideen, mix, o.zuletzt ?? {});
  const folge = tagesfolge(mix);
  const mo = Date.parse(montag(o.woche) + "T12:00:00Z");
  const kernvideos: Kernvideo[] = folge.map((f, idx) => {
    const idee = gewaehlt.filter((i) => i.funnel === f)[folge.slice(0, idx).filter((x) => x === f).length]!;
    const slot = idx + 1;
    const cid = contentId(o.woche, slot);
    const datum = new Date(mo + idx * 86_400_000).toISOString().slice(0, 10);
    const veroeffentlichungen: Veroeffentlichung[] = PLATTFORMEN.map((p) => {
      const id = veroeffentlichungsId(cid, p);
      const k = konten[p];
      const nichtGrund = !k?.verbunden ? "kein bestätigtes HeyAudit-Konto (konten.json)" : formatFit(idee, p);
      if (nichtGrund) return { id, contentId: cid, plattform: p, status: "nicht_vorgesehen", grund: nichtGrund, verlauf: [] };
      const variante = idee.varianten.find((v) => v.plattform === p)!;
      const link = utmLink(idee.cta.ziel, o.woche, slot, p, idee.id);
      return {
        id, contentId: cid, plattform: p, status: "entwurf", variante, utmCampaign: utmCampaign(o.woche, slot, p), link,
        geplant: `${datum}T${UHRZEIT_ANNAHME}`,
        metricool: { status: k?.metricool ? "nicht übertragen" : "Metricool nicht verbunden" }, verlauf: [],
      };
    });
    return { contentId: cid, slot, datum, ideeId: idee.id, funnel: f, hook: idee.hook, veroeffentlichungen };
  });
  const hinweise = [
    "Uhrzeit ist eine Annahme; nach 4 Wochen anhand echter Reichweite anpassen.",
    "Mix 3/2/2 ist der Standard; Änderung nur mit beobachteter Performance (mix in konten.json → wochenmix).",
  ];
  return { schema: 1, kampagnenId: kampagnenId(o.woche), woche: o.woche, erstellt: o.jetzt.toISOString(), mix, kernvideos, hinweise };
}

export const zaehle = (p: Redaktionsplan) => {
  const alle = p.kernvideos.flatMap((k) => k.veroeffentlichungen);
  return { kernvideos: p.kernvideos.length, veroeffentlichungen: alle.filter((v) => v.status !== "nicht_vorgesehen").length, nichtVorgesehen: alle.filter((v) => v.status === "nicht_vorgesehen").length };
};

export function findePub(p: Redaktionsplan, pubId: string): Veroeffentlichung | undefined {
  return p.kernvideos.flatMap((k) => k.veroeffentlichungen).find((v) => v.id === pubId);
}

/** Statuswechsel mit Protokoll. Idempotent; unerlaubte Wechsel werfen. */
export function setzeStatus(v: Veroeffentlichung, nach: PubStatus, wer: string, jetzt: Date): boolean {
  if (v.status === nach) return false;
  const von = v.status;
  v.status = wechsle(von, nach);
  v.verlauf.push({ zeit: jetzt.toISOString(), von, nach, wer });
  return true;
}

export const wochenFreigabeId = (p: Redaktionsplan) => `content:woche:${p.kampagnenId}`;

/** Ein Freigabeeintrag je Woche in der bestehenden Sales-Freigabe (sales -- freigeben <id>). */
export function wochenFreigabe(p: Redaktionsplan, datei: string): ApprovalInput {
  const z = zaehle(p);
  return {
    goalId: wochenFreigabeId(p),
    title: `Content-Woche ${p.kampagnenId}: ${z.kernvideos} Kernvideos, ${z.veroeffentlichungen} Plattformversionen — Entwurf`,
    description: [
      `Plan: ${datei}`,
      ...p.kernvideos.map((k) => `- ${k.datum} ${k.contentId} [${k.funnel}] ${k.hook} → ${k.veroeffentlichungen.filter((v) => v.status !== "nicht_vorgesehen").map((v) => v.plattform).join(", ") || "keine Plattform"}`),
      "",
      "Freigabe heißt: Texte/Skripte dürfen produziert und auf den genannten Plattformen veröffentlicht werden.",
      "Ohne Metricool-Anbindung: manuelle Veröffentlichung in der IG-Runde, danach `content -- veroeffentlicht <pubId> --url …`.",
    ].join("\n"),
    businessImpact: 6, revenueImpact: 5, customerValue: 5, risk: "HIGH", priorityScore: 6, files: [datei], estimatedEffort: "Prüfung 20 min", recommendation: "approve",
  };
}

export function renderPlan(p: Redaktionsplan, ideen: Map<string, Idee>): string {
  const z = zaehle(p);
  const l = [
    `# Redaktionsplan ${p.kampagnenId}`,
    "",
    `${z.kernvideos} Kernvideos · ${z.veroeffentlichungen} plattformspezifische Veröffentlichungen · ${z.nichtVorgesehen} Varianten nicht vorgesehen (zählen nicht).`,
    `Mix: TOFU ${p.mix.TOFU} / MOFU ${p.mix.MOFU} / BOFU ${p.mix.BOFU}.`,
    ...p.hinweise.map((h) => `- ${h}`),
    "",
    "| Tag | Content-ID | Funnel | Hook | Plattformen (Status) |", "|---|---|---|---|---|",
    ...p.kernvideos.map((k) => `| ${k.datum} | ${k.contentId} | ${k.funnel} | ${k.hook.replace(/\|/g, "/")} | ${k.veroeffentlichungen.map((v) => `${v.plattform}: ${v.status}`).join("<br>")} |`),
    "",
  ];
  for (const k of p.kernvideos) {
    const i = ideen.get(k.ideeId);
    l.push(`## ${k.contentId} — ${k.datum} — ${i?.id ?? k.ideeId}`, "");
    for (const v of k.veroeffentlichungen) {
      if (v.status === "nicht_vorgesehen") { l.push(`- **${v.plattform}:** nicht vorgesehen — ${v.grund}`); continue; }
      l.push(`- **${v.plattform}** (${v.id}, ${v.status}, geplant ${v.geplant}) · utm_campaign=${v.utmCampaign}`, `  - Link: ${v.link}`, `  - Caption: ${(v.variante?.caption ?? "").replace(/\n+/g, " ⏎ ")}`);
      if (v.variante?.titel) l.push(`  - Titel: ${v.variante.titel}`);
      if (v.variante?.befunde.length) l.push(`  - ⚠ Markenprüfung: ${v.variante.befunde.join("; ")}`);
      l.push(`  - Manuell: ${v.variante?.manuell.join("; ")}`);
    }
    l.push("");
  }
  return l.join("\n");
}
