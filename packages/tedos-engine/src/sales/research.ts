// Research agent — weekday discovery of cleaning companies.
//
// Approved sources only: Google Places API (New) for identity + the company's
// own public homepage for observed signals. Results are TARGET accounts: they
// never count as leads and never authorise contact. Web content is matched
// with fixed patterns (no model reads it), so a page cannot inject anything.

import { existsSync, readFileSync } from "node:fs";
import type { SalesEvent } from "./model.js";
import { companyKey, normalizeEmail, registrableDomain } from "./model.js";
import type { ResearchTarget } from "./store.js";

export const RESEARCH_VERSION = "recherche@1";

export const CITIES = [
  "Berlin", "Hamburg", "München", "Köln", "Frankfurt am Main", "Stuttgart", "Düsseldorf", "Leipzig", "Dortmund", "Essen",
  "Bremen", "Dresden", "Hannover", "Nürnberg", "Duisburg", "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Münster",
  "Mannheim", "Karlsruhe", "Augsburg", "Wiesbaden", "Mönchengladbach", "Gelsenkirchen", "Aachen", "Braunschweig", "Kiel", "Chemnitz",
  "Halle (Saale)", "Magdeburg", "Freiburg im Breisgau", "Krefeld", "Mainz", "Lübeck", "Erfurt", "Oberhausen", "Rostock", "Kassel",
];
export const QUERY_TEMPLATES = ["Gebäudereinigung {city}", "Unterhaltsreinigung Firma {city}", "Reinigungsfirma {city}"];

export interface Place {
  id: string;
  name: string;
  website?: string;
  mapsUrl: string;
  address?: string;
  businessStatus?: string;
  types?: string[];
}

export type PlacesSearch = (query: string) => Promise<Place[]>;
export type PageFetch = (url: string) => Promise<string | undefined>;

