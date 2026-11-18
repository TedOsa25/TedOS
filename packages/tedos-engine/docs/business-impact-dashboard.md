# Business Impact Dashboard & Outcome Learning (Phases 5–6)

TedOS's **primary decision surface**. It closes the evidence loop: every completed Goal is measured, the measurement becomes the Executive Report's dashboard, and the same measurements steer what gets built next. Additive — no kernel change, no new stores, no duplicate architecture.

## Phase 5 — Business Impact Dashboard (`business-dashboard.ts`)
Pure aggregation over the **existing** outcome stores (`AttributionStore`, `OutcomeLearningStore`). `buildDashboard(attributions, learnings, now?)` → a `BusinessImpactDashboard`; `renderDashboard(d)` → the Executive-Report text block emitted by the loop at run end (`TedosLoop.dashboard()` exposes it on demand). Run the demo: `npm run dashboard`.

Surfaces the sprint's items:
- **Top Goals (7d / 30d)** — windowed by `implementedAt`, ranked measured-first then by business movement, then ROI.
- **Highest / Lowest ROI** — over goals with **measured** (live-data) outcomes only; `null` when none.
- **Most / Least Successful Watchdog** — accuracy (successes ÷ decided) then avg ROI, from *decided* learnings only (`unknown` source and undecided verdicts ignored).
- **Business KPIs** — per business area, each row carries **Source · Timestamp (Stand) · Confidence · Trend · Δ**:
  | KPI | Area | Source (from KPI catalogue) |
  |---|---|---|
  | Revenue Generated | revenue | Stripe |
  | Leads Generated | sales | CRM |
  | Conversion Improvement | product | GA4 |
  | Supplier Activation | supplier | Supabase |
  | Organic / Traffic Improvement | marketing | Search Console |
  | Customer Success | customerSuccess | Supabase |
- **Confidence Level** — `high` iff any KPI is backed by live data, else `low`.

**No fabrication:** an area with no live reading shows Δ 0 / `flat` / confidence `low`, never an invented number. With zero data sources configured (today's state — see `connector-audit.md`), the dashboard renders honestly as all-hypothesis.

## Phase 6 — Business Outcome Learning → Prioritization (`outcome-prioritization.ts`)
`OutcomeFeedbackEngine` is a second `ImpactScorer` decorator in the **same seam** as `FeedbackEngine`. The loop now stacks them:

```
OutcomeFeedbackEngine( FeedbackEngine( DeterministicImpactEngine, outcomes ), { attributions, learnings } )
```

- `FeedbackEngine` adjusts a goal by its own **execution** history (done/failed/rejected).
- `OutcomeFeedbackEngine` adjusts a candidate by the **business outcomes** that real, measured goals in the **same business areas** produced:
  - realized **per-area movement** (`areaImpacts`, weight `0.2`/%),
  - realized **ROI** vs expectation (weight `1.0`),
  - the proposing **watchdog's historical accuracy** when a `sourceOf(candidate)` hook is supplied (weight `2.0`, centered at 0.5).
- Bounded to ±`MAX_OUTCOME_ADJUSTMENT` (4) so evidence nudges, never dominates. **Pass-through** when no live-measured evidence exists, so prioritization never degrades on assumptions.

Each completed Goal writes a new attribution+learning, shifting the area averages — so prioritization improves continuously. This is the shift from rule-based to self-learning prioritization: estimated impact is the prior; realized outcomes are the correction.

## Data plumbing added (additive)
- `business-impact.ts`: `impactByArea(readings)` + `primarySourceForArea(area)`.
- `goal-attribution.ts`: optional `areaImpacts?` on `GoalAttribution`.
- `outcome-engine.ts`: populates `areaImpacts` from the readings it already computes.

## Known limitation
Per-**candidate** watchdog attribution requires the proposing source on the `GoalCandidate` (a kernel type), which is out of this additive scope — so today the watchdog-accuracy term is active only when a caller passes `sourceOf`. Area-level ROI/impact learning is always active. See "Remaining gaps".
