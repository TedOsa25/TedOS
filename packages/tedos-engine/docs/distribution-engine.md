# Autonomous Distribution Engine

TedOS handelt jetzt kontrolliert: approved Inhalte/Outreach werden über credential-gated Connectoren veröffentlicht/versendet, gemessen, gelernt und im Executive Report ausgewiesen. **Additiv** — keine neuen Watchdogs, keine neue Runtime, keine neue Approval-/Learning-Engine, keine zweite Queue. Siehe Audit: [`distribution-audit.md`](./distribution-audit.md).

## Pipeline
```
Watchdog-Draft → enqueue → Distribution Queue (pending-approval)
   → Approval (shared ApprovalGate) → readyToDistribute
   → Brand Guardian (block bei greenwashing) → Publisher (credential+transport gated)
   → Veröffentlichung → Analytics (metrics) → Learning → Executive Report (Distribution)
```
Demo: `npm run distribution`. Wired in `tedos-loop.ts` (offline = no-op; section wird im Executive Report gerendert).

## Komponenten (alle neu, additiv) & Wiederverwendung
| Datei | Rolle | Reuse |
|---|---|---|
| `distribution-queue.ts` | **Eine** geteilte Queue aller Watchdogs; Job-Lifecycle | `Storage`, kernel `ApprovalGate` (dieselbe Quelle wie `ApprovalQueue`) |
| `distribution-connectors.ts` | Credential+Transport-gated `publish()/send()/healthCheck()/testCall()` | env-Token-Gate wie `SocialConnector.canPublish()` |
| `distribution-analytics.ts` | Metrics-Capture, Learning-Aggregation, Executive-Distribution-Sektion | `Storage`, `evidence`-Confidence-Muster, JSON-Sink-Shape |
| `distribution-engine.ts` | Executor: Queue → Brand Guardian → Publisher → Analytics/Learning | `brand-guardian.checkContent` |
| `distribution-demo.ts` | End-to-End-Demo | alle obigen |

## Wie Approval funktioniert
Jeder Job wird `pending-approval` enqueued und ruft `ApprovalGate.requestApproval()` auf — er erscheint im **gleichen** Approval-Flow wie jede andere gated Aktion (kein zweites Approval-System). `DistributionQueue.approve(id)` setzt `approved` **und** synct den Gate. `readyToDistribute()` liefert nur Jobs, die `approved` sind **und** im geteilten Gate freigegeben. Ein nicht approvter Job wird nie angefasst (`attempted: 0`).

## Wie fehlende Credentials behandelt werden
Doppeltes Gate, niemals Leak, niemals fabrizierte Metrik:
1. **Credentials** — fehlt ein `*_TOKEN`, ist der Publisher **inert**: Job → `skipped` mit konkretem Setup-Hinweis (`docs/connectors-setup.md §…`).
2. **Transport** — auch *mit* Credentials passiert ein echter Netzwerk-Call nur, wenn ein live `Transport` injiziert ist. Offline/Default (no-deploy) → `skipped` + Setup-Hinweis.
`healthCheck()` / `testCall()` melden den Status, ohne zu posten. → In der Praxis: ohne Provisionierung wird **nichts** veröffentlicht; es entsteht ein pending/skipped-Item mit Anleitung.

## Unterstützte Plattformen
| Channel | Connector | Erfolgsstatus | Required env |
|---|---|---|---|
| `linkedin` | linkedin | `published` | `LINKEDIN_TOKEN` (+`LINKEDIN_ORG`) |
| `instagram` | instagram | `published` | `INSTAGRAM_TOKEN` (+`INSTAGRAM_ACCOUNT`) |
| `email` | gmail | `sent` | `GMAIL_TOKEN` |
| `web` | web (Vercel) | `published` | `VERCEL_TOKEN` (+`VERCEL_PROJECT`) |

Watchdog→Channel: Marketing→linkedin/instagram/web; Sales & Customer Success→email; Growth→web. Alle nutzen **dieselbe** Queue.

## Analytics & Learning
Nach jedem Publish/Send `captureMetrics(job, provider)` → ohne live `MetricsProvider` alles 0 / `confidence: low` (keine Erfindung). `learnFromMetrics()` aggregiert pro **channel · cta · subject · hour · source · campaign** (welche Inhalte/Betreffzeilen/CTAs/Zeiten gewinnen) und persistiert via `Storage` (reuse Learning-Home). Diese Erkenntnisse stehen für zukünftige Kampagnen bereit.

## Executive Report — Distribution
`buildDistributionSection()` / `renderDistributionSection()`: veröffentlichte Posts, versendete E-Mails, aktive Kampagnen, neue Leads/Demo-Buchungen/Trials/Supplier-Aktivierungen, Top/Worst Kampagnen, ROI pro Kampagne — jeweils mit Confidence. Wird im Loop nach dem Business-Impact-Dashboard gerendert.

## Guardrails erfüllt
Kein Auto-Publish/-Send ohne Approval **und** valide Credentials · keine neue Queue/Runtime/Learning-Engine · Brand Guardian bleibt verbindlich · deterministisch/offline by default · Feature-Branch, kein Merge/Deploy.
