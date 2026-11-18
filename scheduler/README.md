# TedOS Scheduler

## Purpose

The Scheduler is responsible for starting autonomous work.

Instead of waiting for prompts, TedOS continuously checks whether useful work exists.

If work is found, the appropriate loop is started automatically.

---

## Responsibilities

* Check for new goals
* Check GitHub
* Check bugs
* Check customer feedback
* Check deployments
* Check recurring jobs
* Prioritize work
* Start execution

---

## Execution

Scheduler

↓

Detect Work

↓

Prioritize

↓

Start Loop

↓

Wait

↓

Repeat

---

## Principle

TedOS should never wait for work if work already exists.


