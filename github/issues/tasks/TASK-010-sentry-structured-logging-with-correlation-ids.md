---
id: TASK-010
type: task
title: "Sentry + structured logging with correlation IDs"
feature: FEAT-002
epic: EPIC-001
milestone: M0
priority: High
size: "S (0.5 day)"
area: infra
dependencies: [TASK-002]
labels: [type:task, priority:high, area:infra, milestone:m0, size:s]
status: Not Started
---

# TASK-010: Sentry + structured logging with correlation IDs

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-002`](../features/FEAT-002-ci-cd-environments.md) — CI/CD & environments &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** S (0.5 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **CI/CD & environments** (FEAT-002). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-002` — Scaffold apps/api (NestJS+Fastify) with /health

## Expected output

Error tracking and structured logs wired

## Acceptance criteria

- [ ] A deliberately thrown test error appears in Sentry with a correlation ID

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:high`, `area:infra`, `milestone:m0`, `size:s`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** FEAT-002
- **Project fields:** Type=Task, ID=TASK-010, Feature=FEAT-002, Priority=High, Size=S (0.5 day), Area=infra, Milestone=M0, Status=Not Started
