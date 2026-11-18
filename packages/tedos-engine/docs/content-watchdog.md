# Growth & Content Watchdog

A first-class TedOS watchdog (daily **07:00**) that builds HeyCarbo's organic reach and demand as **thought leadership** — for Scope 3, Supplier Carbon Management, PCF, CSRD, ESG, Catena-X, Carbon Accounting. Registered in [`src/watchdogs.ts`](../src/watchdogs.ts).

## Pipeline (same architecture as every loop)
Research → Reasoner → Feedback → Prioritization → GoalCandidate → **Approval** → Execution → Verification → Learning.

## Daily workflow
1. **Research:** regulation (CSRD/ESRS/Catena-X/ISO 14064/14067/GHG Protocol/EU Green Deal/CBAM/VSME), market (Cozero, Normative, Plan A, Sweep, Watershed, SAP, Microsoft Sustainability, IntegrityNext, EcoVadis), customers (`HeyCarbo/ai/*.md`, tickets, sales calls, lost deals, Scope-3 pain points), SEO (trends/keywords), LinkedIn & news.
2. **Reasoner score:** Business Impact · Customer Value · SEO Potential · Virality · Brand Impact · Lead Potential · Revenue Impact.
3. **Generate drafts** into `content/`: 1 LinkedIn, 1 Instagram, 1 carousel, 1 story, 1 blog idea, 1 newsletter idea, 1 SEO idea (+ image brief).
4. **Brandbook gate (mandatory):** validate every draft against `HeyCarbo/docs/BRANDBOOK.md` + `brand-tokens` skill — colors, typography, logo, icons, spacing, buttons, image language, tone of voice, CTA style, headlines. The brandbook is the highest authority; no deviations.
5. **CTA engine:** rotate `Kostenlos testen · Demo buchen · Lieferanten kostenlos einladen · Scope-3 kostenlos analysieren · CO₂-Daten hochladen · Supplier Portal testen · Kostenlos starten`; embed demo calendar `{{DEMO_CALENDAR_URL}}`.
6. **Verification:** spelling, grammar, SEO, readability, tone, double-spaces, dash consistency, remove AI-filler/repetition, image quality, CTA, mobile.
7. **Approval:** emit a preview + approval request. **Never auto-publish.**
8. **Learning:** after publish, ingest metrics into `analytics/content-performance.json` → `analytics/content-learnings.json` to optimize future content.

## Outputs
`content/{linkedin,instagram,carousel,stories,newsletter,blog,image-prompt}.md` · `analytics/{content-performance,content-learnings}.json` · `marketing/{content-roadmap,weekly-plan}.md` · GoalCandidates → `content-findings.json`.

## Guardrails
Read/analyse/prioritize/draft only. **Never:** auto-publish, change the brandbook, invent facts, make greenwashing/unverifiable claims, deploy, merge, or work on `main`. High-risk → approval request. Only the Main Loop implements.

## Known dependency (blocker)
No LinkedIn/Instagram **organic** publishing or analytics connector is configured (only paid `meta-ads` is available). Until one is added: publishing is manual after approval, and `content-performance.json` metrics are entered manually. Tracked as GoalCandidate `connector-social-publishing`.

## Config
Set `{{DEMO_CALENDAR_URL}}` (demo booking link) — not yet configured; required before CTAs ship.
