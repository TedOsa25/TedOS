// Feedback demo.
//
// Shows the FeedbackEngine using real Learning data (an OutcomeStore) to
// adjust Impact before goals are submitted. Three goals each carry a different
// history; we print the baseline impact, the feedback signal, and the adjusted
// impact, then run the discovery pipeline to show the submitted priorities.
//
// Deterministic and offline. Reuses the kernel-free Impact/Priority/Discovery
// pieces and the Learning OutcomeStore; no kernel code is modified.

import type { GoalCandidate, GoalProvider } from "./types.js";
import { DeterministicImpactEngine } from "./impact.js";
import { PriorityEngine } from "./priority.js";
import { GoalEngine } from "./goal-engine.js";
import { GoalDiscoveryEngine } from "./goal-discovery-engine.js";
import { InMemoryStorage } from "./storage.js";
import { OutcomeStore } from "./learning.js";
import { FeedbackEngine } from "./feedback.js";

const fixedClock = () => "2026-06-24T12:00:00.000Z";

const CANDIDATES: GoalCandidate[] = [
  { id: "checkout-fix", title: "Fix checkout payment bug", kind: "bug" },
  { id: "flaky-deploy", title: "Stabilise the deploy pipeline", kind: "improvement" },
  { id: "risky-migration", title: "Run the database migration", kind: "feature" },
];

function seedHistory(store: OutcomeStore): void {
  // checkout-fix: repeatedly succeeded -> confidence should rise.
  store.recordRun(
    [
      { id: "checkout-fix", title: "", priority: 0, status: "done", attempts: 1, tasks: [],
        verification: { passed: true, skipped: false, steps: [] },
        policy: { level: "SAFE", reason: "" }, review: { approved: true, reason: "ok" } },
    ],
    100,
  );
  store.recordRun(
    [
      { id: "checkout-fix", title: "", priority: 0, status: "done", attempts: 1, tasks: [],
        verification: { passed: true, skipped: false, steps: [] },
        policy: { level: "SAFE", reason: "" }, review: { approved: true, reason: "ok" } },
    ],
    100,
  );

  // flaky-deploy: repeatedly failed -> confidence should drop.
  store.recordRun(
    [
      { id: "flaky-deploy", title: "", priority: 0, status: "failed", attempts: 2, tasks: [],
        verification: { passed: false, skipped: false, steps: [] },
        policy: { level: "SAFE", reason: "" }, review: { approved: false, reason: "checks failed" } },
      { id: "flaky-deploy", title: "", priority: 0, status: "failed", attempts: 2, tasks: [],
        verification: { passed: false, skipped: false, steps: [] },
        policy: { level: "SAFE", reason: "" }, review: { approved: false, reason: "checks failed" } },
    ],
    100,
  );

  // risky-migration: rejected (blocked / not approved) -> priority should drop.
  store.recordRun(
    [
      { id: "risky-migration", title: "", priority: 0, status: "awaiting_approval", attempts: 0, tasks: [],
        verification: { passed: false, skipped: true, steps: [] },
        policy: { level: "APPROVAL_REQUIRED", reason: "" }, review: { approved: false, reason: "needs approval" } },
    ],
    100,
  );
}

function main(): void {
  const store = new OutcomeStore(new InMemoryStorage(), fixedClock);
  seedHistory(store);

  const base = new DeterministicImpactEngine();
  const feedback = new FeedbackEngine(base, store);

  console.log("Feedback adjustments from Learning data:\n");
  for (const c of CANDIDATES) {
    const before = base.score(c).overall;
    const signal = feedback.signal(c.id);
    const after = feedback.score(c).overall;
    const arrow = after > before ? "up" : after < before ? "down" : "flat";
    console.log(
      `  ${c.id.padEnd(16)} impact ${String(before).padStart(3)} -> ${String(after).padStart(3)} (${arrow.padEnd(4)}) ` +
        `[${signal.successes} done, ${signal.failures} failed, ${signal.rejections} rejected]`,
    );
  }

  // Run the discovery pipeline with feedback wired into the Impact seam.
  const provider: GoalProvider = { name: "demo", discover: () => CANDIDATES };
  const engine = new GoalEngine();
  new GoalDiscoveryEngine([provider], engine, feedback, new PriorityEngine()).run();

  console.log("\nSubmitted backlog (highest priority first):");
  let g = engine.next();
  const seen = new Set<string>();
  while (g && !seen.has(g.id)) {
    seen.add(g.id);
    console.log(`  ${g.id.padEnd(16)} priority=${g.priority}`);
    engine.markInProgress(g.id);
    g = engine.next();
  }
}

main();
