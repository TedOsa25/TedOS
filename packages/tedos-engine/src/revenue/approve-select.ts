// HARDENED APPROVAL SELECTION — picks the next N leads to auto-approve.
//
// Pure selection logic (no send, no SMTP, no DNS). Applies, in order:
//   • eligible status (never sent/decided/opted-out/bounced/already-approved)
//   • deliverable address + data quality (company + industry present)
//   • DUPLICATE exclusion (unique lower-cased address)
//   • DOMAIN MATCH — the email domain must belong to the company (its website
//     domain, or a name token). Foreign third-party addresses like
//     info@joppnet.de for "Kapp Niles" are rejected (they caused a bounce).
// Then ranks fit-first (revenue → fit → buying intent) and, as a tiebreaker,
// PREFERS personalized addresses over generic role mailboxes (info@, kontakt@…).

import { type Account, prioritize } from "./accounts.js";
import type { LeadRecord } from "./batch-send.js";
import { istGrosskonzern } from "./grossunternehmen.js";

/** Obergrenze wie im Nachfassen: bei dieser Groesse entscheidet niemand ueber info@. */
const MAX_MITARBEITENDE = Number(process.env.REVENUE_MAX_MITARBEITENDE ?? 2000);

/**
 * Statuses that make a lead ineligible for a fresh approval.
 *
 * "replied", "demo-booked" and "won" are here for the same reason as "sent":
 * the conversation has already started, and dropping a cold outbound mail into
 * it is the worst possible touch. The send-side selector already refuses these
 * (ALREADY_CONTACTED in batch-send.ts), so leaving them out never leaked a real
 * email — it just let them consume approval slots and silently shrink the
 * batch below the requested N.
 */
const INELIGIBLE = new Set([
  "sent", "lost", "unsubscribed", "approved", "bounced", "replied", "demo-booked", "won",
]);

/** Generic role mailboxes — deliverable but rarely reach a decision-maker. */
const ROLE_LOCALPARTS = new Set([
  "info", "kontakt", "contact", "service", "office", "zentrale", "mail", "email",
  "sales", "vertrieb", "hello", "team", "welcome", "anfrage", "anfragen", "presse",
  "marketing", "empfang", "buchhaltung", "no-reply", "noreply", "kommunikation",
  "webmaster", "communications", "customercenter", "customer", "support", "help",
  "dpo", "admin", "enquiries", "inquiries", "enquiry", "inquiry", "order", "orders",
  "karriere", "career", "jobs", "hr", "datenschutz", "compliance", "presales",
]);

/** Company-name words that are not distinctive brand tokens. */
const STOPWORDS = new Set([
  "group", "gruppe", "gmbh", "holding", "technologies", "technology", "international",
  "unternehmen", "maschinenfabrik", "gesellschaft", "systems", "systeme", "werke",
  "and", "und", "the", "gmbhcokg", "kgaa", "aktiengesellschaft",
]);

/** Registrable-ish core label of a host, e.g. "kapp-niles.com" → "kapp-niles". */
function coreLabel(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, "");
  const parts = h.split(".").filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? h) : h;
}

/** Host from a website field (tolerates missing protocol / paths). */
function websiteHost(website: string | undefined): string {
  if (!website) return "";
  const raw = website.trim();
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  }
}

