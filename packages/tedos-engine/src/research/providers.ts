// Research providers — the sources that feed the Intelligence Layer.
//
// Every provider follows the SAME shape the kernel's GitHubIssueProvider
// already established (see ../github.ts):
//
//   1. a raw "signal" type that mirrors the real upstream API response,
//   2. a synchronous provider class, constructed with pre-fetched signals,
//      that maps them to ResearchCandidates (satisfies GoalProvider),
//   3. an async `load…Provider()` factory that returns a provider.
//
// The factories are LIVE-WHEN-CONFIGURED: if the relevant env config is set
// they fetch real data from the upstream named in each doc comment (see
// sources.ts); otherwise they fall back to deterministic mock signals so the
// demo and tests run offline. Either way the signal shape and the provider
// class stay identical, so nothing downstream of the provider changes.
//
// Env config (all optional; unset -> mock):
//   TEDOS_RELEASE_REPOS  "owner/name,owner/name"   -> GitHub Releases
//   TEDOS_NPM_PACKAGES   "pkg@current,@scope/pkg@current" -> NPM + OSV
//   ANTHROPIC_RELEASES_URL / OPENAI_RELEASES_URL   -> model release feeds
//   GITHUB_TOKEN         optional, raises GitHub rate limits

import type { ResearchCandidate, ResearchProvider } from "./types.js";
import {
  fetchLatestRelease,
  fetchNpmLatest,
  fetchOsv,
  fetchReleaseFeed,
  npmName,
  parseList,
} from "./sources.js";

/** Clamp a confidence into the 0..1 range. */
const conf = (n: number): number => Math.max(0, Math.min(1, n));

// ---------------------------------------------------------------------------
// CompetitorProvider — competitor websites / public changelogs.
// Real source later: competitor changelog pages / RSS (one adapter per rival).
// ---------------------------------------------------------------------------

/** A feature a competitor shipped, as read from their changelog. */
export interface CompetitorSignal {
  competitor: string;
  feature: string;
  url: string;
  observedAt: string;
}

export class CompetitorProvider implements ResearchProvider {
  readonly name = "competitor";
  readonly category = "competitor" as const;

  constructor(private readonly signals: CompetitorSignal[]) {}

  discover(): ResearchCandidate[] {
    return this.signals.map((s, i) => ({
      id: `comp-${i + 1}`,
      title: `Match ${s.competitor}: ${s.feature}`,
      description: `${s.competitor} shipped "${s.feature}" (${s.url}). Evaluate building equivalent functionality to maintain parity.`,
      kind: "feature",
      metadata: {
        source: `Competitor: ${s.competitor}`,
        category: "competitor",
        confidence: conf(0.6),
        detectedAt: s.observedAt,
        tags: ["competitor", s.competitor.toLowerCase(), "parity"],
      },
    }));
  }
}

/** Returns a CompetitorProvider. Mocked now; swap for changelog adapters. */
export async function loadCompetitorProvider(): Promise<CompetitorProvider> {
  return new CompetitorProvider([
    {
      competitor: "Acme Analytics",
      feature: "one-click CSV → dashboard import",
      url: "https://acme.example/changelog#csv-import",
      observedAt: "2026-06-21T09:00:00Z",
    },
    {
      competitor: "CarbonRival",
      feature: "automated supplier emissions reminders",
      url: "https://carbonrival.example/whats-new",
      observedAt: "2026-06-22T14:30:00Z",
    },
  ]);
}

// ---------------------------------------------------------------------------
// AIModelProvider — Anthropic / OpenAI release notes.
// Real source later: Anthropic + OpenAI release-notes endpoints.
// ---------------------------------------------------------------------------

/** A newly released model capability worth adopting. */
export interface AIModelSignal {
  vendor: "anthropic" | "openai";
  model: string;
  capability: string;
  releasedAt: string;
}

export class AIModelProvider implements ResearchProvider {
  readonly name = "ai-model";
  readonly category = "ai-model" as const;

  constructor(private readonly signals: AIModelSignal[]) {}

  discover(): ResearchCandidate[] {
    return this.signals.map((s, i) => ({
      id: `aimodel-${i + 1}`,
      title: `Adopt ${s.model}: ${s.capability}`,
      description: `${s.model} (${s.vendor}) introduced ${s.capability}. Assess adopting it where it improves TedOS.`,
      kind: "improvement",
      metadata: {
        source: `${s.vendor === "anthropic" ? "Anthropic" : "OpenAI"} Release Notes`,
        category: "ai-model",
        confidence: conf(0.75),
        detectedAt: s.releasedAt,
        tags: ["ai-model", s.vendor, s.model.toLowerCase()],
      },
    }));
  }
}

