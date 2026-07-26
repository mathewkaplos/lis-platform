---
id: TASK-061
type: task
title: "Worklist query API with filters + TAT"
feature: FEAT-017
epic: EPIC-004
milestone: M4
priority: High
size: "M (1 day)"
area: backend
dependencies: [TASK-051]
labels: [type:task, priority:high, area:backend, milestone:m4, size:m]
status: Not Started
---

# TASK-061: Worklist query API with filters + TAT

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-017`](../features/FEAT-017-minimal-worklist.md) — Minimal worklist &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M4 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Minimal worklist** (FEAT-017). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-051` — Result entry API (draft/submit, typed values)

## Expected output

Worklist query API

## Acceptance criteria

- [ ] Returns correct counts and filters correctly per stage

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:high`, `area:backend`, `milestone:m4`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** FEAT-017
- **Project fields:** Type=Task, ID=TASK-061, Feature=FEAT-017, Priority=High, Size=M (1 day), Area=backend, Milestone=M4, Status=Not Started
