// Business Impact prioritization for the Main Loop (TedOS V1.2).
//
// The Main Loop ranks GoalCandidates by business value, not by ease or lowest
// risk. Pure test goals are downgraded once technical stability is sufficient,
// so TedOS shifts its effort to revenue, customer value and growth instead of
// ever-more test coverage. Deterministic, no AI — mirrors the engine's existing
// scoring style (impact.ts / priority.ts / feedback.ts). The weights and the
// category order are configured centrally here; no watchdog hardcodes its own.

/** The work categories, in business-priority order (revenue first, tests last). */
export type GoalCategory =
  | "revenue"
  | "customer"
  | "growth"
  | "marketing"
  | "supplier"
  | "sales"
  | "ux"
  | "performance"
  | "engineering"
  | "tests";

/** Central, configurable weighting (V1.2). Positive weights add, cost/risk subtract. */
export const WEIGHTS = {
  revenueImpact: 0.3,
  customerValue: 0.25,
  growthPotential: 0.15,
  strategicValue: 0.15,
  engineeringHealth: 0.1,
  engineeringCost: -0.05,
  risk: -0.1,
} as const;

/** Priority order used as a deterministic tie-break (1 = highest). */
export const CATEGORY_RANK: Record<GoalCategory, number> = {
  revenue: 1,
  customer: 2,
  growth: 3,
  marketing: 4,
  supplier: 5,
  sales: 6,
  ux: 7,
  performance: 8,
  engineering: 9,
  tests: 10,
};

/** The seven scored dimensions (each 0–10). */
export interface BusinessDimensions {
  revenueImpact: number;
  customerValue: number;
  growthPotential: number;
  strategicValue: number;
  engineeringHealth: number;
  engineeringCost: number;
  risk: number;
}

export interface PrioritizableGoal {
  id: string;
  title: string;
  category: GoalCategory;
  dimensions: BusinessDimensions;
  /** Pure test goal — downgraded once stability is sufficient. */
  isTest?: boolean;
  /** Engineering goal that is a critical bug/regression/security/perf/customer/prod issue. */
  criticalEngineering?: boolean;
}

/** Technical-stability inputs that gate Product First Mode + the test downgrade. */
export interface StabilitySignal {
  typecheckGreen: boolean;
  buildGreen: boolean;
  noRegressions: boolean;
  healthScore: number; // 0–100
  coreTested: boolean;
}

/** Pure test goals keep this fraction of their score once stability is sufficient. */
export const TEST_DOWNGRADE = 0.3;
/** Non-critical engineering keeps this fraction in Product First Mode. */
export const ENGINEERING_DOWNGRADE = 0.7;

/** Weighted business score (higher = more valuable). */
export function businessScore(d: BusinessDimensions): number {
  return (
    WEIGHTS.revenueImpact * d.revenueImpact +
    WEIGHTS.customerValue * d.customerValue +
    WEIGHTS.growthPotential * d.growthPotential +
    WEIGHTS.strategicValue * d.strategicValue +
    WEIGHTS.engineeringHealth * d.engineeringHealth +
    WEIGHTS.engineeringCost * d.engineeringCost +
    WEIGHTS.risk * d.risk
  );
}

/**
 * Product First Mode: enough technical stability to invest the bulk of effort
 * in product value rather than additional test coverage.
 */
export function productFirstMode(s: StabilitySignal): boolean {
  return s.typecheckGreen && s.buildGreen && s.noRegressions && s.healthScore >= 90 && s.coreTested;
}

/**
 * "Stable enough" to downgrade pure test goals (the spec's test rule): typecheck
 * + build green, no regressions, core/critical areas tested. (Health ≥ 90 is the
 * stricter bar that additionally unlocks full Product First Mode.)
 */
function stableEnoughForTestDowngrade(s: StabilitySignal): boolean {
  return s.typecheckGreen && s.buildGreen && s.noRegressions && s.coreTested;
}

export interface RankedGoal {
  goal: PrioritizableGoal;
  /** Adjusted score used for ranking. */
  score: number;
  /** Raw business score before any mode adjustment. */
  baseScore: number;
  reason: string;
}

/**
 * Rank goals by business impact, applying V1.2 rules:
 *  - critical engineering keeps full priority always;
 *  - pure test goals are downgraded once stability is sufficient;
 *  - non-critical engineering is pushed behind product goals in Product First Mode;
 *  - ties break by category order (revenue → … → tests).
 */
export function prioritize(goals: PrioritizableGoal[], stability: StabilitySignal): RankedGoal[] {
  const pfm = productFirstMode(stability);
  const downgradeTests = stableEnoughForTestDowngrade(stability);

  const ranked: RankedGoal[] = goals.map((goal) => {
    const baseScore = businessScore(goal.dimensions);
    let score = baseScore;
    let reason = `business score ${baseScore.toFixed(2)}`;

    if (goal.criticalEngineering) {
      reason += "; critical engineering — full priority";
    } else if (goal.isTest && downgradeTests) {
      score = baseScore * TEST_DOWNGRADE;
      reason += `; test goal downgraded ×${TEST_DOWNGRADE} (stability sufficient)`;
    } else if (goal.category === "engineering" && pfm) {
      score = baseScore * ENGINEERING_DOWNGRADE;
      reason += `; non-critical engineering behind product goals (Product First Mode)`;
    }

    return { goal, score, baseScore, reason };
  });

  ranked.sort((a, b) => b.score - a.score || CATEGORY_RANK[a.goal.category] - CATEGORY_RANK[b.goal.category]);
  return ranked;
}
