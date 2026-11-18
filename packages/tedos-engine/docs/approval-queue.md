# Non-Blocking Approval Queue

A MEDIUM/HIGH goal must **never stop** a Main Loop iteration. It is deferred into the Approval Queue and the loop immediately continues with the next available LOW goal — using its full time budget. Approval is a *deferral*, not a *stop*.

Implemented in [`src/approval-queue.ts`](../src/approval-queue.ts) (tests: `approval-queue.test.ts`; demo: `npm run approvals`).

## Reuse, not duplication

This **extends** the existing approval mechanism:
- Persists through the same **Storage** layer as `OutcomeStore` / `ApprovalGate` (key `approval-queue`).
- Delegates the awaiting/approved bookkeeping to the kernel **`ApprovalGate`** (synced on `enqueue`/`approve`), so execution gating still has one source of truth.
- Adds only the richer metadata + status lifecycle the Main Loop needs.

## Main Loop behaviour

```
select goal → risk assessment
  LOW    → implement now
  MED/HI → enqueue + Approval Report → continue with next goal
repeat until no LOW goals remain OR the 15-minute budget is reached
```

## Entry

Goal ID · Title · Description · Business Impact · Revenue Impact · Customer Value · Risk · Priority Score · Files · Estimated Effort · Timestamp · **Status** (`pending` · `approved` · `rejected` · `expired` · `implemented`).

## Collected Approval Report

Multiple open approvals are summarized into **one** report (ordered by priority score), never several separate prompts. Example: 3 open approvals → Supplier Portal (ROI 94, MEDIUM, approve) · Security (ROI 80, HIGH, approve) · Pricing (ROI 42, HIGH, reject).

## Learning metrics (feed the Executive Report)

`stats()` → open approvals · average pending business impact · average approval duration · total decided. The Main Loop additionally records per-tick **skipped goals** and **LOW goals completed** into `loop-outcomes.json`.

> Mirrors the operating policy in `ai-os/BOOTSTRAP.md` (single source of truth).
