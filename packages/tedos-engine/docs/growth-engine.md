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

## Known dependency (blocker)
**No organic LinkedIn/Instagram publishing or analytics connector** is configured (only paid `meta-ads`). Until one is added, the pipeline stops at **Preview → Approval** (publishing is manual) and social metrics are entered manually. Tracked as GoalCandidate `connector-social-publishing`. A demo calendar can be sourced from the `gcal` connector once a booking link is set.
