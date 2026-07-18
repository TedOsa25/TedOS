// Sprint 1.1 — Research Quality Gate.
//
// Deterministic tests for the Intelligence Layer. No AI, no network, no
// APIs: providers use mocked data and a fixed clock is injected so nothing
// depends on wall-clock time. These tests only IMPORT kernel modules
// (GoalEngine, GoalDiscoveryEngine, DeterministicImpactEngine,
// PriorityEngine) to prove integration — they never modify them.
//
// Run directly: `tsx src/research/research.test.ts` (node:test auto-runs and
// sets a non-zero exit code on failure).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { GoalEngine } from "../goal-engine.js";
import { GoalDiscoveryEngine } from "../goal-discovery-engine.js";
import { DeterministicImpactEngine } from "../impact.js";
import { PriorityEngine } from "../priority.js";
import { ResearchEngine } from "../research-engine.js";
import { loadResearchProviders } from "./providers.js";
import {
  parseGitHubRelease,
  parseNpmLatest,
  parseOsvVulns,
  parseReleaseFeed,
} from "./sources.js";
import type {
  GoalMetadata,
  ResearchCandidate,
  ResearchCategory,
  ResearchProvider,
} from "./types.js";

/** Fixed clock so metadata backfill is deterministic. */
const FIXED_NOW = "2026-06-24T00:00:00.000Z";
const clock = (): string => FIXED_NOW;

const VALID_KINDS = new Set(["bug", "feature", "improvement", "static"]);
const VALID_CATEGORIES = new Set<ResearchCategory>([
  "competitor",
  "ai-model",
  "framework",
  "dependency",
  "documentation",
  "security",
]);

/** Build a fresh, independent scoring pipeline for one test. */
const freshPipeline = () => ({
  engine: new GoalEngine(),
  impact: new DeterministicImpactEngine(),
  priority: new PriorityEngine(),
});

// src/research/ -> src/ -> package root (for the demo smoke test).
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ===========================================================================
// 1. ResearchProvider contract
// ===========================================================================

describe("1. ResearchProvider contract", () => {
  test("each mocked provider returns ResearchCandidate[]", async () => {
    const providers = await loadResearchProviders();
    assert.equal(providers.length, 6, "all six research providers load");

    for (const provider of providers) {
      const candidates = provider.discover();
      assert.ok(Array.isArray(candidates), `${provider.name}: discover() returns an array`);
      assert.ok(candidates.length > 0, `${provider.name}: returns at least one candidate`);
    }
  });

  test("each candidate has id, title, description, source, category, confidence, detectedAt, tags", async () => {
    const providers = await loadResearchProviders();

    for (const provider of providers) {
      for (const c of provider.discover()) {
        const where = `${provider.name}#${c.id}`;

        // Core candidate fields.
        assert.ok(typeof c.id === "string" && c.id.trim().length > 0, `${where}: id`);
        assert.ok(typeof c.title === "string" && c.title.trim().length > 0, `${where}: title`);
        assert.ok(
          typeof c.description === "string" && c.description.trim().length > 0,
          `${where}: description`,
        );
        assert.ok(VALID_KINDS.has(c.kind), `${where}: kind "${c.kind}"`);

        // Metadata fields.
        const m = c.metadata;
        assert.ok(typeof m.source === "string" && m.source.length > 0, `${where}: source`);
        assert.ok(VALID_CATEGORIES.has(m.category), `${where}: category "${m.category}"`);
        assert.equal(m.category, provider.category, `${where}: category matches provider`);
        assert.ok(
          typeof m.confidence === "number" && m.confidence >= 0 && m.confidence <= 1,
          `${where}: confidence in 0..1`,
        );
        assert.ok(
          typeof m.detectedAt === "string" && !Number.isNaN(Date.parse(m.detectedAt)),
          `${where}: detectedAt is an ISO date`,
        );
        assert.ok(Array.isArray(m.tags) && m.tags.length > 0, `${where}: tags non-empty`);
        assert.ok(
          m.tags.every((t) => typeof t === "string" && t.length > 0),
          `${where}: tags are non-empty strings`,
        );
      }
    }
  });
});

// ===========================================================================
// 2. ResearchEngine dedupe
// ===========================================================================

/** Emits duplicate ids (and a duplicate title) with differing metadata. */
class DuplicateProvider implements ResearchProvider {
  readonly name = "dup-test";
  readonly category: ResearchCategory = "dependency";

