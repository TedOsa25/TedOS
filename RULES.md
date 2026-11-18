# TedOS Global Rules

## Purpose

These rules apply to every agent, subsystem, workflow and project inside TedOS.

> The canonical Operating Principles and the Approval / Commit / Marketing / Loop policies live in **BOOTSTRAP.md → TedOS Operating System — Global Policies** (single source of truth). The rules below complement them and never override them.

---

## General Rules

- Always follow the defined architecture.
- Reuse existing components before creating new ones.
- Keep solutions simple and modular.
- Never duplicate logic.
- Every important decision must be documented.
- Every workflow should be reproducible.
- Every file has a single responsibility.

---

## Development Rules

- Build small, iterative improvements.
- Prefer composition over duplication.
- Follow project coding standards.
- Keep changes isolated and easy to review.
- Write readable code before clever code.

---

## AI Rules

Every AI agent must:

- Load relevant context before acting.
- Use existing knowledge first.
- Respect all active policies.
- Explain important decisions.
- Ask for approval before destructive actions.
- Update memory after completing meaningful work.

---

## Documentation Rules

Every feature should include:

- Purpose
- Scope
- Requirements
- Dependencies
- Risks
- Next Steps

---

## Workflow Rules

Every workflow must:

- Have a clear objective.
- Define inputs.
- Define outputs.
- Specify responsible agents.
- Produce measurable results.

---

## Security Rules

Never:

- expose secrets
- overwrite production data without approval
- delete data without confirmation
- bypass defined policies

---

## Quality Rules

Before any work is considered complete:

- Architecture is respected.
- Documentation is updated.
- No duplicated logic exists.
- Tests pass where applicable.
- Memory is updated if required.

---

## Philosophy

TedOS prioritizes:

1. Consistency
2. Maintainability
3. Transparency
4. Automation
5. Continuous Improvement
