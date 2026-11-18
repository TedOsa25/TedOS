// Real upstream sources for the research providers.
//
// Each source has two parts:
//   • a pure `parse…` function (unknown JSON -> signal[]), unit-testable
//     with no network, fully deterministic.
//   • a `fetch…` function that calls the real endpoint via the built-in
//     global fetch, then delegates to the parser. On any failure it warns
//     and returns an empty/neutral result so the pipeline never throws.
//
// The signal SHAPES are the existing ones from providers.ts (imported as
// types only, erased at runtime — no circular dependency). Nothing here
// changes the ResearchProvider interface or any downstream component.

import type {
  AIModelSignal,
  DependencySignal,
  FrameworkSignal,
  SecuritySignal,
} from "./providers.js";

/** Per-request timeout so a slow endpoint can't stall the loop. */
const REQUEST_TIMEOUT_MS = 8000;

// --- tiny defensive accessors (no any, strict-mode safe) -------------------

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The leading numeric segment of a version, or NaN. */
const majorOf = (version: string): number =>
  Number.parseInt(version.replace(/^[^\d]*/, "").split(".")[0] ?? "", 10);

/** Split a comma/space list env value into trimmed, non-empty entries. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Extract the package name from a "name@current" spec (scope-safe). */
export function npmName(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/** Extract the "current" version from a "name@current" spec, or "". */
function npmCurrent(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(at + 1) : "";
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "User-Agent": "tedos-engine", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// === GitHub Releases =======================================================
// GET https://api.github.com/repos/{owner}/{repo}/releases/latest

/** Parse one GitHub "latest release" object for a watched framework. */
export function parseGitHubRelease(raw: unknown, framework: string): FrameworkSignal | null {
  const r = asRecord(raw);
  if (!r) return null;
  const version = asString(r["tag_name"]);
  if (!version) return null;
  const highlight = asString(r["name"]) ?? version;
  const publishedAt = asString(r["published_at"]) ?? "";
  return { framework, version, highlight, publishedAt };
}

export async function fetchLatestRelease(repo: string): Promise<FrameworkSignal | null> {
  const framework = repo.split("/")[1] ?? repo;
  const token = process.env.GITHUB_TOKEN;
  try {
    const raw = await getJson(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    return parseGitHubRelease(raw, framework);
  } catch (err) {
    console.warn(`GitHub Releases read failed for ${repo}: ${String(err)}`);
    return null;
  }
}

// === NPM Registry ==========================================================
// GET https://registry.npmjs.org/{package}

/** Build a dependency signal from a registry document, given the current pin. */
export function parseNpmLatest(raw: unknown, pkg: string, current: string): DependencySignal | null {
  const r = asRecord(raw);
  if (!r) return null;
  const latest = asString(asRecord(r["dist-tags"])?.["latest"]);
  if (!latest) return null;
  if (current && latest === current) return null; // already up to date — no work
  const publishedAt = asString(asRecord(r["time"])?.[latest]) ?? "";
  const breaking = Number.isFinite(majorOf(current)) && majorOf(latest) !== majorOf(current);
  return { package: pkg, current: current || "?", latest, breaking, publishedAt };
}

export async function fetchNpmLatest(spec: string): Promise<DependencySignal | null> {
  const pkg = npmName(spec);
  const current = npmCurrent(spec);
  try {
    const raw = await getJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
    return parseNpmLatest(raw, pkg, current);
  } catch (err) {
    console.warn(`NPM Registry read failed for ${pkg}: ${String(err)}`);
    return null;
  }
}

// === OSV / GitHub Security Advisories ======================================
// POST https://api.osv.dev/v1/query  { package: { ecosystem: "npm", name } }

const SEVERITIES = new Set<SecuritySignal["severity"]>(["low", "moderate", "high", "critical"]);

function osvSeverity(vuln: Record<string, unknown>): SecuritySignal["severity"] {
  const raw = asString(asRecord(vuln["database_specific"])?.["severity"])?.toLowerCase();
  return raw && SEVERITIES.has(raw as SecuritySignal["severity"])
    ? (raw as SecuritySignal["severity"])
    : "moderate";
}

/** Parse an OSV query response into security signals for one package. */
export function parseOsvVulns(raw: unknown, pkg: string): SecuritySignal[] {
  const r = asRecord(raw);
  if (!r) return [];
  const signals: SecuritySignal[] = [];
  for (const entry of asArray(r["vulns"])) {
    const v = asRecord(entry);
    if (!v) continue;
    const advisory = asString(v["id"]);
    if (!advisory) continue;
    signals.push({
      advisory,
      package: pkg,
      severity: osvSeverity(v),
      publishedAt: asString(v["modified"]) ?? asString(v["published"]) ?? "",
    });
  }
  return signals;
}

export async function fetchOsv(pkg: string): Promise<SecuritySignal[]> {
  try {
    const raw = await getJson("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { ecosystem: "npm", name: pkg } }),
    });
    return parseOsvVulns(raw, pkg);
  } catch (err) {
    console.warn(`OSV read failed for ${pkg}: ${String(err)}`);
    return [];
  }
}

// === Release-note feeds (Anthropic / OpenAI) ===============================
// No official API exists; this reads a configurable JSON feed of the form
// [{ model|title, capability|summary, date }] so it can point at an RSS->JSON
// proxy or a docs endpoint without committing to a fragile HTML scrape.

export function parseReleaseFeed(raw: unknown, vendor: AIModelSignal["vendor"]): AIModelSignal[] {
  const top = asRecord(raw);
  const items = Array.isArray(raw)
    ? raw
    : asArray(top?.["items"] ?? top?.["releases"] ?? top?.["entries"]);
  const signals: AIModelSignal[] = [];
  for (const entry of items) {
    const i = asRecord(entry);
    if (!i) continue;
    const model = asString(i["model"]) ?? asString(i["title"]);
    if (!model) continue;
    const capability =
      asString(i["capability"]) ?? asString(i["summary"]) ?? asString(i["description"]) ?? model;
    const releasedAt =
      asString(i["date"]) ?? asString(i["releasedAt"]) ?? asString(i["published_at"]) ?? "";
    signals.push({ vendor, model, capability, releasedAt });
  }
  return signals;
}

export async function fetchReleaseFeed(
  url: string,
  vendor: AIModelSignal["vendor"],
): Promise<AIModelSignal[]> {
  try {
    return parseReleaseFeed(await getJson(url), vendor);
  } catch (err) {
    console.warn(`${vendor} release feed read failed: ${String(err)}`);
    return [];
  }
}
