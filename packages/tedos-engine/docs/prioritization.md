# Business Impact Prioritization (TedOS V1.2)

The Main Loop ranks GoalCandidates by **business value** — not by ease or lowest risk. Implemented in [`src/goal-prioritization.ts`](../src/goal-prioritization.ts) (validated by `goal-prioritization.test.ts`, viewable via `npm run prioritize`). Weights and category order are configured **centrally** there; no watchdog hardcodes its own.

## Weighting

| Dimension | Weight |
|-----------|--------|
| Revenue Impact | +30% |
| Customer Value | +25% |
| Growth Potential | +15% |
| Strategic Value | +15% |
| Engineering Health | +10% |
| Engineering Cost | −5% |
| Risk | −10% |

`businessScore = Σ weightᵢ · dimensionᵢ` (each dimension 0–10). Highest total wins.

## Category order (tie-break)

Revenue → Customer → Growth → Marketing → Supplier → Sales → UX → Performance → Engineering → Tests.

## Test-goal downgrade

Pure test goals stay important but must not permanently dominate. When **typecheck green · build green · no regressions · core/critical areas tested**, pure test goals are downgraded (×0.3) so product goals lead.

## Product First Mode

When additionally **Health Score ≥ 90**, TedOS enters **Product First Mode** and prioritizes Growth · Marketing · Sales · Supplier · Revenue · Customer Success · AI · UX ahead of further test sprints. Non-critical engineering is pushed behind product goals (×0.7).

## Engineering goals

Auto-prioritized at full weight only when **critical**: bug · regression · security · performance · customer impact · production error. Otherwise sorted behind product goals.

## Executive Override

The Orchestrator Watchdog may raise a goal's priority at any time when a market opportunity, customer problem, revenue opportunity, or regulatory change outweighs further tests.

> Mirrors the operating policy in `ai-os/BOOTSTRAP.md` (single source of truth). The Main Loop applies this ranking before selecting the single goal to execute.
