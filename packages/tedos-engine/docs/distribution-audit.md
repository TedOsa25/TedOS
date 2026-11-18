# Distribution Audit — Autonomous Distribution Engine, Aufgabe 1

**Date:** 2026-06-26 · **Branch:** `tedos/evidence-engine` · **Method:** static read of `src/`, `content/`, `marketing/`, `analytics/`, `docs/`. No assumptions; nothing modified.

## Kernaussage

Die gesamte Marketing-/Sales-/Growth-/Customer-Success-Architektur **erzeugt heute Drafts und stoppt bei Approval**. Es gibt **keine** Distribution-Ausführung: keine Distribution Queue, keinen Publish/Send-Schritt, keine automatische Analytics-Erfassung nach Veröffentlichung. Die Pipeline endet an „Preview → Approval → (manuell) Publish". Genau diese letzte Hälfte fehlt.

> Pipeline-Ziel (Aufgabe 2): … → Approval → **Distribution Queue → Connector → Veröffentlichung → Analytics → Learning → Executive Report**.
> Vorhanden: alles **bis** Approval. Fehlend: alles **ab** Distribution Queue.

## Watchdog-für-Watchdog (was existiert)

Watchdogs sind ein **daten-only Cron-Manifest** (`src/watchdogs.ts`) — sie recherchieren, analysieren, erzeugen Drafts + GoalCandidates. Sie publizieren nie (nur der Main Loop implementiert).

| Watchdog | Erzeugt heute | Drafts liegen in | Reports/Feeds | Distribution? |
|---|---|---|---|---|
| **Marketing** (14:00) | LinkedIn, Blog, Newsletter, Case Studies, PR | `content/*.md`, `marketing/{linkedin,blog,newsletter,…}/` | `marketing-findings.json` | ❌ kein Publish |
| **Growth & Content** (07:00) | LinkedIn, Instagram, Carousel, Story, Blog, Newsletter, SEO + Image-Brief | `content/{linkedin,instagram,carousel,stories,newsletter,blog,image-prompt}.md` | `content-findings.json` | ❌ kein Publish |
| **Growth** (13:00) | Landing/Funnel/SEO/Conversion-Analyse → GoalCandidates | (Main Loop implementiert Code) | `growth-findings.json` | ❌ (geht über Main Loop) |
| **Sales** (16:30) | Personalisierte E-Mails, LinkedIn-Nachrichten, Demo-Einladungen | `marketing/outreach/*.md` (z. B. `2026-06-25-grafe.md`) | `sales-findings.json` | ❌ „NOT sent" |
| **Revenue** (16:00) | Pricing/Upsell/Expansion-Analyse (analysis only) | — | `revenue-findings.json` | ❌ (analysis only) |
| **Customer Success** (15:00) | Onboarding/Feedback/Churn/Help-Center-Analyse | — (keine Versand-Drafts) | `customer-success-findings.json` | ❌ kein Send |

## Vorhandene, wiederverwendbare Komponenten (NICHT duplizieren)

| Baustein | Datei | Rolle für Distribution |
|---|---|---|
| **Approval (shared)** | `src/approval-queue.ts` `ApprovalQueue` (+ kernel `ApprovalGate`) | Das **gemeinsame** Approval-Gate. Distribution Queue baut hierauf auf — kein zweites Approval-System. |
| **Brand Guardian** | `src/brand-guardian.ts` `checkContent`/CTAs | Content-QA vor Publish (greenwashing = blocking). Bereits Teil der Pipeline. |
| **Social Connectors** | `src/connectors.ts` `LinkedInConnector`/`InstagramConnector` (`SocialConnector.canPublish()`) | Publish-Gate vorhanden — **aber kein `publish()`**. Inert ohne Token. |
| **Connector Routing** | `src/connector-router.ts` | Task→ConnectorType (LinkedIn/Instagram/…). Wiederverwendbar für Job-Routing. |
| **Evidence Layer** | `src/evidence.ts` `DATA_SOURCES` | Env-Detection + Confidence pro Quelle (GSC/GA4/Stripe/CRM/Supabase/LinkedIn/Instagram/Gmail). |
| **Business Metrics + Dashboard** | `src/business-impact.ts`, `src/business-dashboard.ts` | KPI-Katalog + Executive-Report-Dashboard (letzter Sprint). Distribution-Sektion erweitert das. |
| **Learning** | `src/learning.ts` (`OutcomeStore`, `OutcomeLearningStore`), `src/outcome-prioritization.ts` | Bestehende Learning Engine — Distribution-Learning schreibt hier hinein, keine neue Engine. |
| **Persistenz** | `src/storage.ts` (`Storage`, in-memory / JSON via `TEDOS_STORAGE_PATH`) | Gleiche Append-Persistenz wie ApprovalQueue/OutcomeStore. Distribution Queue nutzt dieselbe. |
| **Analytics-Senken** | `analytics/{content-performance,content-learnings}.json`, `marketing/analytics/{social-performance,marketing-learnings}.json` | Existieren, sind **leer** — kein Code schreibt hinein (kein Connector). |
| **Connector-Setup-Doku** | `docs/connectors-setup.md`, `docs/connector-audit.md` | Setup für LinkedIn/Instagram/GSC/GA4/CRM/Stripe bereits dokumentiert. |