/** Distinctive lower-case tokens (len ≥ 4) from a company name. */
function nameTokens(company: string): string[] {
  return company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** True when the email's domain plausibly belongs to the company. */
export function domainMatches(email: string, website: string | undefined, company: string): boolean {
  const emailHost = (email.split("@")[1] ?? "").toLowerCase();
  if (!emailHost) return false;
  const eCore = coreLabel(emailHost);
  const wHost = websiteHost(website);
  if (wHost) {
    const wCore = coreLabel(wHost);
    if (eCore === wCore) return true;
    if (emailHost.endsWith(wHost) || wHost.endsWith(emailHost)) return true; // sub-domains
    if (eCore.length >= 4 && wCore.includes(eCore)) return true;
    if (wCore.length >= 4 && eCore.includes(wCore)) return true;
    return false;
  }
  // No website on file → fall back to a company-name token appearing in the domain.
  return nameTokens(company).some((t) => eCore.includes(t) || t.includes(eCore));
}

/**
 * True when the local part looks like a person (firstname.lastname / f.lastname),
 * not a generic role mailbox. Conservative on purpose — it is only a ranking
 * tiebreaker, so a false "role" is cheaper than an inflated personalized count.
 */
export function isPersonalized(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (!local) return false;
  const tokens = local.split(/[.\-_]+/).filter(Boolean);
  if (tokens.some((t) => ROLE_LOCALPARTS.has(t))) return false;
  const alpha = tokens.filter((t) => /^[a-z]+$/.test(t));
  return alpha.length >= 2 && alpha.some((t) => t.length >= 2);
}

/**
 * Grundform einer zustellbaren Adresse — genau ein "@", eine Domain mit Punkt,
 * und eine TLD, die eine sein kann.
 *
 * WARUM DIE TLD GEPRUEFT WIRD. Am 20.08.2026 stand `vertrieb@kroll.deinternet`
 * in einer Batch-Auswahl. Die Adresse kam aus einem Impressum, in dem hinter
 * der Adresse ohne Trennzeichen das naechste Wort stand ("…kroll.de" +
 * "Internet"). `domainMatches` liess sie durch, weil der Kern "kroll" stimmt —
 * der Abgleich prueft die ZUGEHOERIGKEIT, nicht die Existenz. Vier solche
 * Adressen lagen im Bestand, zwei davon als "belegt" markiert.
 *
 * Die Ursache ist im Extraktor behoben (`tldSuffixWeg` in enrich-emails.mjs).
 * Diese Pruefung ist das zweite Netz: sie greift auch fuer Adressen, die auf
 * anderem Weg ins CRM gekommen sind, und kostet nichts.
 *
 * ERKANNT WIRD DIE FEHLERSIGNATUR, NICHT EINE TLD-LISTE. Eine Positivliste
 * waere bei der naechsten neuen TLD veraltet, und "deinternet" besteht jede
 * reine Formpruefung — es sind schlicht Buchstaben. Der Fehler hat aber eine
 * eigene Form: eine GUELTIGE TLD mit angehaengtem Wort. Genau danach wird
 * gesucht — laenger als sechs Zeichen UND beginnt mit einer bekannten TLD.
 *
 * "immobilien", "photography", "berlin", "hamburg" bleiben damit gueltig; sie
 * beginnen mit keiner TLD. Bewusst in Kauf genommen: ".network" beginnt mit
 * "net" und wird abgelehnt. Fuer DACH-Industrie ist das kein realer Fall, und
 * abgelehnt heisst hier gemeldet, nicht still verworfen.
 */
const BEKANNTE_TLD = ["com", "net", "org", "info", "biz", "eu", "de", "at", "ch", "li", "lu", "nl", "fr", "it", "es", "pl", "cz", "dk", "se", "uk", "io"];

export function istZustellbar(email: string): boolean {
  const teile = email.split("@");
  if (teile.length !== 2) return false;
  const [lokal, domain] = teile as [string, string];
  if (!lokal || /\s/.test(email)) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) return false;
  const tld = (labels[labels.length - 1] as string).toLowerCase();
  if (!/^[a-z]{2,24}$/.test(tld)) return false;
  if (tld.length > 6 && BEKANNTE_TLD.some((t) => tld.startsWith(t))) return false;
  return true;
}

export interface ApprovalSelection {
  pick: Account[];
  eligible: number;
  rejected: { status: number; noEmail: number; dataQuality: number; duplicate: number; domainMismatch: number; zuGross: number; bereitsKontaktiert: number };
  personalizedInPick: number;
}

/**
 * Select up to `limit` leads to approve, applying the hardened filter and
 * ranking fit-first with a personalized-address tiebreaker. Pure — no side effects.
 */
