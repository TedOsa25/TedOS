# Connector Audit Report — Evidence Engine V1, Phase 1

**Date:** 2026-06-26
**Scope:** All external data-source integrations across the TedOS monorepo, to satisfy the sprint's "audit before build / reuse first / never duplicate connectors" guardrail.
**Method:** Static read of `ai-os/packages/tedos-engine/src`, `ai-os`, and `HeyCarbo`; dependency inspection; no network calls; nothing modified.

## Executive summary

The Intelligence Layer already has a complete, deterministic connector layer. **No duplicate connectors are needed and none were created.** Every "connector" in `tedos-engine` is, by design, a read-only **status/availability reporter** keyed off environment variables — it never makes a network call and never prints secrets (see `connectors.ts`, `evidence.ts`). The only real external SDK anywhere in the repo is `@supabase/supabase-js`, used by the **product** (HeyCarbo), not by the engine.

This is the correct architecture for the Evidence Layer: the engine **detects** whether a source is live and tags every KPI with source + confidence; it does **not** re-implement integrations. Real data ingestion is unblocked purely by provisioning credentials per `docs/connectors-setup.md`.

## Per-source audit

| Source | Where it's handled | Type | Env vars | Status |
|---|---|---|---|---|
| **Google Search Console** | `evidence.ts` `DATA_SOURCES`; `business-impact.ts` (organic traffic, impressions, CTR, rankings, keywords) | Env-detection only | `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` | Not configured · no SDK · setup doc'd |
| **Google Analytics 4** | Engine: `evidence.ts`; `business-impact.ts` (trial signups, activation, TTFV). Product: `frontend/src/utils/analytics.ts` | Engine: env-detection. Product: client-side gtag hook only (no backend GA4 Data API / service-account integration) | `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON` | Backend not configured. Client-side event hooks exist but don't feed the engine |
| **Stripe** | Engine: `evidence.ts`; `business-impact.ts` (MRR, ARR, new customers). **Product: real client** — HeyCarbo edge functions `create-checkout-session`, `stripe-webhook`, `stripe-customer-portal` | Engine: env-detection. **Product: live Stripe API calls** | `STRIPE_SECRET_KEY` (`_PRICE_STARTER/_PRO`, `_WEBHOOK_SECRET`) | Real integration exists in HeyCarbo → cheapest near-term live **revenue** source |
| **CRM** | `evidence.ts`; `business-impact.ts` (pipeline, leads, demos, win rate) | Env-detection only | `CRM_API_KEY` (`CRM_API_BASE`) | Not configured. `/Sales` exports exist as a possible source |
| **Supabase** | `connectors.ts` `SupabaseConnector` + `evidence.ts`; product uses it for real | Engine: env-detection. **Product: real client** (`@supabase/supabase-js` ^2.95.3 in HeyCarbo frontend + edge functions) | `SUPABASE_URL`, `SUPABASE_KEY` | Real integration exists in HeyCarbo → richest near-term live source for product/supplier/CS KPIs |
| **LinkedIn** | `connectors.ts` `LinkedInConnector` (approval-gated `canPublish()`) | Env-detection + publish gate | `LINKEDIN_TOKEN` (`_CLIENT_ID/_SECRET/_ORG`) | Not configured · inert until token present |
| **Instagram** | `connectors.ts` `InstagramConnector` (approval-gated) | Env-detection + publish gate | `INSTAGRAM_TOKEN` (`_ACCOUNT`) | Not configured · inert until token present |
| **Gmail** | Engine: `evidence.ts`; `business-impact.ts` (support tickets, response time). Product: HeyCarbo `ingest-email` edge functions | Env-detection (engine); product email ingestion exists but no Gmail-API SDK | `GMAIL_TOKEN` | Backend Gmail API not configured |
| **GitHub** | `connectors.ts` `GitHubConnector`; `github.ts` + `research/sources.ts` (**real** `fetch` to api.github.com) | Real read client (infra) | `GITHUB_TOKEN`, `GITHUB_REPO` | Infra connector (not an Evidence source) |
| **Vercel** | `connectors.ts` `VercelConnector` | Env-detection (read-only) | `VERCEL_TOKEN` (`VERCEL_PROJECT`) | Infra connector (not an Evidence source) |

## Routing & registry (reused, not rebuilt)

- `connector-router.ts` — deterministic, first-match-wins text→`ConnectorType` classifier. No AI.
- `connectors.ts` `ConnectorRegistry` — maps router decisions to connector instances; reuses the router, adds no routing redesign.
- `evidence.ts` `DATA_SOURCES` — the single source-of-truth list the Evidence Layer and `business-impact.ts` KPI catalogue both consume. The eight sprint sources all appear here.

## Findings

1. **No duplication.** The eight Evidence sources are defined once (`evidence.ts`) and consumed everywhere via `tagKpi`/`isAvailable`. No competing connector definitions exist.
2. **No fabrication path.** A KPI is only ever assigned a value when its source's env vars are all set (`confidence: high`); otherwise it is `value: null`, `confidence: low`, `freshness: "n/a (hypothesis)"`. This satisfies Phase 2's "never estimate / never fabricate" rule.
3. **Current live state: 0 of 8 Evidence sources configured** in the engine env (`npm run evidence`). Every analysis is therefore correctly hypothesis-based today. Note three **real** external clients already exist in the product/infra layer — **Stripe** and **Supabase** (HeyCarbo) and **GitHub** (engine) — but none is yet wired to feed the engine's Evidence Layer with KPI samples.
4. **Cheapest unblocks = Stripe + Supabase**, because the product already ships live clients for both: Stripe edge functions can feed revenue KPIs (MRR/ARR/new customers); Supabase can feed product, supplier-network, and customer-success KPIs. Provisioning **GSC + GA4 (backend)** next yields the largest confidence lift for marketing/product funnels.

## Recommendation

Do **not** build new connectors. To make TedOS data-driven: (1) provision the engine env vars per `docs/connectors-setup.md`, and (2) bridge the already-live product clients (Stripe, Supabase) into the Evidence Layer as `SampleProvider`s — no new integrations, just sample plumbing. Order: Stripe + Supabase first (clients exist), then GSC + GA4 (backend), then CRM. The Evidence Layer flips affected KPIs to `confidence: high` automatically once samples arrive.
