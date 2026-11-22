// Kleiner HTTP-Helfer für Notion, Apify, Metricool: Retry bei 429/5xx mit
// Retry-After, exponentiellem Backoff und Fehlermeldungen ohne Geheimnisse.

export type Abruf = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export const echterAbruf: Abruf = (url, init) => fetch(url, init);

export class HttpFehler extends Error {
  constructor(public readonly status: number, public readonly dienst: string, nachricht: string) {
    super(`${dienst} HTTP ${status}: ${nachricht}`);
  }
}

/** Entfernt alles, was wie ein Token aussieht, aus Fehlermeldungen. */
export function ohneGeheimnis(t: string): string {
  return t.replace(/(Bearer\s+|token=|X-Mc-Auth[:=]\s*|secret_|ntn_|apify_api_)[A-Za-z0-9._-]+/gi, "$1***").slice(0, 300);
}

export interface RetryOpt { versuche?: number; basisMs?: number; schlaf?: (ms: number) => Promise<void> }
const schlafen = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function anfrage<T>(dienst: string, abruf: Abruf, url: string, init: { method: string; headers: Record<string, string>; body?: unknown }, opt: RetryOpt = {}): Promise<T> {
  const versuche = opt.versuche ?? 5;
  const basis = opt.basisMs ?? 500;
  const schlaf = opt.schlaf ?? schlafen;
  let letzter = "";
  for (let n = 0; n < versuche; n++) {
    const res = await abruf(url, { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await res.text();
    if (res.status >= 200 && res.status < 300) return (text ? JSON.parse(text) : {}) as T;
    letzter = ohneGeheimnis(text);
    const wiederholbar = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!wiederholbar || n === versuche - 1) throw new HttpFehler(res.status, dienst, letzter);
    const ra = Number(res.headers.get("retry-after"));
    await schlaf(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : basis * 2 ** n);
  }
  throw new HttpFehler(0, dienst, letzter);
}