export function selectForApproval(
  accounts: Account[],
  statusMap: Record<string, LeadRecord>,
  limit: number,
  /** Vorrangige Reihenfolge (IDs aus dem Versandpool). Leer = wie bisher nach fitScore. */
  order?: string[],
  /**
   * Adressen, die ein FRUEHERER Batch schon erreicht hat — ueber ALLE Lead-Ids
   * hinweg, nicht nur ueber die hier uebergebenen Kandidaten.
   *
   * Ohne sie prueft der Statusfilter oben nur den Status der EIGENEN Id. Sitzt
   * dieselbe Firma unter einer zweiten Id im CRM — bei einem Massenimport der
   * Regelfall, nicht die Ausnahme — wird die zweite Id freigegeben, obwohl das
   * Postfach laengst angeschrieben ist. `contactedAddresses()` in batch-send.ts
   * faengt das ab, aber erst im Preflight: die Freigabe ist da schon erteilt und
   * der Batch schrumpft still von 20 auf 19.
   *
   * Genau so ist es am 02.09.2026 passiert. Der VDMA-Messe-Import vom 31.08.
   * brachte 20 solcher Zweitschriften mit (Jungheinrich Degernpoint mit der
   * Konzernadresse info@jungheinrich.de, die am 06.07. schon an Jungheinrich AG
   * ging; August Beck mit info@mapal.com, das schon an MAPAL ging). Der
   * Approval-Lauf meldete dazu "0 Dubletten" — er verglich die Kandidaten nur
   * untereinander.
   *
   * Der Aufrufer muss die Menge aus dem VOLLEN CRM bauen, vor jeder
   * Whitelist-Filterung: die bereits kontaktierte Zwilling-Id steht typischer-
   * weise gar nicht im Versandpool.
   */
  bereitsKontaktiert: Set<string> = new Set(),
): ApprovalSelection {
  const rejected = { status: 0, noEmail: 0, dataQuality: 0, duplicate: 0, domainMismatch: 0, zuGross: 0, bereitsKontaktiert: 0 };
  const seen = new Set<string>();
  const eligible: Account[] = [];

  for (const a of prioritize(accounts)) {
    const st = statusMap[a.id]?.status ?? "active";
    if (INELIGIBLE.has(st)) { rejected.status += 1; continue; }
    const email = (a.email ?? "").trim();
    if (!email) { rejected.noEmail += 1; continue; }
    if (!istZustellbar(email)) { rejected.noEmail += 1; continue; }
    if (!a.company || !a.industry) { rejected.dataQuality += 1; continue; }

    /**
     * OBERGRENZE — hier fehlte sie, im Nachfassen gab es sie längst.
     *
     * `followup-run.ts` schliesst seit dem 19.08. alles über 2.000
     * Mitarbeitende aus, plus `istGrosskonzern` für die 55 % der Leads, bei
     * denen im CRM gar keine Zahl steht. Der ERSTKONTAKT hatte beides nicht:
     * ein Lead ohne hinterlegte Grösse lief hier ungebremst durch.
     *
     * Aufgefallen ist das beim Automatisieren der Pool-Erstellung. Der
     * Versandpool trug die Regel bis dahin stellvertretend — er verlangte eine
     * belegte Mitarbeiterzahl, weil sonst Schaeffler und MAHLE mitgefahren
     * wären. Das kostete 43 der 75 verbleibenden Leads und hätte auch REEL
     * ausgeschlossen, unsere erste gebuchte Demo, die überhaupt keine Zahl
     * hinterlegt hat.
     *
     * Mit der Regel an der richtigen Stelle darf der Pool wieder alle
     * Kandidaten führen: die Grösse filtert die Engine, nicht die CSV-Datei.
     *
     * KEINE UNTERGRENZE — Bcomp hat 51 Mitarbeitende und ist die
     * aussichtsreichste Anfrage der Kampagne.
     */
    const mitarbeitende = typeof a.employees === "number" && a.employees > 0 ? a.employees : null;
    if (mitarbeitende !== null && mitarbeitende > MAX_MITARBEITENDE) { rejected.zuGross += 1; continue; }
    if (istGrosskonzern(email)) { rejected.zuGross += 1; continue; }
    const key = email.toLowerCase();
    // Getrennt von `duplicate` gezaehlt, wie im Preflight (dupDropped vs.
    // contactedDropped): "zwei Kandidaten teilen eine Adresse" und "die Adresse
    // ist verbrannt" sind verschiedene Befunde und fuehren zu verschiedenen
    // Aufraeumarbeiten.
    if (bereitsKontaktiert.has(key)) { rejected.bereitsKontaktiert += 1; continue; }
    if (seen.has(key)) { rejected.duplicate += 1; continue; }
    if (!domainMatches(email, a.website, a.company)) { rejected.domainMismatch += 1; continue; }
    seen.add(key);
    eligible.push(a);
  }

  /**
   * Eine mitgegebene Reihenfolge schlaegt den fitScore.
   *
   * Der Versandpool ist bereits eine Rangfolge — `lookalike.mjs` sortiert ihn
   * nach Aehnlichkeit zu den 41 belegten Kaeufern. Hier wurde er trotzdem neu
   * sortiert, nach revenueScore/fitScore, und damit weggeworfen.
   *
   * Das ist nicht bloss doppelt gemoppelt, sondern die schlechtere der beiden
   * Rangfolgen: REEL GmbH, die einzige gebuchte Demo, hatte fitScore 65 und
   * waere ueber diese Sortierung nie in einen Batch gekommen. Genau deshalb
   * wurde das Lookalike-Scoring ueberhaupt gebaut — aus abgeschlossenen
   * Kaeufen statt aus Annahmen.
   *
   * Ohne Reihenfolge bleibt alles wie bisher: wer `approve` ohne Whitelist
   * aufruft, bekommt weiter die fit-basierte Sortierung.
   */
  if (order?.length) {
    const rang = new Map(order.map((id, i) => [id, i]));
    const ANS_ENDE = Number.MAX_SAFE_INTEGER;
    eligible.sort(
      (a, b) =>
        (rang.get(a.id) ?? ANS_ENDE) - (rang.get(b.id) ?? ANS_ENDE) ||
        (Number(isPersonalized(b.email as string)) - Number(isPersonalized(a.email as string))),
    );
  } else {
    // Fit-first, personalized address as tiebreaker.
    eligible.sort(
      (a, b) =>
        b.revenueScore - a.revenueScore ||
        b.fitScore - a.fitScore ||
        (Number(isPersonalized(b.email as string)) - Number(isPersonalized(a.email as string))) ||
        b.buyingIntent - a.buyingIntent,
    );
  }

  const pick = eligible.slice(0, limit);
  return {
    pick,
    eligible: eligible.length,
    rejected,
    personalizedInPick: pick.filter((a) => isPersonalized(a.email as string)).length,
  };
}
