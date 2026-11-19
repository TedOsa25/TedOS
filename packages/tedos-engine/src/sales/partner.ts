// Partner agent — Verbände, Großhändler, Hersteller, Fachmedien.
//
// Partners are NOT leads: they never enter the lead ledger and never count as
// demand. They are multipliers (member benefits, referral, co-marketing). The
// agent keeps a researched target list (partner-ziele.json, every entry with a
// public source), prepares ONE first-contact draft per partner and puts it in
// the approval queue. Nothing is sent here: there is no send path. Replies
// from a partner domain are recognised by inbound and become a partner task.

import type { ApprovalInput } from "../approval-queue.js";
import { DEMO_BOOKING_URL } from "./drafts.js";
import type { RawMail } from "./inbound.js";
import { registrableDomain } from "./model.js";

export type PartnerTyp = "verband" | "grosshandel" | "hersteller" | "medien" | "messe" | "software";
export const PARTNER_TYPEN: readonly PartnerTyp[] = ["verband", "grosshandel", "hersteller", "medien", "messe", "software"];

/** Researched target (data from public websites — never instructions). */
export interface PartnerZiel {
  id: string;
  name: string;
  typ: PartnerTyp;
  website: string;
  beschreibung?: string;
  warum: string;
  programm?: string | null;
  kontakt?: string;
  kontaktArt?: "email" | "formular";
  beleg: string;
  sicherheit?: "high" | "medium";
  prioritaet?: number;
}

export type PartnerStatus = "recherchiert" | "entwurf" | "kontaktiert" | "antwort" | "gespraech" | "partner" | "abgesagt" | "gesperrt";

export interface PartnerStand {
  id: string;
  status: PartnerStatus;
  seit: string;
  entwurfGoalId?: string;
  antworten?: Array<{ at: string; von: string; betreff: string; messageId: string }>;
  notiz?: string;
}

export type PartnerBestand = Record<string, PartnerStand>;

/** Validate one researched entry. Returns undefined (skip) for anything incomplete or unsafe. */
export function pruefeZiel(raw: unknown): PartnerZiel | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const s = (k: string, max = 600) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, max) : undefined);
  const id = s("id", 80)?.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const name = s("name", 160);
  const typ = s("typ") as PartnerTyp | undefined;
  const website = s("website", 300);
  const beleg = s("beleg", 500);
  const warum = s("warum");
  if (!id || !name || !typ || !PARTNER_TYPEN.includes(typ) || !website || !beleg || !warum) return undefined;
  if (!/^https?:\/\//.test(website) || !/^https?:\/\//.test(beleg)) return undefined;
  const kontakt = s("kontakt", 300);
  const kontaktArt: "email" | "formular" = kontakt?.includes("@") && !kontakt.startsWith("http") ? "email" : "formular";
  const prio = Number(r.prioritaet);
  return {
    id, name, typ, website, beleg, warum,
    ...(s("beschreibung") ? { beschreibung: s("beschreibung") as string } : {}),
    programm: s("programm") ?? null,
    ...(kontakt ? { kontakt, kontaktArt } : {}),
    sicherheit: r.sicherheit === "high" ? "high" : "medium",
    prioritaet: prio >= 1 && prio <= 3 ? prio : 3,
  };
}

export function ladeZiele(raw: unknown): { ziele: PartnerZiel[]; verworfen: number } {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const ziele: PartnerZiel[] = [];
  for (const x of arr) {
    const z = pruefeZiel(x);
    if (!z || seen.has(z.id)) continue;
    seen.add(z.id);
    ziele.push(z);
  }
  return { ziele, verworfen: arr.length - ziele.length };
}

const ANGEBOT: Record<PartnerTyp, string> = {
  verband: "einen Mitgliedervorteil für Ihre Innungsbetriebe (z. B. vergünstigter Zugang) oder einen Fachbeitrag bzw. Kurzvortrag zur digitalen Einsatz- und Zeitnachweisführung",
  grosshandel: "eine Empfehlungspartnerschaft: Ihre Kunden aus der Gebäudereinigung bekommen HeyAudit zu Sonderkonditionen, Sie eine Provision oder ein Zusatzangebot für Ihren Außendienst",
  hersteller: "eine Kooperation für Ihr Händler- bzw. Partnerprogramm: digitale Einsatzplanung und Qualitätsnachweise als Ergänzung zu Ihren Maschinen und Systemen",
  medien: "einen Praxisbeitrag für Ihre Leserinnen und Leser aus der Gebäudereinigung (Dienstplanung, Zeiterfassung, Nachweise gegenüber Auftraggebern) und gern eine Anzeigenkooperation",
  messe: "eine Teilnahme bzw. einen Kurzvortrag zur Digitalisierung kleiner und mittlerer Reinigungsbetriebe",
  software: "eine gegenseitige Empfehlung bzw. Schnittstelle, da sich unsere Lösungen ergänzen",
};

