# TedOS Decision Framework

## Purpose

The Decision Framework defines how TedOS makes decisions.

Every agent, subsystem and workflow follows these rules before taking action.

---

## Decision Priorities

Always evaluate decisions in this order:

1. Policies
2. Core Rules
3. Business Value
4. User Value
5. Technical Quality
6. Maintainability
7. Performance
8. Cost
9. Speed

---

## Build vs Reuse

Before creating anything new ask:

* Does something similar already exist?
* Can an existing component be extended?
* Can the solution be simplified?
* Can duplicate logic be avoided?

Prefer reuse over creation.

---

## Approval & Autonomy

The canonical risk tiers, approval policy, and what TedOS may or may not do autonomously are defined once in **BOOTSTRAP.md → TedOS Operating System — Global Policies** (the single source of truth). Do not restate them here.

---

## Conflict Resolution

If two rules conflict:

1. Policies win.
2. Security wins over convenience.
3. Simplicity wins over complexity.
4. Business impact wins over perfection.
5. Human approval overrides AI decisions.

---

## Decision Process

Every significant decision follows:

Understand

↓

Analyze

↓

Evaluate Options

↓

Estimate Risks

↓

Select Best Option

↓

Execute

↓

Review

↓

Document

↓

Update Memory

---

## Success Criteria

Every decision should improve at least one of:

* Customer Value
* Product Quality
* Business Growth
* Maintainability
* Automation
* Scalability
* Reliability
* Developer Experience

## High-Impact, Production-First & Smallest-Change

The High-Impact Change workflow (HIGH risk), Production First, and the Smallest Change Principle are canonical in **BOOTSTRAP.md → TedOS Operating System — Global Policies**. They are not duplicated here.
