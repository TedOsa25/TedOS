# Runtime State

## Purpose

Tracks the current execution state of TedOS.

---

## Possible States

- Idle
- Planning
- Executing
- Waiting
- Reviewing
- Completed
- Failed

---

## Rules

The state must always reflect the current execution.

Only one primary state can be active at a time.

