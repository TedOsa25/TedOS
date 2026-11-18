# Evidence Engine

TedOS decides on **real product data**, not guesses. Before any analysis, a watchdog asks: *"are live data available?"* — answered by [`evidence.ts`](../src/evidence.ts) (`npm run evidence`). If yes → use it (confidence **high**). If no → the analysis is explicitly marked **hypothesis-based** (confidence **low**) and a concrete missing-data checklist is produced.

## Data sources (reuses existing connector env; no duplicate integrations)
Google Search Console · GA4 · Stripe · CRM · Supabase · LinkedIn · Instagram · Gmail. Each is "available" only when **all** its env vars are set; setup steps live in [`connectors-setup.md`](./connectors-setup.md). `evidence.ts` only **detects availability** — it does not build integrations.

## API
- `dataSourceStatus()` → availability + confidence per source.
- `isAvailable(source)` / `hasAnyLiveData()`.
- `missingDataChecklist()` → exact source + env vars to set.
- `tagKpi(kpi, source)` → `{ source, freshness, confidence }`; hypotheses get `source:"none", freshness:"n/a (hypothesis)", confidence:"low"`.

## Executive Report
Every KPI now carries **Source · Freshness · Confidence**, e.g.:
- `Organic Traffic — Source: Google Search Console · Stand: gestern · Confidence: High`
- `Landingpage Conversion — Source: none · Confidence: Low (hypothesis)`

## Prioritization
GoalCandidates are ranked on evidence where available (traffic/conversion/leads/trial/demo/supplier/revenue/feedback). Where data is missing, candidates are flagged low-confidence so they aren't over-prioritized on assumptions.

## Learning
Each watchdog records which assumptions held vs. were corrected once live data arrived, improving future prioritization. (Today: **all sources unavailable → every analysis is hypothesis-based**; provisioning GSC + GA4 first yields the biggest confidence lift.)

## Status (2026-06-25)
`npm run evidence` → **0 of 8 sources available**. All current findings are hypothesis-based by definition. The single highest-leverage unblock is provisioning the connectors in `connectors-setup.md`.
