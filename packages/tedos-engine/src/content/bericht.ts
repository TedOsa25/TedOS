// Wochenbericht Content → Sales. Liest NUR: Redaktionspläne (Content) und die
// vorhandene Lead-Wahrheit des Sales-Systems (AccountState aus events.json).
// Schreibt nichts ins Sales-System.
//
// Attribution je Lead-Account:
//   beobachtet      = ein Ereignis trägt utm_campaign einer Content-Veröffentlichung
//   selbst angegeben = "Herkunft"/Quelle nennt eine Social-Plattform, aber keine Content-ID
// Erstkontakt = frühestes Content-Ereignis, letzter Contentkontakt = spätestes vor
// Abschluss. Umsatz wird je Account GENAU EINMAL gezählt und nur dem letzten
// beobachteten Contentkontakt zugeordnet (keine Mehrfachzurechnung).
// Kausalität wird nicht behauptet.

import type { AccountState } from "../sales/rules.js";
import type { Plattform, Woche } from "./modell.js";
import { isoWoche, kampagnenId, parseUtmCampaign, PLATTFORMEN } from "./modell.js";
import type { Redaktionsplan } from "./wochenplan.js";
import { zaehle } from "./wochenplan.js";

export interface LeadAttribution {
  account: string;
  art: "beobachtet" | "selbst angegeben";
  erstkontakt?: string;
  letzterKontakt?: string;
  plattform?: string;
  leadAm: string;
  qualifiziert: boolean;
  demoGebucht: boolean;
  demoGehalten: boolean;
  gewonnen: boolean;
  umsatzEur?: number;
}

const SOCIAL = new Set<string>([...PLATTFORMEN, "ig", "tt", "yt", "fb", "li"]);

export function attribuiere(states: AccountState[]): LeadAttribution[] {
  const out: LeadAttribution[] = [];
  for (const st of states) {
    if (!st.lead || st.q.internal || !st.firstInterest) continue;
    const ende = st.won?.at ?? "9999";
    const content = st.account.events
      .map((e) => ({ e, c: parseUtmCampaign(e.campaign) }))
      .filter((x) => x.c && x.e.at <= ende)
      .sort((a, b) => (a.e.at < b.e.at ? -1 : 1));
    const basis = {
      account: st.account.id, leadAm: st.firstInterest.at, qualifiziert: st.q.fit === "yes",
      demoGebucht: st.account.events.some((e) => e.kind === "booking"), demoGehalten: !!st.demoHeld && st.demoHeld.fit !== "no",
      gewonnen: !!st.won, ...(st.won?.valueEur !== undefined ? { umsatzEur: st.won.valueEur } : {}),
    };
    if (content.length) {
      out.push({ ...basis, art: "beobachtet", erstkontakt: content[0]!.c!.contentId, letzterKontakt: content.at(-1)!.c!.contentId, plattform: content.at(-1)!.c!.plattform });
      continue;
    }
    const angabe = [st.source, ...st.account.events.map((e) => e.statedOrigin)].map((x) => (x ?? "").toLowerCase()).find((x) => SOCIAL.has(x));
    if (angabe) out.push({ ...basis, art: "selbst angegeben", plattform: angabe });
  }
  return out;
}

const inWoche = (iso: string | undefined, w: Woche) => !!iso && (() => { const x = isoWoche(new Date(iso)); return x.jahr === w.jahr && x.kw === w.kw; })();
const quote = (z: number, n: number) => (n > 0 ? `${Math.round((z / n) * 100)} % (${z}/${n})` : "— (Nenner 0)");

