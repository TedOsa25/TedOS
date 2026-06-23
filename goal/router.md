# Goal Router

## Purpose

The Goal Router selects the correct execution path for every goal.

It decides which agents, workflows, loops and connectors are required.

---

## Responsibilities

The router determines:

* Required Agents
* Required Subagents
* Required Skills
* Required Connectors
* Required Workflows
* Required Loops
* Required Policies

---

## Routing Logic

Examples:

Feature Request

↓

CEO

↓

Product

↓

Developer

↓

Reviewer

↓

QA

---

Bug

↓

QA

↓

Developer

↓

Reviewer

↓

QA

---

Marketing Campaign

↓

Marketing

↓

Research

↓

Sales

---

Research

↓

Research

↓

CEO

↓

Product

---

## Principles

* Load only what is needed.
* Minimize context.
* Maximize business impact.
* Reuse existing workflows.

