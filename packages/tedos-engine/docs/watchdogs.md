# TedOS Watchdogs & Autonomous Schedule

Canonical manifest: [`src/watchdogs.ts`](../src/watchdogs.ts) (validated by `src/watchdogs.test.ts`, viewable via `npm run watchdogs`).

The scheduler runs one continuous **Main Loop** plus twelve **daily watchdogs** and an end-of-day **Executive Report**. Watchdogs are **read-only**: they research, analyse, and emit GoalCandidates into a Learning feed. Only the **Main Loop** implements work.

## Daily timeline (local time)

| Time | Job | Feed |
|------|-----|------|
| every 15 min | **Main Loop** — implements highest-value safe goal; escalates MEDIUM/HIGH | `loop-outcomes.json` |
| 07:00 | **Growth & Content Watchdog** *(new)* — brandbook-validated, approval-gated content drafts (see [`content-watchdog.md`](./content-watchdog.md)) | `content-findings.json` |
| 08:00 | Health Watchdog | `health-findings.json` |
| 09:00 | UX Watchdog | `ux-findings.json` |
| 10:00 | Product Strategy Watchdog | `strategy-findings.json` |
| 11:00 | Competitor Watchdog | `competitor-findings.json` |
| 12:00 | Security Watchdog | `security-findings.json` |
| 13:00 | Growth Watchdog | `growth-findings.json` |
| 14:00 | Marketing Watchdog | `marketing-findings.json` |
| 15:00 | Customer Success Watchdog | `customer-success-findings.json` |
| 16:00 | Revenue Watchdog | `revenue-findings.json` |
| 16:30 | **Sales Watchdog** *(new)* | `sales-findings.json` |
| 17:00 | AI Watchdog | `ai-findings.json` |
| 17:30 | **Supplier Watchdog** *(new)* | `supplier-findings.json` |
| 18:00 | Executive Report — aggregates all 13 sources | `executive-reports.json` |

Cron times are nudged a few minutes off the hour (and off :30 for Sales/Supplier) to avoid top-of-hour API pile-up; see the manifest for exact expressions.

## Executive Report sources (13)

Main Loop + Health, UX, Strategy, Competitor, Security, Growth, Marketing, Customer Success, Revenue, Sales, AI, Supplier. It generates: Overall Product Health, Executive Summary, Product Health Score, Revenue/Growth Opportunities, Marketing/Sales Highlights, Customer Success / Competitor / Security / AI / Supplier-Network Findings, Completed/Blocked Goals, Pending Approvals, Highest-Priority GoalCandidates, Tomorrow Priorities, Learning Summary.

## Guardrails (all watchdogs)

**Allowed:** research, analysis, read, reports, GoalCandidates, prioritization.

**Never:** deploy, merge, work on `main`, change compliance / CO₂ calculations / billing / pricing / security logic, run migrations, or change product logic.

High-risk topics automatically produce an **approval request**. The Main Loop is the only instance that prioritizes, approves, and implements GoalCandidates — LOW risk on a feature branch (never `main`, never merge, never deploy), MEDIUM/HIGH escalated for approval.

## Learning

All feeds live under `learning-data/`. The Executive Report reads them daily and appends a dated summary to `executive-reports.json`.
