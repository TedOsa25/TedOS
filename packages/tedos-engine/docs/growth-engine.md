# HeyCarbo Growth Engine V1

The Growth Engine makes HeyCarbo visible every day through **thought leadership** (not ads) — to grow reach, trust, demo bookings, trial signups, suppliers and enterprise leads. It is **not a new architecture**: it extends the existing **Growth & Content Watchdog** (07:00) plus the **Marketing** (14:00) and **Growth** (13:00) Watchdogs, and the Main Loop. The **Brandbook** (`HeyCarbo/docs/BRANDBOOK.md`) is the highest authority.

## Pipeline
Research → Content → **Brand Guardian** → Preview → **Approval** → Publish. No auto-publish.

## Components (all reuse existing pieces)
- **Brandbook integration** — reuses `HeyCarbo/docs/BRANDBOOK.md` (Inter font, monochrome-gray foundation, restraint), `brand-tokens` skill, existing landing/UI/assets. No new design language, no duplicate brandbook.
- **Brand Guardian** — [`src/brand-guardian.ts`](../src/brand-guardian.ts) (tests: `brand-guardian.test.ts`; demo: `npm run brand`). Before every preview it auto-corrects mechanical issues (double spaces, repeated hyphens, line trim) and flags semantic ones (AI-filler phrases, em-dash overuse, greenwashing/unverifiable claims = **blocking**, missing CTA). Brandbook is never modified.
- **CTA Engine** — rotates the 7 approved CTAs (`Kostenlos testen · Demo buchen · Lieferanten kostenlos einladen · Scope-3 analysieren · CO₂-Daten hochladen · Supplier Portal testen · Jetzt starten`) and appends the demo calendar link when configured (`{{DEMO_CALENDAR_URL}}`).
- **Research** — the Content/Marketing/Growth Watchdogs research ESG/Scope 3/Catena-X/ESRS/CSRD/GHG/ISO 14064-67, automotive/manufacturing/procurement/supply-chain, competitors, LinkedIn/Google trends, SEO, sales calls/support tickets/demo feedback (HeyCarbo/ai/*.md + web).
- **Content Engine** — daily LinkedIn/Instagram/carousel/story/newsletter/blog + 3 video scripts + 5 ideas, into `marketing/<platform>/` (dated drafts). SEO-aware, human, no AI-filler/double-spaces/double-hyphens.
- **Visual Engine** — reuse existing photos/hero images/assets first; only brief new images in the identical HeyCarbo style (white bg, large hero, industry/supply-chain, lots of whitespace, black type, green CTA). Briefs in `content/image-prompt.md`.
- **Analytics & Learning** — `marketing/analytics/social-performance.json` + `marketing-learnings.json`; 24h-after metrics + learnings feed future content.

## Output structure (`marketing/`)
`linkedin/ · instagram/ · blog/ · newsletter/ · videos/ · carousel/ · stories/ · analytics/` + `weekly-plan.md · monthly-plan.md · content-calendar.md` + `analytics/{social-performance,marketing-learnings}.json`.

## Guardrails
No auto-publish · no Brandbook changes · no invented facts · no greenwashing · only verifiable claims. High-risk → Approval Queue. Mirrors `ai-os/BOOTSTRAP.md` (single source of truth).

## Social connectors (adapter built; credential-gated)
`LinkedInConnector` + `InstagramConnector` (`src/connectors.ts`, routed via `ConnectorRouter`) are now registered. They are **inert until credentials exist**: `canPublish()` is false and `status()` reports "not configured" without `LINKEDIN_TOKEN` / `INSTAGRAM_TOKEN`. Publishing is **approval-gated** and additionally requires a live platform API integration — the adapter never posts on its own and no metrics are fabricated. Until tokens + the live API are provisioned, the pipeline stops at **Preview → Approval** (manual publish) and metrics are entered manually. A demo calendar can be sourced from `gcal` once a booking link is set.
