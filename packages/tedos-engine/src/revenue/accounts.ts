// Revenue Engine — real account loader + re-scoring.
//
// Loads the REAL HeyCarbo accounts from the Sales CRM (`crm-heycarbo/leads.js`,
// a `window.LEADS = [...]` file with 1,783 qualified accounts) and normalizes
// them. NO fictional companies: if the file is absent the loader returns [] and
// the caller reports a missing-data gap (Evidence Layer rule — never fabricate).
// Re-scoring is deterministic, derived only from the real fields.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { activeBrandProfile } from "./brand-profile.js";

/** The raw lead shape as stored in crm-heycarbo/leads.js (subset we use). */
export interface RawLead {
  id?: string;
  name?: string;
  prio?: string;
  score?: number;
  buy_score?: number;
  verdict?: string;
  segment?: string;
  industry?: string;
  product_category?: string;
  employees?: number;
  revenue?: string;
  director?: string;
  buyer_titles?: string[];
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  why?: string;
  customers?: string[] | string;
  services?: string[] | string;
  supplier_pressure?: string;
  heycarbo_pain_points?: string[] | string;
  certifications?: string[] | string;
  pcf_relevance?: string;
  catena_x_relevance?: string;
  csrd_relevance?: string;
  crm_status?: string;
}

/** A normalized, real account the Revenue Engine works with. */
export interface Account {
  id: string;
  company: string;
  industry: string;
  segment?: string;
  products?: string;
  website?: string;
  contactTitle?: string;
  email?: string;
  employees?: number;
  revenueText?: string;
  painPoints: string[];
  certifications: string[];
  customers: string[];
  pcfRelevance?: string;
  catenaXRelevance?: string;
  csrdRelevance?: string;
  supplierPressure?: string;
  prio: string;
  crmStatus?: string;
  // Re-scored (0–100) + composite priority.
  fitScore: number;
  revenueScore: number;
  buyingIntent: number;
  priority: number;
}

const asArray = (v: string[] | string | undefined): string[] => {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(/\s*\|\s*/).filter(Boolean);
  return [];
};

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Parse revenue text like "~150M EUR (2022)" / "2.5 Mrd" → million EUR, or null. */
export function revenueMillions(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(",", ".").match(/([\d.]+)\s*(mrd|mio|m|b|k)?/i);
  if (!m) return null;
  const n = parseFloat(m[1] as string);
  if (Number.isNaN(n)) return null;
  const unit = (m[2] ?? "m").toLowerCase();
  if (unit === "mrd" || unit === "b") return n * 1000;
  if (unit === "k") return n / 1000;
  return n; // m / mio / default → millions
}

/** Buying intent (0–100) from the explicit buy_score, else prio + CRM status. */
function buyingIntentOf(l: RawLead): number {
  if (typeof l.buy_score === "number") return clamp100(l.buy_score <= 1 ? l.buy_score * 100 : l.buy_score);
  const byPrio: Record<string, number> = { A: 80, B: 55, C: 30 };
  let base = byPrio[(l.prio ?? "").toUpperCase()] ?? 40;
  if (/contacted|engaged|replied|meeting/i.test(l.crm_status ?? "")) base += 10;
  return clamp100(base);
}

/** Revenue potential (0–100) from company size (revenue first, employees fallback). */
function revenueScoreOf(l: RawLead): number {
  const rev = revenueMillions(l.revenue);
  if (rev !== null) return clamp100(Math.min(100, (Math.log10(rev + 1) / Math.log10(2000)) * 100));
  const emp = l.employees ?? 0;
  return clamp100(Math.min(100, (Math.log10(emp + 1) / Math.log10(5000)) * 100));
}

/** Read a raw-lead field by name (the product-specific pain field is profile-driven). */
function rawField(l: RawLead, name: string): string[] | string | undefined {
  return (l as unknown as Record<string, unknown>)[name] as string[] | string | undefined;
}

/** Normalize + re-score one raw lead. */
export function normalize(l: RawLead, index: number): Account {
  const fitScore = clamp100(typeof l.score === "number" ? (l.score <= 1 ? l.score * 100 : l.score) : 50);
  const revenueScore = revenueScoreOf(l);
  const buyingIntent = buyingIntentOf(l);
  // Priority composite — revenue first, then ICP fit, then buying intent (spec order).
  const priority = Math.round(revenueScore * 0.45 + fitScore * 0.35 + buyingIntent * 0.2);
  const pains = asArray(rawField(l, activeBrandProfile().data.painField));
  return {
    id: l.id ?? `acct-${index + 1}`,
    company: (l.name ?? "").trim() || `Account ${index + 1}`,
    industry: (l.industry || l.segment || l.product_category || "Unbekannt").trim(),
    ...(l.segment ? { segment: l.segment } : {}),
    ...(l.product_category ? { products: l.product_category } : {}),
    customers: asArray(l.customers),
    ...(l.website ? { website: l.website } : {}),
    ...(l.buyer_titles?.[0] || l.director ? { contactTitle: l.buyer_titles?.[0] ?? l.director } : {}),
    ...(l.email ? { email: l.email } : {}),
    ...(typeof l.employees === "number" ? { employees: l.employees } : {}),
    ...(l.revenue ? { revenueText: l.revenue } : {}),
    painPoints: pains.length ? pains : asArray(l.why).slice(0, 3),
    certifications: asArray(l.certifications),
    ...(l.pcf_relevance ? { pcfRelevance: l.pcf_relevance } : {}),
    ...(l.catena_x_relevance ? { catenaXRelevance: l.catena_x_relevance } : {}),
    ...(l.csrd_relevance ? { csrdRelevance: l.csrd_relevance } : {}),
    ...(l.supplier_pressure ? { supplierPressure: l.supplier_pressure } : {}),
    prio: (l.prio ?? "C").toUpperCase(),
    ...(l.crm_status ? { crmStatus: l.crm_status } : {}),
    fitScore, revenueScore, buyingIntent, priority,
  };
}

/** Parse a `window.LEADS = [...]` text into normalized accounts. */
export function parseLeads(text: string): Account[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0 || end < start) return [];
  let leads: RawLead[];
  try {
    leads = JSON.parse(text.slice(start, end + 1)) as RawLead[];
  } catch {
    return [];
  }
  return leads.map(normalize);
}

/** Default path to the real Sales CRM accounts, relative to the engine package. */
export function defaultAccountsPath(): string {
  return process.env.REVENUE_ACCOUNTS_PATH ?? resolve(process.cwd(), activeBrandProfile().data.dataPath);
}

/**
 * Load the real accounts from disk. Returns [] (never throws, never fabricates)
 * when the file is missing/unreadable — the caller surfaces the missing-data gap.
 */
export function loadAccounts(path: string = defaultAccountsPath()): Account[] {
  if (!existsSync(path)) return [];
  try {
    return parseLeads(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

/** Spec priority order: revenue → ICP fit → buying intent → (size as cycle proxy). */
export function prioritize(accounts: Account[]): Account[] {
  return [...accounts].sort(
    (a, b) =>
      b.revenueScore - a.revenueScore ||
      b.fitScore - a.fitScore ||
      b.buyingIntent - a.buyingIntent ||
      (b.employees ?? 0) - (a.employees ?? 0),
  );
}