  discover(): ResearchCandidate[] {
    const meta = (source: string): GoalMetadata => ({
      source,
      category: "dependency",
      confidence: 0.5,
      detectedAt: "2026-06-20T00:00:00.000Z",
      tags: ["test"],
    });
    return [
      // First occurrence of dup-1 — this one must win.
      { id: "dup-1", title: "Same title", description: "first", kind: "improvement", metadata: meta("First") },
      // Same id, different metadata — collapsed; must NOT override the first.
      { id: "dup-1", title: "Same title", description: "second", kind: "improvement", metadata: meta("Second") },
      // Different id but duplicate title — collapsed by the kernel's title dedupe.
      { id: "dup-2", title: "Same title", description: "third", kind: "improvement", metadata: meta("Third") },
      // Genuinely unique.
      { id: "dup-3", title: "Unique title", description: "fourth", kind: "improvement", metadata: meta("Fourth") },
    ];
  }
}

describe("2. ResearchEngine dedupe", () => {
  test("duplicate candidate ids are collapsed", () => {
    const { engine, impact, priority } = freshPipeline();
    const run = new ResearchEngine([new DuplicateProvider()], engine, impact, priority, undefined, clock).research();

    assert.equal(run.summary.collected, 4, "collected all raw candidates");
    assert.equal(run.summary.unique, 2, "only dup-1 and dup-3 survive (id + title dedupe)");
    assert.equal(run.goals.length, 2, "scored backlog matches unique count");
  });

  test("first candidate wins; collapse only affects metadata, not identity", () => {
    const { engine, impact, priority } = freshPipeline();
    const run = new ResearchEngine([new DuplicateProvider()], engine, impact, priority, undefined, clock).research();

    const survivor = run.goals.find((g) => g.prioritized.scored.candidate.id === "dup-1");
    assert.ok(survivor, "dup-1 survived");
    assert.equal(survivor.metadata.source, "First", "the FIRST candidate's metadata wins");
  });
});

// ===========================================================================
// 3. Metadata enrichment
// ===========================================================================

/** Emits a candidate with a blank detectedAt so the clock must fill it in. */
class BlankClockProvider implements ResearchProvider {
  readonly name = "clock-test";
  readonly category: ResearchCategory = "security";

  discover(): ResearchCandidate[] {
    return [
      {
        id: "clk-1",
        title: "Needs a timestamp",
        description: "no detectedAt provided",
        kind: "bug",
        metadata: {
          source: "Clock Test",
          category: "security",
          confidence: 0.9,
          detectedAt: "", // intentionally blank -> engine backfills via clock
          tags: ["security"],
        },
      },
    ];
  }
}

describe("3. Metadata enrichment", () => {
  test("source/category/detectedAt/tags are guaranteed and present", async () => {
    const providers = await loadResearchProviders();
    const { engine, impact, priority } = freshPipeline();
    const run = new ResearchEngine(providers, engine, impact, priority, undefined, clock).research();

    for (const goal of run.goals) {
      const m = goal.metadata;
      const id = goal.prioritized.scored.candidate.id;
      assert.ok(m.source.length > 0, `${id}: source guaranteed`);
      assert.ok(VALID_CATEGORIES.has(m.category), `${id}: category guaranteed`);
      assert.ok(!Number.isNaN(Date.parse(m.detectedAt)), `${id}: detectedAt guaranteed`);
      assert.ok(m.tags.length > 0, `${id}: tags guaranteed`);
      assert.ok(m.tags.includes(m.category), `${id}: category folded into tags (enrichment)`);
    }
  });

  test("injected clock is used deterministically for a missing detectedAt", () => {
    const { engine, impact, priority } = freshPipeline();
    const run = new ResearchEngine([new BlankClockProvider()], engine, impact, priority, undefined, clock).research();

    assert.equal(run.goals.length, 1);
    const goal = run.goals[0];
    assert.ok(goal);
    assert.equal(goal.metadata.detectedAt, FIXED_NOW, "blank detectedAt backfilled from injected clock");
  });
});

// ===========================================================================
// 4. Kernel integration
// ===========================================================================

