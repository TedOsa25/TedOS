// Meta-Ads-Agent: liest Kampagnen, Anzeigengruppen und Anzeigen-Zahlen und
// macht daraus Befunde und Vorschlaege zur Freigabe. NUR LESEN.
//
// Regeln stuetzen sich ausschliesslich auf die eigenen Zahlen des Kontos,
// nie auf Branchenwerte. Starten, Pausieren und Budgets sind Vorschlaege;
// ausgefuehrt wird nichts (dafuer braeuchte es ein Schreibrecht und deine Freigabe).

import type { ApprovalInput } from "../approval-queue.js";
import { META_API_VERSION, META_KONTO, type Abrufer } from "./meta-insights.js";

export interface Kampagne {
  id: string;
  name: string;
  objective: string;
  status: string;
  effective_status: string;
  daily_budget?: string; // Cent
}
export interface Anzeigengruppe {
  id: string;
  name: string;
  campaign_id: string;
  optimization_goal: string;
  promoted_object?: { custom_event_type?: string };
  daily_budget?: string;
  status: string;
}
export interface AnzeigeZahlen {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  spend: string;
  impressions: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
}
export interface MetaKonto {
  stand: string;
  zeitraumTage: number;
  kampagnen: Kampagne[];
  gruppen: Anzeigengruppe[];
  anzeigen: AnzeigeZahlen[];
}

/** Andere Marken im selben Konto werden nicht bewertet. */
export const FREMDE_MARKE = /heycarbo/i;
/** Ab diesem Vielfachen der eigenen Kosten je Registrierung ohne Registrierung: Pause vorschlagen. */
export const PAUSE_FAKTOR = 3;

const REG = ["offsite_conversion.fb_pixel_complete_registration", "complete_registration"];
const zahl = (s: string | undefined) => (s ? Number(s) : 0);
const registrierungen = (a: AnzeigeZahlen) =>
  (a.actions ?? []).filter((x) => REG.includes(x.action_type)).reduce((m, x) => Math.max(m, Number(x.value)), 0);
const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Optimiert die Gruppe auf "Registrierung abgeschlossen"? */
export function aufRegistrierung(g: Anzeigengruppe): boolean {
  return g.optimization_goal === "OFFSITE_CONVERSIONS" && g.promoted_object?.custom_event_type === "COMPLETE_REGISTRATION";
}

export interface MetaAnalyse {
  befunde: string[];
  vorschlaege: ApprovalInput[];
  kostenJeRegistrierung: number | null;
}