export function placesSearch(apiKey: string): PlacesSearch {
  return async (query) => {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.googleMapsUri,places.formattedAddress,places.businessStatus,places.types",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "de", regionCode: "DE", pageSize: 20 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let why = "";
      try { const j = (await res.json()) as { error?: { status?: string; message?: string } }; why = `${j.error?.status ?? ""} ${j.error?.message ?? ""}`.replace(/AIza[\w-]+/g, "***").slice(0, 200); } catch { /* no body */ }
      throw new Error(`Places HTTP ${res.status} ${why}`.trim());
    }
    const j = (await res.json()) as { places?: Array<Record<string, any>> };
    return (j.places ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.displayName?.text ?? ""),
      ...(p.websiteUri ? { website: String(p.websiteUri) } : {}),
      mapsUrl: String(p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`),
      ...(p.formattedAddress ? { address: String(p.formattedAddress) } : {}),
      ...(p.businessStatus ? { businessStatus: String(p.businessStatus) } : {}),
      ...(Array.isArray(p.types) ? { types: p.types.map(String) } : {}),
    }));
  };
}

export const pageFetch: PageFetch = async (url) => {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; research-bot)" } });
    if (!res.ok) return undefined;
    const t = await res.text();
    return t.slice(0, 400_000);
  } catch {
    return undefined;
  }
};

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

/** Observed signals + fit reasons from the homepage. Patterns only. */
export function analyzeHomepage(html: string | undefined): { signals: string[]; fit: string[]; assumptions: string[]; excluded?: string } {
  if (!html) return { signals: [], fit: [], assumptions: ["Website nicht erreichbar oder nicht geprüft"] };
  const t = visibleText(html);
  const signals: string[] = [];
  const fit: string[] = [];
  const assumptions: string[] = [];
  if (/(stellenangebot|wir suchen|jobs?\b|karriere|reinigungskr(ä|ae)fte gesucht|minijob)/i.test(t)) signals.push("Stellenanzeigen/Karriereseite sichtbar (Personalbedarf)");
  if (/(unterhaltsreinigung|büroreinigung|glasreinigung|grundreinigung|treppenhausreinigung)/i.test(t)) fit.push("Bietet Unterhalts-/Büro-/Glasreinigung an (wiederkehrende Einsätze)");
  if (/(hausmeister|facility|winterdienst|gebäudeservice)/i.test(t)) fit.push("Gebäudeservice/Hausmeister im Angebot");
  const team = t.match(/(\d{2,4})\s*(mitarbeiter|beschäftigte|angestellte|reinigungskräfte)/i);
  if (team) signals.push(`Nennt ${team[1]} ${team[2]} auf der Website`);
  else assumptions.push("Mitarbeiterzahl nicht belegt");
  if (/(standorte|niederlassungen|filialen)/i.test(t)) signals.push("Erwähnt mehrere Standorte/Niederlassungen (kein Bedarfsbeleg)");
  if (/(zeiterfassung|app|digital|online-?portal)/i.test(t)) signals.push("Erwähnt Digitalisierung/App/Zeiterfassung");
  if (/(sicherheitsdienst|bewachung|objektschutz)/i.test(t) && !fit.length) return { signals, fit, assumptions, excluded: "Reiner Sicherheitsdienst (Gründerregel 07.10.)" };
  if (!fit.length) assumptions.push("Leistungsangebot auf Startseite nicht eindeutig");
  return { signals, fit, assumptions };
}

/** Domains/emails/names from block lists (any JSON/JS format: extract tokens). */
export function loadBlocklist(paths: string[]): { domains: Set<string>; emails: Set<string>; readable: string[]; unreadable: string[] } {
  const domains = new Set<string>(), emails = new Set<string>();
  const readable: string[] = [], unreadable: string[] = [];
  for (const p of paths) {
    try {
      if (!existsSync(p)) { unreadable.push(p); continue; }
      const raw = readFileSync(p, "utf8");
      for (const m of raw.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
        const e = normalizeEmail(m[0]);
        if (e) emails.add(e);
        const d = registrableDomain(m[0]);
        if (d) domains.add(d);
      }
      for (const m of raw.matchAll(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.(?:de|com|at|ch|eu|net|org|info|biz))\b/gi)) {
        const d = registrableDomain(m[1]);
        if (d) domains.add(d);
      }
      readable.push(p);
    } catch {
      unreadable.push(p);
    }
  }
  return { domains, emails, readable, unreadable };
}

export interface ResearchState { queryIndex: number; days: Record<string, number> }

export interface ResearchRun {
  created: ResearchTarget[];
  skipped: ResearchTarget[];
  events: SalesEvent[];
  queries: string[];
  state: ResearchState;
}

export async function runResearch(opts: {
  limit: number;
  today: string;
  now: string;
  state: ResearchState;
  existing: Record<string, ResearchTarget>;
  knownKeys: Set<string>;        // identity keys of accounts already in sales
  block: { domains: Set<string>; emails: Set<string> };
  search: PlacesSearch;
  fetchPage: PageFetch;
  maxQueries?: number;
}): Promise<ResearchRun> {
  const state: ResearchState = { queryIndex: opts.state.queryIndex, days: { ...opts.state.days } };
  const already = state.days[opts.today] ?? 0;
  const budget = Math.max(0, opts.limit - already);
  const created: ResearchTarget[] = [], skipped: ResearchTarget[] = [], events: SalesEvent[] = [], queries: string[] = [];
  const total = CITIES.length * QUERY_TEMPLATES.length;
  const seenDomains = new Set(Object.values(opts.existing).map((t) => registrableDomain(t.website)).filter(Boolean) as string[]);
  const seenNames = new Set(Object.values(opts.existing).map((t) => companyKey(t.company)).filter(Boolean) as string[]);
  let q = 0;
  while (created.length < budget && q < (opts.maxQueries ?? 3)) {
    const i = state.queryIndex % total;
    const city = CITIES[Math.floor(i / QUERY_TEMPLATES.length)] as string;
    const query = (QUERY_TEMPLATES[i % QUERY_TEMPLATES.length] as string).replace("{city}", city);
    state.queryIndex = (state.queryIndex + 1) % total;
    queries.push(query);
    q++;
    const places = await opts.search(query);
    for (const p of places) {
      if (created.length >= budget) break;
      const id = `places:${p.id}`;
      if (opts.existing[id] || created.some((c) => c.id === id) || skipped.some((c) => c.id === id)) continue;
      const domain = registrableDomain(p.website);
      const nameKey = companyKey(p.name);
      const base: ResearchTarget = {
        id, company: p.name, ...(p.website ? { website: p.website } : {}), sourceUrl: p.mapsUrl, query,
        signal: "", fitReason: "", assumptions: [], foundAt: opts.now, status: "neu",
      };
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      if ((domain && (seenDomains.has(domain) || opts.knownKeys.has(`dom:${domain}`))) || (nameKey && (seenNames.has(nameKey) || opts.knownKeys.has(`name:${nameKey}`)))) {
        skipped.push({ ...base, status: "dublette", fitReason: "Bereits bekannt (Account oder frühere Recherche)" });
        continue;
      }
      if (domain && opts.block.domains.has(domain)) {
        skipped.push({ ...base, status: "gesperrt", fitReason: "Domain steht auf Sperr-/Kontaktliste" });
        continue;
      }
      if (!domain) {
        skipped.push({ ...base, status: "ausgeschlossen", fitReason: "Keine Website — nicht überprüfbar" });
        continue;
      }
      const a = analyzeHomepage(await opts.fetchPage(p.website as string));
      if (a.excluded) { skipped.push({ ...base, status: "ausgeschlossen", fitReason: a.excluded }); continue; }
      const target: ResearchTarget = {
        ...base,
        signal: a.signals.join("; ") || "Kein besonderes Signal auf der Startseite",
        fitReason: [`Places-Treffer für „${query}“${p.address ? ` (${p.address})` : ""}`, ...a.fit].join("; "),
        assumptions: a.assumptions,
      };
      created.push(target);
      seenDomains.add(domain);
      if (nameKey) seenNames.add(nameKey);
      events.push({
        id, kind: "target", at: opts.now, origin: "research", company: p.name, website: p.website as string,
        evidenceUrl: p.mapsUrl, note: target.signal, source: "recherche",
      });
    }
  }
  state.days[opts.today] = already + created.length;
  return { created, skipped, events, queries, state };
}
