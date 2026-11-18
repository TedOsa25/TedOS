// Intelligence Layer demo.
//
// Shows the full flow the sprint asks for, with ALL data mocked and no
// network, persistence, GitHub writes, or deployments:
//
//   GitHub goals  +  Research goals  ->  merged, scored, prioritized backlog
//   ->  the execution order the Goal Engine actually selects.
//
// Everything below the providers is the unmodified execution kernel:
// GoalDiscoveryEngine, DeterministicImpactEngine, PriorityEngine, GoalEngine.

import { GoalEngine } from "./goal-engine.js";
import { GoalDiscoveryEngine } from "./goal-discovery-engine.js";
import { DeterministicImpactEngine } from "./impact.js";
import { PriorityEngine } from "./priority.js";
import type { PrioritizedGoal } from "./priority.js";
import { GitHubIssueProvider } from "./github.js";
import { ResearchEngine } from "./research-engine.js";
import { loadResearchProviders } from "./research/providers.js";

/** One row of the merged backlog, used purely for display. */
interface BacklogRow {
  id: string;
  title: string;
  overall: number;
  level: string;
  source: string;
  category: string;
  confidence: number | null;
  detectedAt: string | null;
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));

function printScored(prefix: string, scored: PrioritizedGoal[]): void {
  for (const item of [...scored].sort((a, b) => b.scored.overall - a.scored.overall)) {
    console.log(
      `  ${prefix}[${item.level}] impact ${pad(String(item.scored.overall), 3)} ${item.scored.candidate.title}`,
    );
  }
}

async function main(): Promise<void> {
  // One shared scoring pipeline — the kernel, untouched.
  const engine = new GoalEngine();
  const impact = new DeterministicImpactEngine();
  const priority = new PriorityEngine();

  // Track impact + source + research metadata per goal id, for display only.
  const rows = new Map<string, BacklogRow>();

  // --- 1. GitHub goals (mocked issues; the real provider would fetch these) ---
  const githubProvider = new GitHubIssueProvider(
    [
      { number: 101, title: "Fix CSV export crash on empty rows", labels: [{ name: "bug" }] },
      { number: 102, title: "Add SSO login", labels: [{ name: "enhancement" }] },
      { number: 103, title: "Improve onboarding flow", labels: [] },
    ],
    "tedos/heycarbo",
  );
  const githubRun = new GoalDiscoveryEngine([githubProvider], engine, impact, priority).run();
  for (const p of githubRun.scored) {
    rows.set(p.scored.candidate.id, {
      id: p.scored.candidate.id,
      title: p.scored.candidate.title,
      overall: p.scored.overall,
      level: p.level,
      source: "GitHub Issues",
      category: "github",
      confidence: null,
      detectedAt: null,
    });
  }

  console.log("=== GitHub goals ===");
  printScored("", githubRun.scored);

  // --- 2. Research goals (six mocked intelligence providers) ---
  const providers = await loadResearchProviders();
  const research = new ResearchEngine(providers, engine, impact, priority).research();
  for (const g of research.goals) {
    const c = g.prioritized.scored;
    rows.set(c.candidate.id, {
      id: c.candidate.id,
      title: c.candidate.title,
      overall: c.overall,
      level: g.prioritized.level,
      source: g.metadata.source,
      category: g.metadata.category,
      confidence: g.metadata.confidence,
      detectedAt: g.metadata.detectedAt,
    });
  }

  // Show the Reasoner's accept/reject decision for every finding.
  console.log("\n=== Reasoner decisions ===");
  for (const d of research.decisions) {
    console.log(
      `  ${d.decision.verdict.toUpperCase().padEnd(6)} conf ${d.decision.confidence.toFixed(2)}  ${d.candidate.title}`,
    );
    console.log(`        ${d.decision.reason}`);
  }
  const rejected = research.decisions.filter((d) => d.decision.verdict === "reject");
  console.log(`  -> ${rejected.length} rejected finding(s) never enter the Goal Engine.`);

  console.log("\n=== Research goals (accepted only) ===");
  for (const g of [...research.goals].sort((a, b) => b.prioritized.scored.overall - a.prioritized.scored.overall)) {
    const c = g.prioritized.scored;
    const m = g.metadata;
    console.log(`  [${g.prioritized.level}] impact ${pad(String(c.overall), 3)} ${c.candidate.title}`);
    console.log(
      `        source=${m.source} | category=${m.category} | confidence=${m.confidence.toFixed(2)} | detected=${m.detectedAt}`,
    );
    console.log(`        tags=[${m.tags.join(", ")}]`);
  }

  console.log(
    `\n  Discovery summary — collected ${research.summary.collected}, unique ${research.summary.unique}, ` +
      `submitted ${research.summary.submitted}, rejected ${research.summary.rejected}`,
  );

  // --- 3. Final merged backlog (what the Goal Engine actually accepted) ---
  console.log("\n=== Final merged backlog (by impact) ===");
  const accepted = [...engine.active()].sort((a, b) => b.priority - a.priority);
  console.log(
    `  ${pad("PRIORITY", 9)} ${pad("IMPACT", 7)} ${pad("SOURCE", 22)} ${pad("CONF", 5)} TITLE`,
  );
  for (const goal of accepted) {
    const r = rows.get(goal.id);
    const lvl = r?.level ?? "?";
    const src = r?.source ?? "project";
    const cf = r?.confidence != null ? r.confidence.toFixed(2) : "—";
    console.log(`  ${pad(`${lvl}/${goal.priority}`, 9)} ${pad(String(goal.priority), 7)} ${pad(src, 22)} ${pad(cf, 5)} ${goal.title}`);
  }

  // --- 4. Selected execution order (drained straight from the Goal Engine) ---
  console.log("\n=== Selected execution order ===");
  let rank = 1;
  while (!engine.isEmpty()) {
    const next = engine.next();
    if (!next) break;
    const r = rows.get(next.id);
    console.log(`  ${rank}. ${next.title}  [impact ${next.priority}, ${r?.source ?? "project"}]`);
    engine.markInProgress(next.id); // advance so next() returns the following goal
    rank++;
  }
}

main();
