# TedOS Runtime

## Purpose

The Runtime represents the current execution state of TedOS.

It keeps track of what is currently active during execution.

---

## Runtime contains

- Active Project
- Active Goal
- Active Workflow
- Active Agents
- Loaded Skills
- Loaded Memory
- Loaded Policies
- Current Session
- Current State

---

## Responsibilities

The Runtime is responsible for:

- Tracking execution
- Loading context
- Managing state
- Passing information between components
- Supporting autonomous execution

---

## Principles

The Runtime should always contain only the information required for the current execution.

Avoid unnecessary context.

Keep the Runtime lightweight and up to date.
