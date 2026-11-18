// Business Impact prioritization demo (V1.2). Shows how the Main Loop ranks a
// mixed backlog, and how pure test goals drop once stability is sufficient.

import { prioritize, productFirstMode, type PrioritizableGoal, type StabilitySignal } from "./goal-prioritization.js";

const BACKLOG: PrioritizableGoal[] = [
  { id: "trial-conversion", title: "Improve trial→paid conversion", category: "revenue", dimensions: { revenueImpact: 9, customerValue: 6, growthPotential: 6, strategicValue: 7, engineeringHealth: 2, engineeringCost: 5, risk: 4 } },
  { id: "supplier-activation", title: "Boost supplier activation", category: "supplier", dimensions: { revenueImpact: 6, customerValue: 7, growthPotential: 8, strategicValue: 8, engineeringHealth: 2, engineeringCost: 5, risk: 4 } },
  { id: "scope3-stale-bug", title: "Fix wrong Scope-3 totals (customer-facing)", category: "engineering", criticalEngineering: true, dimensions: { revenueImpact: 3, customerValue: 9, growthPotential: 1, strategicValue: 4, engineeringHealth: 7, engineeringCost: 3, risk: 3 } },
  { id: "more-util-tests", title: "Add more util regression tests", category: "tests", isTest: true, dimensions: { revenueImpact: 0, customerValue: 1, growthPotential: 0, strategicValue: 2, engineeringHealth: 9, engineeringCost: 2, risk: 1 } },
  { id: "dashboard-polish", title: "Dashboard UX polish", category: "ux", dimensions: { revenueImpact: 2, customerValue: 6, growthPotential: 3, strategicValue: 3, engineeringHealth: 3, engineeringCost: 3, risk: 2 } },
];

function show(label: string, stability: StabilitySignal): void {
  console.log(`\n${label}  (Product First Mode: ${productFirstMode(stability)})`);
  prioritize(BACKLOG, stability).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.goal.id.padEnd(20)} score=${r.score.toFixed(2).padStart(5)}  [${r.goal.category}] ${r.reason}`);
  });
}

show("Stability sufficient (health 78)", { typecheckGreen: true, buildGreen: true, noRegressions: true, healthScore: 78, coreTested: true });
show("Unstable (typecheck red)", { typecheckGreen: false, buildGreen: true, noRegressions: true, healthScore: 78, coreTested: true });
