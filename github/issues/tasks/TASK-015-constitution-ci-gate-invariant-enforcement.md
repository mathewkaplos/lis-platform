---
id: TASK-015
type: task
title: "Constitution CI gate (invariant enforcement)"
feature: FEAT-003
epic: EPIC-001
milestone: M0
priority: Critical
size: "L (2 days)"
area: infra
dependencies: [TASK-006]
labels: [type:task, priority:critical, area:infra, milestone:m0, size:l]
status: Not Started
---

# TASK-015: Constitution CI gate (invariant enforcement)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-003`](../features/FEAT-003-ai-engineering-substrate.md) — AI engineering substrate &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **AI engineering substrate** (FEAT-003). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-006` — GitHub Actions PR workflow (lint/typecheck/test/build)

## Expected output

A CI check enforcing the five invariants

## Acceptance criteria

- [ ] A deliberately bad PR (free-text clinical column, missing RLS, missing audit) is blocked with a clear, actionable message

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:infra`, `milestone:m0`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** FEAT-003
- **Project fields:** Type=Task, ID=TASK-015, Feature=FEAT-003, Priority=Critical, Size=L (2 days), Area=infra, Milestone=M0, Status=Not Started