/** Deterministic fallback used when no release feeds are configured. */
const MOCK_AIMODEL: AIModelSignal[] = [
  {
    vendor: "anthropic",
    model: "Claude Opus 4.8",
    capability: "1M-token context for whole-repo reasoning",
    releasedAt: "2026-06-18T17:00:00Z",
  },
  {
    vendor: "openai",
    model: "GPT-5.1",
    capability: "structured-output JSON mode for extraction",
    releasedAt: "2026-06-10T16:00:00Z",
  },
];

/**
 * Real source: Anthropic + OpenAI release-note feeds (configurable URLs).
 * Set ANTHROPIC_RELEASES_URL and/or OPENAI_RELEASES_URL to a JSON feed;
 * unset -> mock signals.
 */
export async function loadAIModelProvider(): Promise<AIModelProvider> {
  const anthropic = process.env.ANTHROPIC_RELEASES_URL;
  const openai = process.env.OPENAI_RELEASES_URL;
  if (!anthropic && !openai) return new AIModelProvider(MOCK_AIMODEL);

  const signals = [
    ...(anthropic ? await fetchReleaseFeed(anthropic, "anthropic") : []),
    ...(openai ? await fetchReleaseFeed(openai, "openai") : []),
  ];
  return new AIModelProvider(signals);
}

// ---------------------------------------------------------------------------
// FrameworkProvider — framework GitHub Releases (Next.js, React, …).
// Real source later: GitHub Releases API per watched framework repo.
// ---------------------------------------------------------------------------

/** A framework release worth upgrading to. */
export interface FrameworkSignal {
  framework: string;
  version: string;
  highlight: string;
  publishedAt: string;
}

export class FrameworkProvider implements ResearchProvider {
  readonly name = "framework";
  readonly category = "framework" as const;

  constructor(private readonly signals: FrameworkSignal[]) {}

  discover(): ResearchCandidate[] {
    return this.signals.map((s, i) => ({
      id: `fw-${i + 1}`,
      title: `Upgrade ${s.framework} to ${s.version} (${s.highlight})`,
      description: `${s.framework} ${s.version} is available (${s.highlight}). Plan an upgrade and run a migration check.`,
      kind: "improvement",
      metadata: {
        source: "GitHub Releases",
        category: "framework",
        confidence: conf(0.7),
        detectedAt: s.publishedAt,
        tags: ["framework", s.framework.toLowerCase(), s.version],
      },
    }));
  }
}

/** Deterministic fallback used when no watched repos are configured. */
const MOCK_FRAMEWORK: FrameworkSignal[] = [
  {
    framework: "Next.js",
    version: "16.0",
    highlight: "stable partial prerendering",
    publishedAt: "2026-06-15T12:00:00Z",
  },
  {
    framework: "React",
    version: "20.0",
    highlight: "first-class server actions",
    publishedAt: "2026-06-05T12:00:00Z",
  },
];

/**
 * Real source: GitHub Releases API per watched repo.
 * Set TEDOS_RELEASE_REPOS="owner/name,owner/name"; unset -> mock signals.
 */
export async function loadFrameworkProvider(): Promise<FrameworkProvider> {
  const repos = parseList(process.env.TEDOS_RELEASE_REPOS);
  if (repos.length === 0) return new FrameworkProvider(MOCK_FRAMEWORK);

  const results = await Promise.all(repos.map(fetchLatestRelease));
  const signals = results.filter((s): s is FrameworkSignal => s !== null);
  return new FrameworkProvider(signals);
}

// ---------------------------------------------------------------------------
// DependencyProvider — outdated npm packages.
// Real source later: NPM Registry API (compare installed vs latest).
// ---------------------------------------------------------------------------

/** A dependency that has a newer version available. */
export interface DependencySignal {
  package: string;
  current: string;
  latest: string;
  breaking: boolean;
  publishedAt: string;
}

export class DependencyProvider implements ResearchProvider {
  readonly name = "dependency";
  readonly category = "dependency" as const;

  constructor(private readonly signals: DependencySignal[]) {}

  discover(): ResearchCandidate[] {
    return this.signals.map((s, i) => ({
      id: `dep-${i + 1}`,
      title: `Bump ${s.package} ${s.current} → ${s.latest}${s.breaking ? " (breaking)" : ""}`,
      description: `${s.package} can move from ${s.current} to ${s.latest}${s.breaking ? " with breaking changes" : ""}. Review the changelog and bump.`,
      kind: "improvement",
      metadata: {
        source: "NPM Registry",
        category: "dependency",
        confidence: conf(s.breaking ? 0.5 : 0.65),
        detectedAt: s.publishedAt,
        tags: ["dependency", s.package, s.breaking ? "breaking" : "minor"],
      },
    }));
  }
}

/** Deterministic fallback used when no packages are configured. */
const MOCK_DEPENDENCY: DependencySignal[] = [
  {
    package: "typescript",
    current: "6.0.3",
    latest: "6.1.0",
    breaking: false,
    publishedAt: "2026-06-20T08:00:00Z",
  },
  {
    package: "@anthropic-ai/sdk",
    current: "0.105.0",
    latest: "0.110.0",
    breaking: false,
    publishedAt: "2026-06-19T08:00:00Z",
  },
];

