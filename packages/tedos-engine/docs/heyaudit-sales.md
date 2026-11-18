# HeyAudit Sales in TedOS

## Bestand und Rollout

Rebase or merge of the existing outreach PR is independent of this branch.
Reuse Revenue Engine, Approval Queue, inbox classifier and follow-up engine.
The connector audit describes configuration detection, not verified production access.
Verify the deployed runtime revision, authoritative HeyAudit CRM, website and signup
event origin, booking provider, outbox, and current send controls before enabling writes.
Keep HeyCarbo isolated. Keep the existing web funnel and Monday report.

## Running the shadow worker

From packages/tedos-engine run:
```sh
npm ci
npm run sales:shadow -- /absolute/path/events.ndjson /absolute/path/sales-state
```

Each line is an event, for example:
```json
{"id":"calendar:123","account":"demo-company.example","kind":"booking","at":"2026-11-18T10:00:00Z","source":"google_search","fit":"yes"}
```

Use one canonical CRM account identifier per business and a stable namespaced event
ID. Export only positive responses as reply. Use an atomic rename when publishing an
input export. All inputs are HeyAudit only. Store the input and state in a restricted
directory, outside git. The worker maintains a ledger and produces snapshot.json
with one next-step recommendation per account and cumulative first-interest totals.
Bounce and opt-out trigger account-wide suppression in the pilot. This is intentionally
conservative. This worker does not write to CRM or execute those recommendations.

Run the command with the existing scheduler on an always-on worker. Start with a
five-minute cadence for the event export, and capture exit status/stderr. The directory
lock prevents overlapping invocations. If a process was forcibly killed, confirm no
worker is active before removing run.lock. Pause by disabling the schedule. Reruns
with the same event IDs are safe. Use a staging export to verify a real scheduled run.

## Agent responsibilities and rollout gates

| Role | Trigger | Contract and acceptance |
| --- | --- | --- |
| Inbound | Webhook, or five-minute export | Normalize registrations, requests, bookings and outcomes. A booking replaces an unneeded callback. Prove the calendar and CRM correspond to the same account. |
| Research | Weekdays | Find up to ten cleaning companies from approved sources. Return company, source, observed signal and uncertainty. Deduplicate against CRM. Count as target account until a real signal of interest. |
| Qualification | On new evidence | Evaluate firm fit and intent independently. Keep unknowns explicit. Require evidence before marking a target as suitable. |
| Sales | On event and when a task is due | Produce a callback, demo brief, or follow-up draft. Use existing approval and outbound policies. Recheck reply, booking and suppression at execution. Limit tasks to Ted's available capacity. |
| Acquisition | Weekly planning and approved experiment | Extract buyer wording from first-party inquiries. Choose one search landing page or one channel experiment at a time. Capture campaign IDs and review cost per held qualified demo. Budget and campaign launch require a separate decision. |
| RevOps | Weekday brief, Monday funnel | Track unique interested accounts, bookings, held qualified demos, wins, unknown source, time to first action and spend. Compare weekly cohorts and report attribution gaps. Feed validated outcomes back into research priorities. |

First connect the real event export in shadow and reconcile it with the existing CRM.
Then add idempotent CRM tasks on staging, including booking cancellation and reschedule.
Use a distinct engagement/meeting ID per opportunity, contact-level opt-outs, explicit
qualification events, persisted retries and a dead-letter queue before live actions.
Verify report totals, dedupe, replay, cancellation, replies and operational pause before
enabling CRM writes. Start acquisition with one approved channel and use held demos
and wins to determine whether spend can scale. Product and onboarding are outside scope.
