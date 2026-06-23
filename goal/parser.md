# Goal Parser

## Purpose

The Goal Parser transforms a user request into a structured business goal.

It identifies the true objective behind the request before any execution begins.

---

## Responsibilities

The Goal Parser must:

* Understand the user's intent
* Remove ambiguity
* Identify the business objective
* Detect the affected project
* Detect the required domain
* Estimate complexity
* Detect dependencies
* Extract constraints

---

## Inputs

Examples:

* "Improve supplier onboarding."
* "Build a new Planner."
* "Reduce support tickets."
* "Prepare for CSRD."
* "Launch HeyMigo."

---

## Outputs

The parser produces:

* Goal Type
* Business Objective
* Affected Project
* Priority
* Constraints
* Required Skills
* Suggested Agents
* Suggested Workflows

---

## Rules

Never execute work.

Only understand and structure the goal.

Execution begins only after planning.

