// Partner agent — Verbände, Großhändler, Hersteller, Fachmedien.
//
// Partners are NOT leads: they never enter the lead ledger and never count as
// demand. They are multipliers (member benefits, referral, co-marketing). The
// agent keeps a researched target list (partner-ziele.json, every entry with a
// public source), prepares ONE first-contact draft per partner and puts it in
// the approval queue. Nothing is sent here: there is no send path. Replies
// from a partner domain are recognised by inbound and become a partner task.

import type { ApprovalInput } from "../approval-queue.js";
import type { RawMail } from "./inbound.js";
import { registrableDomain } from "./model.js";

export type PartnerTyp = "verband" | "grosshandel" | "hersteller" | "medien" | "messe" | "software" | "hausverwaltung" | "plattform" | "berater";
export const PARTNER_TYPEN: readonly PartnerTyp[] = ["verband", "grosshandel", "hersteller", "medien", "messe", "software", "hausverwaltung", "plattform", "berater"];

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

export type PartnerStatus = "recherchiert" | "entwurf" | "sendet" | "kontaktiert" | "antwort" | "gespraech" | "partner" | "abgesagt" | "gesperrt";

export interface PartnerStand {
  id: string;
  status: PartnerStatus;
  seit: string;
  entwurfGoalId?: string;
  gesendet?: { at: string; an: string; messageId: string };
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

// Texts follow Ted's own partner mails of 18.11.2026 (Praxisformat + Partnerprogramm,
// no prices, no feature list). The closing ("Viele Grüße / Ted Osammor") is part of
// the Gmail signature, which is appended at send time from the runtime (never in git).
const ANGEBOT: Record<PartnerTyp, { betreff: string; absatz: string }> = {
  verband: {
    betreff: "Praxisformat zur digitalen Objektorganisation für Ihre Mitgliedsbetriebe",
    absatz: "Ich würde gerne ein kurzes Praxisformat für Ihre Mitgliedsbetriebe anbieten. An einem Beispiel zeige ich, wie kleinere und mittlere Reinigungsbetriebe Schichten, Arbeitszeiten und Qualitätskontrollen pro Objekt organisieren können. Sie hätten damit einen fertigen Baustein für einen Mitgliedstermin. Vorbereitung und Durchführung übernehme ich.\n\nWäre es möglich, das bei einem Ihrer nächsten Mitgliedstermine auszuprobieren? Falls ein Webinar oder ein bestehendes Weiterbildungsformat besser passt, würde ich mich freuen, mit Ihnen darüber zu sprechen.",
  },
  messe: {
    betreff: "Anfrage Praxisvortrag zur digitalen Objektorganisation in der Gebäudereinigung",
    absatz: "Ich würde gerne einen kurzen Praxisvortrag für Ihr Fachprogramm anbieten. An einem Beispiel zeige ich, wie kleinere und mittlere Reinigungsbetriebe Schichten, Arbeitszeiten und Qualitätskontrollen pro Objekt organisieren können. Die Besucherinnen und Besucher nehmen einen konkreten Ablauf für den eigenen Betrieb mit. Vorbereitung und Durchführung übernehme ich.\n\nWäre es möglich, so einen Beitrag in einem Ihrer Fachforen unterzubringen? Falls ein anderes Format besser passt, würde ich mich über Ihre Einschätzung und einen kurzen Austausch freuen.",
  },
  grosshandel: {
    betreff: "Partnerschaftsidee für Ihre Gebäudereinigungskunden",
    absatz: "Ich würde gerne mit Ihnen eine Empfehlungspartnerschaft ausprobieren. Wenn ein Kunde seine Abläufe digitalisieren möchte, können Sie ihm im Beratungsgespräch direkt eine passende Lösung anbieten. Bei Interesse stellen Sie kurz den Kontakt her. Demo, Einrichtung und Betreuung übernehme ich persönlich.\n\nWäre es möglich, das mit zwei oder drei passenden Betrieben zu testen? Falls ein Kundentermin oder ein gemeinsamer Workshop besser passt, würde ich mich freuen, wenn wir kurz über diese Form der Zusammenarbeit sprechen.",
  },
  hersteller: {
    betreff: "Kooperationsidee für Ihre Kunden aus der Gebäudereinigung",
    absatz: "Ich würde gerne mit Ihnen eine Kooperation ausprobieren. Viele Ihrer Kunden aus der Gebäudereinigung organisieren Einsätze, Arbeitszeiten und Qualitätskontrollen noch auf Papier oder in Tabellen. HeyAudit ergänzt Ihre Maschinen und Systeme genau an dieser Stelle. Bei Interesse stellen Sie kurz den Kontakt her. Demo, Einrichtung und Betreuung übernehme ich persönlich.\n\nWäre es möglich, das mit zwei oder drei passenden Kunden zu testen? Falls ein gemeinsamer Kundentermin oder Workshop besser passt, würde ich mich über einen kurzen Austausch freuen.",
  },
  medien: {
    betreff: "Kooperationsidee für Ihre Leserinnen und Leser aus der Gebäudereinigung",
    absatz: "Ich würde gerne mit Ihnen eine Kooperation ausprobieren. Ihre Leserinnen und Leser aus der Gebäudereinigung bekommen ein exklusives Angebot für HeyAudit, und ich liefere Ihnen dazu gern einen Fachbeitrag aus der Praxis, etwa wie ein Betrieb Schichten, Arbeitszeiten und Qualitätskontrollen pro Objekt organisiert und gegenüber Auftraggebern nachweist.\n\nWäre so eine Kooperation für Sie interessant? Falls ein Newsletter, eine Anzeige oder ein anderes Format besser passt, würde ich mich über einen kurzen Austausch freuen.",
  },
  hausverwaltung: {
    betreff: "Nachweisbare Reinigungsqualität in Ihren Objekten",
    absatz: "Für Hausverwaltungen ist das spannend, weil Ihre Reinigungsdienstleister mit HeyAudit pro Objekt nachweisen, wann wer vor Ort war und was erledigt wurde, inklusive Fotos und Checklisten. Sie bekommen damit eine verlässliche Grundlage gegenüber Eigentümern und Mietern, ohne selbst eine Software einführen zu müssen.\n\nIch würde gerne mit Ihnen ausprobieren, ob Sie HeyAudit Ihren Reinigungsdienstleistern empfehlen möchten. Wäre ein kurzer Austausch dazu möglich?",
  },
  plattform: {
    betreff: "Partnerschaftsidee für die Reinigungsbetriebe auf Ihrer Plattform",
    absatz: "Ich würde gerne mit Ihnen eine Partnerschaft ausprobieren. Die Reinigungsbetriebe auf Ihrer Plattform bekommen ein exklusives Angebot für HeyAudit und können ihren Auftraggebern damit ihre Leistung pro Objekt sauber nachweisen. Das stärkt auch die Qualität der Betriebe, die Sie vermitteln. Einrichtung und Betreuung übernehme ich persönlich.\n\nWäre es möglich, das mit einigen Betrieben zu testen? Falls eine Integration oder ein anderes Format besser passt, würde ich mich über einen kurzen Austausch freuen.",
  },
  berater: {
    betreff: "Partnerschaftsidee für Ihre Mandanten aus der Gebäudereinigung",
    absatz: "Ich würde gerne mit Ihnen eine Empfehlungspartnerschaft ausprobieren. Wenn ein Betrieb, den Sie betreuen, seine Abläufe digitalisieren möchte, können Sie ihm direkt eine passende Lösung empfehlen. Bei Interesse stellen Sie kurz den Kontakt her. Demo, Einrichtung und Betreuung übernehme ich persönlich.\n\nWäre es möglich, das mit zwei oder drei passenden Betrieben zu testen? Ich würde mich über einen kurzen Austausch freuen.",
  },
  software: {
    betreff: "Idee für eine gegenseitige Empfehlung",
    absatz: "Ich würde gerne mit Ihnen über eine gegenseitige Empfehlung sprechen. Unsere Lösungen ergänzen sich, und viele Reinigungsbetriebe suchen genau diese Kombination. Bei Interesse stellen wir uns gegenseitig kurz den Kontakt her.\n\nWäre ein kurzer Austausch dazu möglich?",
  },
};

const PARTNERPROGRAMM = "Gerne würde ich Ihnen dazu auch unser Partnerprogramm anbieten. Für jeden von Ihnen vermittelten Kunden, der ein kostenpflichtiges HeyAudit-Abo abschließt, erhält Ihre Organisation 10 % des ersten bezahlten Jahresumsatzes. Damit können Sie Ihren Kunden oder Mitgliedern eine passende Lösung für ihren Alltag empfehlen und selbst finanziell von erfolgreichen Vermittlungen profitieren. Vorstellung, Einrichtung und laufende Betreuung übernehmen wir.\n\nWäre eine solche Partnerschaft für Sie grundsätzlich interessant? Ich würde mich freuen, wenn wir gemeinsam schauen, wie sie am besten zu Ihrem Angebot passt.";

/** Name for running text: "BIV – Die Gebäudedienstleister" → "BIV"-style short form without suffixes. */
export function kurzname(name: string): string {
  const k = name.split(/\s+[–-]\s+|\s+\(/)[0]?.trim() ?? name;
  return k.length >= 3 ? k : name;
}

/** First-contact draft (Sie-Form, Teds Stil). Ends before the closing: the Gmail signature adds it. */
export function partnerEntwurf(z: PartnerZiel): { an: string; betreff: string; text: string } {
  const an = z.kontaktArt === "email" ? z.kontakt ?? "—" : `Kontaktformular: ${z.kontakt ?? z.website}`;
  const o = ANGEBOT[z.typ];
  const text = [
    "Guten Tag,",
    "",
    "ich bin Ted Osammor, Gründer von HeyAudit aus Köln. Wir haben HeyAudit speziell für Gebäudereinigungsbetriebe entwickelt. Schichtplanung, Zeiterfassung und Qualitätskontrollen laufen damit direkt am jeweiligen Objekt zusammen. Erste Reinigungsbetriebe nutzen HeyAudit bereits und sind sehr zufrieden.",
    "",
    o.absatz,
    ...(z.typ === "software" ? [] : ["", PARTNERPROGRAMM]),
  ].join("\n");
  return { an, betreff: o.betreff, text };
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
      "Absender ted@heyaudit.de, darunter die Gmail-Signatur (Viele Grüße, Ted Osammor, HeyAudit, Adresse, Banner).",
      "Versand nur mit Freigabe (Kanal partner_mail, Zweck erstkontakt, Volumen pro Tag), nie an Domains, die schon im Gesendet-Ordner stehen.",
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
  const haengt = by("sendet");
  if (haengt.length) lines.push(`⚠ Versand unklar (abgebrochen?) — bitte im Gesendet-Ordner prüfen, wird NICHT automatisch wiederholt: ${haengt.map((z) => z.name).join(", ")}`);
  const entw = by("entwurf");
  if (entw.length) lines.push(`Entwürfe in der Freigabe: ${entw.map((z) => z.name).join(", ")}. Freigegebene E-Mails gehen werktags raus (max. laut freigaben.json), Formular-Kontakte füllt Ted von Hand aus.`);
  return lines.join("\n");
}

// ── Versand (nur nach Einzelfreigabe + dokumentierter Kanalfreigabe) ──────

export const PARTNER_KANAL = "partner_mail";
export const PARTNER_ZWECK = "erstkontakt";

/** Exactly the text Ted approved: parse An/Betreff/Text out of the approval description. */
export function freigegebeneMail(description: string): { an: string; betreff: string; text: string } | undefined {
  const [kopf] = description.split(/\n---\n/);
  if (!kopf) return undefined;
  const m = kopf.match(/^An: (.+)\nBetreff: (.+)\n\n([\s\S]+)$/);
  if (!m) return undefined;
  const [, an, betreff, text] = m;
  if (!an || !betreff || !text) return undefined;
  return { an: an.trim(), betreff: betreff.trim(), text: text.trimEnd() };
}

export interface VersandPruefung { ok: boolean; warum: string }

/** All gates for one partner mail. Pure: caller supplies state. */
export function darfPartnerSenden(o: {
  ziel: PartnerZiel;
  stand: PartnerStand | undefined;
  freigabeStatus: string | undefined;
  mail: { an: string } | undefined;
  kanalFreigabe: { proTag: number; bis?: string } | undefined;
  heute: string;
  wochentag: number;
  heuteGesendet: number;
  gesperrt: { domains: Set<string>; emails: Set<string> };
}): VersandPruefung {
  if (!o.kanalFreigabe || (o.kanalFreigabe.bis && o.kanalFreigabe.bis < o.heute)) return { ok: false, warum: "keine gültige Kanalfreigabe partner_mail/erstkontakt" };
  if (o.wochentag > 5) return { ok: false, warum: "Wochenende" };
  if (o.heuteGesendet >= o.kanalFreigabe.proTag) return { ok: false, warum: `Tagesvolumen ${o.kanalFreigabe.proTag} erreicht` };
  if (o.freigabeStatus !== "approved") return { ok: false, warum: "Entwurf nicht freigegeben" };
  if (o.stand?.status !== "entwurf") return { ok: false, warum: `Status ${o.stand?.status ?? "—"} (nur Entwürfe werden gesendet, jede Mail höchstens einmal)` };
  if (o.ziel.kontaktArt !== "email") return { ok: false, warum: "nur Kontaktformular — von Hand ausfüllen" };
  const an = o.mail?.an.toLowerCase();
  if (!an || !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/.test(an)) return { ok: false, warum: "keine gültige Empfängeradresse im freigegebenen Entwurf" };
  if (an !== o.ziel.kontakt?.toLowerCase()) return { ok: false, warum: "Empfänger weicht von der recherchierten Adresse ab" };
  const dom = registrableDomain(an);
  if (o.gesperrt.emails.has(an) || (dom && o.gesperrt.domains.has(dom))) return { ok: false, warum: "Adresse/Domain auf Sperrliste (schon kontaktiert oder abgemeldet)" };
  return { ok: true, warum: "Einzelfreigabe + Kanalfreigabe" };
}