export function wochenbericht(o: { woche: Woche; plaene: Redaktionsplan[]; states: AccountState[]; jetzt: Date; salesStand?: string }): string {
  const plan = o.plaene.find((p) => p.kampagnenId === kampagnenId(o.woche));
  const pubs = o.plaene.flatMap((p) => p.kernvideos.flatMap((k) => k.veroeffentlichungen.map((v) => ({ k, v }))));
  const diese = pubs.filter(({ v }) => v.status === "veroeffentlicht" && inWoche(v.veroeffentlichtAm, o.woche));
  const kern = new Set(diese.map(({ k }) => k.contentId));
  const luecken: string[] = [];
  const jePlattform = new Map<Plattform, { n: number; views: number; inter: number; klicks: number; ohneZahlen: number }>();
  for (const { v } of diese) {
    const r = jePlattform.get(v.plattform) ?? { n: 0, views: 0, inter: 0, klicks: 0, ohneZahlen: 0 };
    r.n++;
    if (v.kennzahlen) { r.views += v.kennzahlen.views ?? 0; r.inter += (v.kennzahlen.likes ?? 0) + (v.kennzahlen.kommentare ?? 0) + (v.kennzahlen.shares ?? 0); r.klicks += (v.kennzahlen.linkklicks ?? 0) + (v.kennzahlen.profilklicks ?? 0); } else r.ohneZahlen++;
    jePlattform.set(v.plattform, r);
  }
  const attr = attribuiere(o.states);
  const wl = attr.filter((a) => inWoche(a.leadAm, o.woche));
  const beob = wl.filter((a) => a.art === "beobachtet");
  const gewonnen = attr.filter((a) => a.gewonnen && a.art === "beobachtet");
  const umsatz = gewonnen.reduce((s, a) => s + (a.umsatzEur ?? 0), 0);
  const ohneUmsatz = gewonnen.filter((a) => a.umsatzEur === undefined).length;
  if (!plan) luecken.push(`kein Redaktionsplan für ${kampagnenId(o.woche)}`);
  if ([...jePlattform.values()].some((r) => r.ohneZahlen)) luecken.push("Kennzahlen fehlen für einen Teil der Veröffentlichungen (content -- kennzahlen …)");
  luecken.push("Profil-/Linkklicks nur, wenn manuell oder über Metricool erfasst", "utm_content wird von der App nicht gespeichert — Zuordnung läuft über utm_campaign", "Opportunities sind im Sales-System keine eigene Stufe; Näherung = gehaltene qualifizierte Demo");
  if (ohneUmsatz) luecken.push(`${ohneUmsatz} gewonnene Accounts ohne erfassten Wert (sales -- ergebnis --wert)`);
  const z = plan ? zaehle(plan) : undefined;
  const l = [
    `# Content → Sales — ${kampagnenId(o.woche)}`,
    `_Erstellt ${o.jetzt.toISOString()} · Quellen: Redaktionspläne (heyaudit-content), Sales-Ereignisse (heyaudit-sales/events.json${o.salesStand ? `, Stand ${o.salesStand}` : ""}) · keine Kausalaussage_`,
    "",
    "## Veröffentlicht in dieser Woche",
    `- Geplant: ${z ? `${z.kernvideos} Kernvideos, ${z.veroeffentlichungen} Plattformversionen` : "kein Plan"}`,
    `- Veröffentlicht: ${kern.size} Kernvideos, ${diese.length} Plattformversionen`,
    "",
    "| Plattform | Versionen | Views | Interaktionen | Profil-/Linkklicks | ohne Kennzahlen |", "|---|---:|---:|---:|---:|---:|",
    ...[...jePlattform.entries()].map(([p, r]) => `| ${p} | ${r.n} | ${r.views} | ${r.inter} | ${r.klicks} | ${r.ohneZahlen} |`),
    "_Zahlen je Plattform getrennt; nicht plattformübergreifend vergleichbar._",
    "",
    "## Sales (vorhandene Lead-Wahrheit, nur gelesen)",
    `- Leads mit beobachtetem Contentkontakt (Lead-Datum in dieser KW): **${beob.length}**`,
    `- Leads mit selbst angegebener Social-Herkunft ohne Content-ID: ${wl.filter((a) => a.art === "selbst angegeben").length}`,
    `- davon qualifiziert: ${beob.filter((a) => a.qualifiziert).length} · Demo gebucht: ${beob.filter((a) => a.demoGebucht).length} · Demo gehalten (Opportunity-Näherung): ${beob.filter((a) => a.demoGehalten).length} · gewonnen: ${beob.filter((a) => a.gewonnen).length}`,
    `- Quote Lead → qualifiziert (gleiche Kohorte): ${quote(beob.filter((a) => a.qualifiziert).length, beob.length)}`,
    `- Gewonnene Kunden gesamt mit beobachtetem Contentkontakt: ${gewonnen.length}, Umsatz ${umsatz.toLocaleString("de-DE")} € (je Account einmal, letzter Contentkontakt)`,
    "",
    "| Account | Art | Erstkontakt | letzter Contentkontakt | qualifiziert | Demo | gewonnen |", "|---|---|---|---|---|---|---|",
    ...attr.map((a) => `| ${a.account} | ${a.art} | ${a.erstkontakt ?? "—"} | ${a.letzterKontakt ?? a.plattform ?? "—"} | ${a.qualifiziert ? "ja" : "nein"} | ${a.demoGehalten ? "gehalten" : a.demoGebucht ? "gebucht" : "—"} | ${a.gewonnen ? "ja" : "—"} |`),
    attr.length ? "" : "_Noch kein Lead mit Content-Bezug._",
    attr.length < 20 ? `⚠ Kleine Stichprobe (${attr.length}) — Quoten nicht belastbar.` : "",
    "",
    "## Datenlücken",
    ...luecken.map((x) => `- ${x}`),
  ];
  return l.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n") + "\n";
}
