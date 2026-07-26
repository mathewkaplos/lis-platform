---
id: TASK-051
type: task
title: "Result entry API (draft/submit, typed values)"
feature: FEAT-014
epic: EPIC-004
milestone: M4
priority: Critical
size: "L (2 days)"
area: backend
dependencies: [TASK-050]
labels: [type:task, priority:critical, area:backend, milestone:m4, size:l]
status: Not Started
---

# TASK-051: Result entry API (draft/submit, typed values)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-014`](../features/FEAT-014-result-entry-engine.md) — Result entry engine &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M4 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Result entry engine** (FEAT-014). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-050` — Flagging service (N/H/L/HH/LL) with boundary correctness

## Expected output

Result entry API endpoints

## Acceptance criteria

- [ ] Numeric, coded, and text results all persist correctly per value_type

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m4`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** FEAT-014
- **Project fields:** Type=Task, ID=TASK-051, Feature=FEAT-014, Priority=Critical, Size=L (2 days), Area=backend, Milestone=M4, Status=Not Started
