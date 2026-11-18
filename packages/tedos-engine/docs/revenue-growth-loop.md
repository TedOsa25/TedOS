# Revenue Growth Loop

TedOS's top priority is **HeyCarbo's growth**, not code volume. Every watchdog asks one question per analysis:

> *"Which ONE change today brings the most additional revenue or qualified leads?"*

Business impact outranks engineering. Technical goals (performance/engineering/tests) are prioritized **only** when critical or a risk. This **reuses the existing watchdogs + prioritization** — no new watchdogs, no duplicate architecture.

## Priority order (growth levers)
`GROWTH_LEVERS` in [`goal-prioritization.ts`](../src/goal-prioritization.ts):
1. Revenue potential → 2. Lead generation → 3. Trial signups → 4. Demo bookings → 5. Supplier growth → 6. Organic reach → 7. SEO → 8. Retention.

This sits on top of the V1.2 weighting (Revenue 30 / Customer 25 / Growth 15 / Strategic 15 / EngHealth 10 / −Cost 5 / −Risk 10) and the category order (revenue → … → tests). `isTechnicalGoal()` marks perf/engineering/tests for deferral unless `criticalEngineering`.

## Engines = capabilities of existing watchdogs (no new watchdogs)
| Engine | Lives in | Does |
|--------|----------|------|
| **Content Engine** | Marketing Watchdog (14:00) + Content Watchdog (07:00) | daily LinkedIn/IG/blog/newsletter/video/ideas, Brand-Guardian-validated, approval-gated |
| **SEO Engine** | Growth Watchdog (13:00) | rankings/keywords/meta/schema/load → SEO GoalCandidates (e.g. `seo-coverage-public-pages`) |
| **Conversion Engine** | Growth + Revenue Watchdogs | CTA/landing/form-abandon/demo-trial/supplier-activation → improvement candidates |
| **Lead Engine** | Sales Watchdog (16:30) | score ICP fit (automotive/Maschinenbau/Chemie/Logistik/Verpackung/manufacturing), Scope-3 relevance, revenue potential → outreach candidates (reuses `Sales/` data) |
| **Outreach Engine** | Sales Watchdog | prepare personalized emails / LinkedIn msgs / follow-ups / call scripts / demo invites — **approval-gated drafts** (Gmail drafts where reachable); CTAs rotate; demo calendar embedded when configured |

## Revenue KPIs (Executive Report + Learning)
`REVENUE_KPIS`: demoBookings · trialSignups · qualifiedLeads · newSuppliers · newEnterpriseLeads · organicReach · conversionRate · revenuePotentialEur. After each campaign, metrics feed `analytics/` + `*-findings.json` and flow back into prioritization.

## Guardrails
Reuse existing watchdogs; never auto-publish/deploy/merge; never change compliance/CO₂/pricing/billing/security/migrations; no invented facts; no greenwashing; only verifiable claims. High-risk → Approval Queue. Mirrors `ai-os/BOOTSTRAP.md`.

## Known dependencies (gated on data/connectors)
Live values for SEO rankings (Search Console), CRM/Stripe revenue KPIs, and social/email **sending** require connectors/data not yet provisioned. Until then: candidates + approval-gated drafts; KPI **values** entered from available data or marked pending.
