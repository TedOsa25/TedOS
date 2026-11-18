// Learning demo.
//
// Runs one real (offline) Runtime pass over a few goals, then stores and
// prints the resulting execution outcomes. Reuses the kernel Runtime and the
// existing Storage layer; no kernel code is modified.

import type { Project } from "./types.js";
import { ActiveProject } from "./project.js";
import { Runtime } from "./runtime.js";
import { RuleBasedPolicyEngine } from "./policy.js";
import { ApprovalGate } from "./approval-gate.js";
import { createStorage } from "./storage.js";
import { OutcomeStore } from "./learning.js";

const PROJECT: Project = {
  name: "TedOS",
  repository: "tedos/tedos",
  path: process.cwd(),
  defaultWorker: "local",
  connectors: ["github"],
  goals: [
    { id: "demo-docs", title: "Document the readme", priority: 4 }, // SAFE -> executes (done)
    { id: "demo-upgrade", title: "Upgrade the react dependency", priority: 6 }, // APPROVAL -> awaiting
    { id: "demo-deploy", title: "Deploy to production", priority: 9 }, // FORBIDDEN -> blocked
  ],
};

async function main(): Promise<void> {
  const storage = createStorage();
  const outcomes = new OutcomeStore(storage, () => "2026-06-24T12:00:00.000Z");

  const active = new ActiveProject(PROJECT);
  const state = await new Runtime(active, new RuleBasedPolicyEngine(), new ApprovalGate(storage)).run();

  // Collect the outcomes of this run (measured duration is illustrative here).
  outcomes.recordRun(state.executions, 1234);

  console.log(`Stored ${outcomes.all().length} execution outcome(s):\n`);
  for (const o of outcomes.all()) {
    const verify = o.verification.skipped ? "skipped" : o.verification.passed ? "passed" : "failed";
    const review = o.review.approved ? "approved" : "rejected";
    console.log(
      `  ${o.goalId.padEnd(13)} status=${o.status.padEnd(18)} attempts=${o.attempts} ` +
        `verify=${verify.padEnd(8)} review=${review.padEnd(9)} runtime=${o.runtimeMs}ms @ ${o.timestamp}`,
    );
  }
}

void main();