## Connector-Status (aus `connector-audit.md`, bestätigt)

| Connector | Real-Client vorhanden? | Publish/Send vorhanden? | Env |
|---|---|---|---|
| **Stripe** | ✅ HeyCarbo Edge Functions | n/a (Revenue-Read) | `STRIPE_SECRET_KEY` |
| **Supabase** | ✅ `@supabase/supabase-js` | n/a (DB-Read) | `SUPABASE_URL/KEY` |
| **GitHub** | ✅ (Infra) | n/a | `GITHUB_TOKEN/REPO` |
| **LinkedIn** | ⚠️ Adapter nur (`canPublish`) | ❌ **kein `publish()`** | `LINKEDIN_TOKEN(/_ORG)` |
| **Instagram** | ⚠️ Adapter nur (`canPublish`) | ❌ **kein `publish()`** | `INSTAGRAM_TOKEN(/_ACCOUNT)` |
| **Gmail** | ❌ env-check | ❌ **kein send** | `GMAIL_TOKEN` |
| **CRM** | ❌ env-check | ❌ kein write | `CRM_API_KEY(/_BASE)` |
| **GSC / GA4** | ❌ env-check (GA4: client gtag) | n/a (Read) | siehe setup-doc |

## Was fehlt (= dieser Sprint, additiv)

1. **Distribution Queue** — *eine* gemeinsam genutzte Queue approved Distribution-Jobs (post/email/publish), persistiert über die bestehende `Storage` (wie ApprovalQueue). **Keine separaten Queues, kein neues Queue-Framework.**
2. **Distribution Layer / Executor** — der Schritt Approval → Connector → Veröffentlichung → Ergebnis. Existiert nicht.
3. **Job-Modell** — typisierte Jobs (Channel, Connector, Payload, Status-Lifecycle: queued→published/sent/failed/skipped).
4. **Connector `publish()/send()`** — credential-gated (wie `canPublish()`): ohne Token **inert**, kein Fabrizieren, kein Auto-Send. Health Check + Test Call.
5. **Distribution Analytics** — typisierter Recorder, der nach jeder Veröffentlichung in die bestehenden Analytics-Senken schreibt (LinkedIn/Instagram/E-Mail/Website/CRM-Metriken).
6. **Distribution Learning** — Aggregation „welche Inhalte/Betreffzeilen/CTAs/Zeiten gewinnen" in die bestehende Learning Engine.
7. **Executive Report — Distribution-Sektion** — Posts/E-Mails veröffentlicht, aktive Kampagnen, Top/Worst Kampagnen, ROI pro Kampagne (erweitert `business-dashboard.ts`).

## Guardrail-Befund

- **Keine neuen Watchdogs nötig** — die 5 relevanten existieren und erzeugen bereits Drafts.
- **Kein neues Approval/Queue/Learning/Runtime nötig** — alle Seams existieren (`ApprovalQueue`, `Storage`, `learning.ts`). Distribution erweitert sie.
- **Kein Auto-Publish ohne Credentials** — durch das vorhandene `canPublish()`/Token-Gating bereits erzwingbar; Distribution muss diesem Muster folgen.
- **Empfehlung:** additive Implementierung als *eine* vertikale Schicht: `DistributionQueue` (reuse Storage+ApprovalQueue) → Connector-`publish()`-Erweiterung (credential-gated) → `DistributionAnalytics` (reuse JSON-Senken + Learning) → Executive-Report-Erweiterung. Offline/deterministisch by default; reale Veröffentlichung nur mit Token + Approval.
