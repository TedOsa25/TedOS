# TedOS Engine — Entwicklerdokumentation

Übersicht der Dokumentation für `packages/tedos-engine`.

## Module & Engines
- [Evidence Engine](evidence-engine.md)
- [Growth Engine](growth-engine.md)
- [Revenue Growth Loop](revenue-growth-loop.md)
- [Distribution Engine](distribution-engine.md)
- [Watchdogs](watchdogs.md) · [Content Watchdog](content-watchdog.md)
- [Approval Queue](approval-queue.md)
- [Prioritization](prioritization.md)
- [Business Impact Dashboard](business-impact-dashboard.md)
- [Connectors — Setup](connectors-setup.md) · [Connector Audit](connector-audit.md)
- [E-Mail-Varianten — Analyse](email-variants-analysis.md)

## Architecture Decisions

Architekturentscheidungen werden als fortlaufende ADRs (Architecture Decision Records) unter
[`docs/adr/`](adr/) dokumentiert.

- [ADR 0001 — TedOS-Engine als zusammenhängender Greenfield-PR mergen](adr/0001-greenfield-engine-pr.md)
  — begründet, warum die vollständige Engine (inkl. Revenue-/Outreach) als ein Greenfield-PR
  gemergt wird und kein separater Revenue-only-PR erstellt wird.