/**
 * Real source: NPM Registry (compare each pinned package to dist-tags.latest).
 * Set TEDOS_NPM_PACKAGES="pkg@current,@scope/pkg@current"; unset -> mock.
 * Up-to-date packages produce no signal.
 */
export async function loadDependencyProvider(): Promise<DependencyProvider> {
  const specs = parseList(process.env.TEDOS_NPM_PACKAGES);
  if (specs.length === 0) return new DependencyProvider(MOCK_DEPENDENCY);

  const results = await Promise.all(specs.map(fetchNpmLatest));
  const signals = results.filter((s): s is DependencySignal => s !== null);
  return new DependencyProvider(signals);
}

// ---------------------------------------------------------------------------
// DocumentationProvider — documentation drift / updates.
// Real source later: docs-site change feed or doc-coverage scan.
// ---------------------------------------------------------------------------

/** A documentation gap or stale page worth addressing. */
export interface DocumentationSignal {
  area: string;
  issue: string;
  detectedAt: string;
}

export class DocumentationProvider implements ResearchProvider {
  readonly name = "documentation";
  readonly category = "documentation" as const;

  constructor(private readonly signals: DocumentationSignal[]) {}

  discover(): ResearchCandidate[] {
    return this.signals.map((s, i) => ({
      id: `doc-${i + 1}`,
      title: `Docs: ${s.issue} (${s.area})`,
      description: `Documentation gap in ${s.area}: ${s.issue}. Update the affected docs.`,
      kind: "static",
      metadata: {
        source: "Documentation Updates",
        category: "documentation",
        confidence: conf(0.55),
        detectedAt: s.detectedAt,
        tags: ["documentation", s.area.toLowerCase()],
      },
    }));
  }
}

/** Returns a DocumentationProvider. Mocked now; swap for a docs change feed. */
export async function loadDocumentationProvider(): Promise<DocumentationProvider> {
  return new DocumentationProvider([
    {
      area: "onboarding",
      issue: "setup guide missing env-var reference",
      detectedAt: "2026-06-17T10:00:00Z",
    },
  ]);
}

// ---------------------------------------------------------------------------
// SecurityProvider — security advisories.
// Real source later: GitHub Security Advisories (GHSA) / OSV feed.
// ---------------------------------------------------------------------------

/** A published security advisory affecting a dependency. */
export interface SecuritySignal {
  advisory: string;
  package: string;
  severity: "low" | "moderate" | "high" | "critical";
  publishedAt: string;
}

export class SecurityProvider implements ResearchProvider {
  readonly name = "security";
  readonly category = "security" as const;

  constructor(private readonly signals: SecuritySignal[]) {}

  discover(): ResearchCandidate[] {
    return this.signals.map((s, i) => ({
      id: `sec-${i + 1}`,
      title: `Security: patch ${s.package} (${s.severity}, ${s.advisory})`,
      description: `${s.severity} severity advisory ${s.advisory} affects ${s.package}. Patch to a fixed version.`,
      kind: "bug",
      metadata: {
        source: "Security Advisories",
        category: "security",
        // Severity drives confidence — critical advisories are near-certain work.
        confidence: conf({ low: 0.6, moderate: 0.75, high: 0.9, critical: 0.98 }[s.severity]),
        detectedAt: s.publishedAt,
        tags: ["security", s.severity, s.package],
      },
    }));
  }
}

/** Deterministic fallback used when no packages are configured. */
const MOCK_SECURITY: SecuritySignal[] = [
  {
    advisory: "GHSA-xxxx-mock-0001",
    package: "node-fetch",
    severity: "high",
    publishedAt: "2026-06-23T06:00:00Z",
  },
];

/**
 * Real source: OSV (api.osv.dev) queried per configured npm package — covers
 * GitHub Security Advisories via OSV's aggregation. Reuses TEDOS_NPM_PACKAGES;
 * unset -> mock. Packages with no advisories produce no signal.
 */
export async function loadSecurityProvider(): Promise<SecurityProvider> {
  const specs = parseList(process.env.TEDOS_NPM_PACKAGES);
  if (specs.length === 0) return new SecurityProvider(MOCK_SECURITY);

  const lists = await Promise.all(specs.map((spec) => fetchOsv(npmName(spec))));
  return new SecurityProvider(lists.flat());
}

/** Load every research provider. Each is independently swappable for a real source. */
export async function loadResearchProviders(): Promise<ResearchProvider[]> {
  return Promise.all([
    loadCompetitorProvider(),
    loadAIModelProvider(),
    loadFrameworkProvider(),
    loadDependencyProvider(),
    loadDocumentationProvider(),
    loadSecurityProvider(),
  ]);
}