export function analysiere(k: MetaKonto): MetaAnalyse {
  const befunde: string[] = [];
  const vorschlaege: ApprovalInput[] = [];
  const kampagnen = k.kampagnen.filter((c) => !FREMDE_MARKE.test(c.name));
  const ids = new Set(kampagnen.map((c) => c.id));
  const gruppen = k.gruppen.filter((g) => ids.has(g.campaign_id));
  const anzeigen = k.anzeigen.filter((a) => ids.has(a.campaign_id));

  const ausgaben = anzeigen.reduce((s, a) => s + zahl(a.spend), 0);
  const regs = anzeigen.reduce((s, a) => s + registrierungen(a), 0);
  const kostenJeRegistrierung = regs > 0 ? Math.round((ausgaben / regs) * 100) / 100 : null;

  // 1) Geld in Kampagnen, die nicht auf Registrierung optimieren.
  for (const c of kampagnen) {
    const cg = gruppen.filter((g) => g.campaign_id === c.id);
    const ca = anzeigen.filter((a) => a.campaign_id === c.id);
    const spend = ca.reduce((s, a) => s + zahl(a.spend), 0);
    if (spend <= 0 || cg.some(aufRegistrierung)) continue;
    const klicks = ca.reduce((s, a) => s + zahl(a.inline_link_clicks), 0);
    const r = ca.reduce((s, a) => s + registrierungen(a), 0);
    befunde.push(
      `„${c.name}“: ${euro(spend)} in ${k.zeitraumTage} Tagen, ${klicks} Link-Klicks, ${r} Registrierungen. Optimiert auf ${cg.map((g) => g.optimization_goal).join(", ") || c.objective}, nicht auf Registrierung.`,
    );
  }

  // 2) Bereitliegende Registrierungs-Kampagne, pausiert.
  for (const c of kampagnen) {
    const cg = gruppen.filter((g) => g.campaign_id === c.id && aufRegistrierung(g));
    if (!cg.length || c.effective_status !== "PAUSED") continue;
    const budget = zahl(c.daily_budget) || cg.reduce((s, g) => s + zahl(g.daily_budget), 0);
    vorschlaege.push({
      goalId: `growth:meta:start:${c.id}`,
      title: `Meta: Registrierungs-Kampagne „${c.name}“ starten`,
      description: `Optimiert auf „Registrierung abgeschlossen“ (Pixel), derzeit pausiert. Hinterlegtes Tagesbudget: ${budget ? euro(budget / 100) : "keins"}. Budget und Start entscheidest du; vor dem Start Anzeigen und Zielgruppe im Werbeanzeigenmanager prüfen.`,
      businessImpact: 8,
      revenueImpact: 7,
      customerValue: 5,
      risk: "HIGH",
      priorityScore: 80,
      files: [],
      estimatedEffort: "Prüfen und starten, ca. 15 Minuten",
    });
  }

  // 3) Aktive Anzeigen, die viel kosten und nichts bringen. Massstab: was eine
  // Registrierung bei den Anzeigen kostet, die Registrierungen bringen (sonst
  // hebt eine teure Fehl-Anzeige den Durchschnitt und schuetzt sich selbst).
  const erfolgreich = anzeigen.filter((a) => registrierungen(a) > 0);
  const referenz = erfolgreich.length
    ? erfolgreich.reduce((s, a) => s + zahl(a.spend), 0) / erfolgreich.reduce((s, a) => s + registrierungen(a), 0)
    : null;
  if (referenz !== null) {
    for (const a of anzeigen) {
      const c = kampagnen.find((x) => x.id === a.campaign_id);
      if (!c || c.effective_status !== "ACTIVE") continue;
      if (registrierungen(a) === 0 && zahl(a.spend) >= PAUSE_FAKTOR * referenz) {
        vorschlaege.push({
          goalId: `growth:meta:pause:${a.ad_id}`,
          title: `Meta: Anzeige „${a.ad_name}“ pausieren`,
          description: `${euro(zahl(a.spend))} ohne Registrierung, das ist mehr als das ${PAUSE_FAKTOR}-fache dessen, was eine Registrierung bei deinen erfolgreichen Anzeigen kostet (${euro(referenz)}).`,
          businessImpact: 5,
          revenueImpact: 5,
          customerValue: 3,
          risk: "MEDIUM",
          priorityScore: 60,
          files: [],
          estimatedEffort: "1 Klick",
        });
      }
    }
  }

  // 4) Welches Motiv zieht am besten (Link-Klickrate), nur Anzeigen mit Auslieferung.
  const mitKlicks = anzeigen.filter((a) => zahl(a.impressions) >= 100);
  if (mitKlicks.length >= 2) {
    const quote = (a: AnzeigeZahlen) => zahl(a.inline_link_clicks) / zahl(a.impressions);
    const best = [...mitKlicks].sort((x, y) => quote(y) - quote(x))[0]!;
    befunde.push(`Beste Link-Klickrate: „${best.ad_name}“ mit ${(quote(best) * 100).toFixed(1).replace(".", ",")} % (${best.inline_link_clicks ?? 0} von ${best.impressions} Impressionen).`);
  }

  if (ausgaben > 0 && regs === 0) befunde.push(`${euro(ausgaben)} in ${k.zeitraumTage} Tagen, keine Registrierung einer Anzeige zugeordnet.`);
  return { befunde, vorschlaege, kostenJeRegistrierung };
}

/** Holt Kampagnen, Gruppen und Anzeigen-Zahlen (nur GET). */
export async function holeMetaKonto(token: string, tage: number, jetzt: Date, abruf: Abrufer = fetch as unknown as Abrufer): Promise<MetaKonto> {
  const basis = `https://graph.facebook.com/${META_API_VERSION}/act_${META_KONTO}`;
  const t = `access_token=${encodeURIComponent(token)}`;
  const tag = (d: Date) => d.toISOString().slice(0, 10);
  const zeitraum = encodeURIComponent(JSON.stringify({ since: tag(new Date(jetzt.getTime() - tage * 86_400_000)), until: tag(jetzt) }));
  const hole = async <T>(pfad: string): Promise<T[]> => {
    const r = await abruf(`${basis}${pfad}&limit=200&${t}`);
    if (!r.ok) throw new Error(`Meta ${pfad.split("?")[0]} HTTP ${r.status}`);
    return ((await r.json()) as { data?: T[] }).data ?? [];
  };
  return {
    stand: jetzt.toISOString(),
    zeitraumTage: tage,
    kampagnen: await hole<Kampagne>("/campaigns?fields=id,name,objective,status,effective_status,daily_budget"),
    gruppen: await hole<Anzeigengruppe>("/adsets?fields=id,name,campaign_id,optimization_goal,promoted_object,daily_budget,status"),
    anzeigen: await hole<AnzeigeZahlen>(
      `/insights?level=ad&fields=ad_id,ad_name,campaign_id,spend,impressions,inline_link_clicks,actions&time_range=${zeitraum}`,
    ),
  };
}