describe("4. Kernel integration", () => {
  test("a ResearchCandidate flows through GoalDiscoveryEngine unchanged", async () => {
    const providers = await loadResearchProviders();
    const { engine, impact, priority } = freshPipeline();

    // Drive the kernel's GoalDiscoveryEngine DIRECTLY with research providers
    // (ResearchCandidate is structurally a GoalCandidate).
    const run = new GoalDiscoveryEngine(providers, engine, impact, priority).run();

    assert.ok(run.scored.length > 0, "kernel scored the research candidates");
    assert.equal(run.summary.submitted, run.summary.unique, "all unique candidates submitted");
    assert.equal(engine.active().length, run.scored.length, "GoalEngine holds every scored goal");
  });

  test("ImpactEngine and PriorityEngine still work unchanged (deterministic)", () => {
    const impact = new DeterministicImpactEngine();
    const priority = new PriorityEngine();

    // A feature with no keyword triggers hits the base profile exactly:
    // value (8+7+8) - cost (6+7) = 10  ->  level P3.
    const candidate: ResearchCandidate = {
      id: "k-1",
      title: "Adopt new capability",
      description: "plain feature, no scoring keywords",
      kind: "feature",
      metadata: {
        source: "Test",
        category: "ai-model",
        confidence: 0.5,
        detectedAt: FIXED_NOW,
        tags: ["test"],
      },
    };

    const scored = impact.score(candidate);
    assert.equal(scored.overall, 10, "deterministic impact score unchanged");

    const prioritized = priority.prioritize(scored);
    assert.equal(prioritized.priority, 10, "priority equals impact");
    assert.equal(prioritized.level, "P3", "deterministic priority band unchanged");
  });
});

// ===========================================================================
// 6. Real source parsers (Phase 1) — deterministic, no network.
// ===========================================================================

describe("6. Real source parsers map upstream JSON to signals", () => {
  test("parseGitHubRelease maps a GitHub /releases/latest object", () => {
    const signal = parseGitHubRelease(
      { tag_name: "v16.0.0", name: "Next.js 16", published_at: "2026-06-15T12:00:00Z" },
      "next.js",
    );
    assert.deepEqual(signal, {
      framework: "next.js",
      version: "v16.0.0",
      highlight: "Next.js 16",
      publishedAt: "2026-06-15T12:00:00Z",
    });
    assert.equal(parseGitHubRelease({}, "x"), null, "missing tag_name -> null");
  });

  test("parseNpmLatest flags an outdated package and detects a major bump", () => {
    const doc = { "dist-tags": { latest: "7.0.0" }, time: { "7.0.0": "2026-06-01T00:00:00Z" } };
    const signal = parseNpmLatest(doc, "typescript", "6.0.3");
    assert.ok(signal);
    assert.equal(signal.latest, "7.0.0");
    assert.equal(signal.breaking, true, "6 -> 7 is a breaking major bump");
    // Up-to-date packages produce no signal.
    assert.equal(parseNpmLatest({ "dist-tags": { latest: "6.0.3" } }, "typescript", "6.0.3"), null);
  });

  test("parseOsvVulns maps advisories and defaults unknown severity", () => {
    const signals = parseOsvVulns(
      {
        vulns: [
          { id: "GHSA-aaaa", database_specific: { severity: "CRITICAL" }, modified: "2026-06-20T00:00:00Z" },
          { id: "GHSA-bbbb", published: "2026-06-19T00:00:00Z" }, // no severity -> moderate
          { summary: "no id" }, // dropped
        ],
      },
      "node-fetch",
    );
    assert.equal(signals.length, 2);
    assert.equal(signals[0]?.severity, "critical");
    assert.equal(signals[1]?.severity, "moderate");
    assert.equal(signals[0]?.package, "node-fetch");
  });

  test("parseReleaseFeed accepts arrays and {items}, with field fallbacks", () => {
    const fromArray = parseReleaseFeed(
      [{ model: "Claude Opus 4.8", capability: "1M context", date: "2026-06-18T00:00:00Z" }],
      "anthropic",
    );
    assert.equal(fromArray.length, 1);
    assert.equal(fromArray[0]?.vendor, "anthropic");

    const fromItems = parseReleaseFeed(
      { items: [{ title: "GPT-5.1", summary: "JSON mode" }] },
      "openai",
    );
    assert.equal(fromItems.length, 1);
    assert.equal(fromItems[0]?.model, "GPT-5.1");
    assert.equal(fromItems[0]?.capability, "JSON mode");
  });
});

// ===========================================================================
// 5. Demo smoke test
// ===========================================================================

describe("5. Demo smoke test", () => {
  test("npm run research exits successfully with ranked backlog and execution order", () => {
    const result = spawnSync("npm", ["run", "research"], {
      cwd: PKG_ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });

    assert.equal(result.status, 0, `demo exited non-zero:\n${result.stderr}`);

    const out = result.stdout;
    assert.match(out, /=== Selected execution order ===/, "output contains execution order");
    assert.match(out, /=== Final merged backlog \(by impact\) ===/, "output contains ranked backlog");
    assert.match(out, /Security: patch node-fetch/, "security advisory appears in ranked backlog");
  });
});