/** First-contact draft (Sie-Form, kurz, keine erfundenen Zahlen). A DRAFT — never sent here. */
export function partnerEntwurf(z: PartnerZiel): { an: string; betreff: string; text: string } {
  const an = z.kontaktArt === "email" ? z.kontakt ?? "—" : `Kontaktformular: ${z.kontakt ?? z.website}`;
  const text = [
    "Guten Tag,",
    "",
    `ich bin Ted Osammor, Gründer von HeyAudit. HeyAudit ist eine Software für Gebäudereinigungen: Dienstplanung, Zeiterfassung per Handy, Objekte und Qualitätsnachweise in einem System, im Browser und ab 39 € im Monat.`,
    "",
    `Ich melde mich, weil ${z.name} viele Reinigungsbetriebe erreicht. Mir schwebt ${ANGEBOT[z.typ]} vor.`,
    "",
    `Hätten Sie Interesse an einem kurzen Austausch (20 Minuten, online)? Einen Termin können Sie direkt hier wählen: ${DEMO_BOOKING_URL}`,
    "",
    "Viele Grüße",
    "Ted Osammor",
    "HeyAudit · heyaudit.de",
  ].join("\n");
  return { an, betreff: "Kooperation: digitale Einsatzplanung für Gebäudereiniger", text };
}

export function partnerFreigabe(z: PartnerZiel): ApprovalInput {
  const e = partnerEntwurf(z);
  return {
    goalId: `sales:partner:${z.id}`,
    title: `Partner-Erstkontakt: ${z.name} (${z.typ}) — Entwurf, nicht gesendet`,
    description: [
      `An: ${e.an}`,
      `Betreff: ${e.betreff}`,
      "",
      e.text,
      "",
      "---",
      `Warum: ${z.warum}`,
      z.programm ? `Bestehendes Programm: ${z.programm}` : "Bestehendes Programm: keins gefunden",
      `Beleg: ${z.beleg}`,
      "Versand nur mit Freigabe (Kanal partner_mail, Zweck erstkontakt, Volumen pro Tag).",
    ].join("\n"),
    businessImpact: z.prioritaet === 1 ? 8 : 6,
    revenueImpact: z.prioritaet === 1 ? 8 : 6,
    customerValue: 5,
    risk: "HIGH",
    priorityScore: 4 - (z.prioritaet ?? 3),
    files: [],
    estimatedEffort: "5 min",
    recommendation: "approve",
  };
}

/** Pick today's drafts: highest priority first, only never-drafted targets, max n. */
export function naechsteEntwuerfe(ziele: PartnerZiel[], bestand: PartnerBestand, n: number): PartnerZiel[] {
  return ziele
    .filter((z) => !bestand[z.id] || bestand[z.id]?.status === "recherchiert")
    .sort((a, b) => (a.prioritaet ?? 3) - (b.prioritaet ?? 3) || (a.sicherheit === "high" ? -1 : 1) - (b.sicherheit === "high" ? -1 : 1) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, n));
}

/** Map sender domain → partner id (website and contact domain). */
export function partnerDomains(ziele: PartnerZiel[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const z of ziele) {
    for (const d of [registrableDomain(z.website), z.kontaktArt === "email" ? registrableDomain(z.kontakt) : undefined]) if (d) m.set(d, z.id);
  }
  return m;
}

/** Inbound: record mails from partner domains. Idempotent by Message-ID. Returns ids of partners that answered now. */
export function partnerAntworten(mails: RawMail[], ziele: PartnerZiel[], bestand: PartnerBestand, nowIso: string): string[] {
  const doms = partnerDomains(ziele);
  const hit: string[] = [];
  for (const m of mails) {
    const id = doms.get(registrableDomain(m.from) ?? "");
    if (!id) continue;
    const st = bestand[id] ?? { id, status: "recherchiert", seit: nowIso };
    st.antworten ??= [];
    if (st.antworten.some((a) => a.messageId === m.messageId)) continue;
    st.antworten.push({ at: m.date, von: m.from, betreff: m.subject.slice(0, 200), messageId: m.messageId });
    if (!["gespraech", "partner", "abgesagt", "gesperrt"].includes(st.status)) { st.status = "antwort"; st.seit = nowIso; }
    bestand[id] = st;
    hit.push(id);
  }
  return hit;
}

export function partnerAbschnitt(ziele: PartnerZiel[], bestand: PartnerBestand): string {
  const by = (s: PartnerStatus) => ziele.filter((z) => (bestand[z.id]?.status ?? "recherchiert") === s);
  const lines = ["## Partner (Verbände, Großhandel, Hersteller, Medien)", ""];
  const antw = by("antwort");
  if (antw.length) {
    lines.push("**Antwort eingegangen — bitte lesen und weiter führen:**");
    for (const z of antw) {
      const a = bestand[z.id]?.antworten?.at(-1);
      lines.push(`- ${z.name}: „${a?.betreff ?? ""}“ von ${a?.von ?? "?"} am ${a?.at?.slice(0, 10) ?? "?"} → \`npm run sales -- partner ${z.id} gespraech|partner|abgesagt\``);
    }
    lines.push("");
  }
  const counts = (["recherchiert", "entwurf", "kontaktiert", "antwort", "gespraech", "partner", "abgesagt"] as PartnerStatus[]).map((s) => `${s} ${by(s).length}`).join(" · ");
  lines.push(`Stand: ${ziele.length} Ziele · ${counts}`);
  const entw = by("entwurf");
  if (entw.length) lines.push(`Entwürfe in der Freigabe: ${entw.map((z) => z.name).join(", ")} (Versand bleibt aus, bis Freigabe partner_mail/erstkontakt dokumentiert ist).`);
  return lines.join("\n");
}
