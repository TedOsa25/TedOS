# TedOS Engine — Entwicklerdokumentation

Übersicht der Dokumentation für `packages/tedos-engine`. Einstiegspunkt für neue Entwickler.

## Architekturübersicht

Kurzbeschreibung der zentralen Bausteine. Die Engine ist der autonome Betriebskern; darüber
liegen die Geschäftsprodukte (HeyCarbo, HeyAudit), für die die Engine Wachstum, Umsatz und
Distribution automatisiert.

| Baustein | Beschreibung | ADR |
|---|---|---|
| **TedOS Engine** (`src/`) | Autonomer Betriebskern: Loop, Planung, Priorisierung, Watchdogs und Geschäftslogik als zusammenhängendes greenfield System. | [ADR 0001](adr/0001-greenfield-engine-pr.md) |
| **Revenue Engine** (`src/revenue/`) | Outreach-/Umsatz-Schicht: E-Mail-Generator, 5 Copy-Varianten, HTML-Template + Assets, Account-Priorisierung und provider-agnostische, standardmäßig entschärfte Versandschicht. | [ADR 0001](adr/0001-greenfield-engine-pr.md) |
| **Evidence Engine** (`src/evidence.ts`) | Prüft Datenverfügbarkeit und hinterlegt pro KPI Quelle, Frische und Konfidenz — nichts wird ohne belegte Evidenz behauptet. | — |
| **Distribution** (`src/distribution-*.ts`) | Queue, Engine und Analytics für die Auslieferung von Content/Outreach über Connectors — mit Approval- und Credential-Gating. | — |
| **Brand Guardian** (`src/brand-guardian.ts`) | Prüft ausgehende Inhalte gegen Marken-/Tonalitätsregeln, bevor sie in Distribution oder Versand gehen. | — |
| **Approval Gate** (`src/approval-gate.ts`, `src/approval-queue.ts`) | Nicht-blockierendes Freigabe-Gate: MEDIUM/HIGH-Aktionen werden zur menschlichen Freigabe in die Queue gestellt statt automatisch ausgeführt. | — |
| **Storage** (`src/storage.ts`) | Gemeinsame Persistenzschicht, auf der Revenue-, Distribution- und Approval-Module aufsetzen. | — |
| **Runtime Loop** (`src/tedos-loop.ts`) | Zentraler Ausführungs-Loop, der Engines orchestriert und u. a. die Revenue Engine einbindet. | [ADR 0001](adr/0001-greenfield-engine-pr.md) |
| **HeyCarbo** | Produkt (Production): AI-native Climate-Intelligence-Plattform — Carbon Accounting (Scope 1–3), CSRD/ESRS-Reporting, Catena-X. Zielkunde der Outreach-/Revenue-Automatisierung. | — |
| **HeyAudit** | Produkt (Production): AI-native Inspection- & Operations-Plattform — digitalisiert Inspektionen, Audits, Checklisten und Betrieb. Zweites von der Engine bespieltes Produkt. | — |

## Repository Structure

Das Monorepo trennt den ausführbaren Engine-Code (`packages/`) von der agentischen
Betriebsschicht (Loops, Skills, Runtime-State) auf Repo-Ebene.

```
packages/            npm-Workspaces mit ausführbarem Code — aktuell: tedos-engine
  tedos-engine/
    src/             Engine-Quellcode (TypeScript)
      revenue/       Revenue-/Outreach-Engine: E-Mail-Generator, Copy, Template, Sending
      …              evidence.ts, distribution-*, brand-guardian, approval-*, storage, tedos-loop
    docs/            Diese Entwicklerdokumentation
      adr/           Architecture Decision Records (fortlaufend nummeriert)
docs/                (siehe packages/tedos-engine/docs/) — Engine-Doku liegt beim Paket
skills/              Fach- & Skill-Wissen des Agenten (carbon, esrs, react, sales, …)
loops/               Prozess-Playbooks für wiederkehrende Abläufe (bugfix, build-feature, marketing, …)
runtime/             Live-Session-Zustand (active-agents, context, session, geladene Policies/Skills)
```

Hinweise für neue Entwickler:
- **`revenue/`** und **`evidence/`** sind keine Top-Level-Ordner, sondern Engine-Submodule unter
  `packages/tedos-engine/src/` (`src/revenue/` bzw. `src/evidence.ts`).
- **`runtime/`** enthält Zustands-Snapshots, keinen ausführbaren Code — nichts hier von Hand editieren.
- Ausführbare Demos/Tests laufen über die npm-Scripts in `packages/tedos-engine/package.json`
  (`npm run <name>`, `npm test`, `npm run typecheck`).

## Module & Engines (Detaildoku)
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
