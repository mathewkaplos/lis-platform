---
id: TASK-059
type: task
title: "Report data assembly with snapshotted ranges"
feature: FEAT-016
epic: EPIC-004
milestone: M4
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-058]
labels: [type:task, priority:critical, area:backend, milestone:m4, size:m]
status: Not Started
---

# TASK-059: Report data assembly with snapshotted ranges

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-016`](../features/FEAT-016-minimal-report.md) — Minimal report &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M4 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Minimal report** (FEAT-016). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-058` — Config template → HTML → PDF (hash-stamped)

## Expected output

Report assembly service

## Acceptance criteria

- [ ] A 2-year-old result renders using its originally snapshotted range, not the current one

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m4`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** FEAT-016
- **Project fields:** Type=Task, ID=TASK-059, Feature=FEAT-016, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M4, Status=Not Started
