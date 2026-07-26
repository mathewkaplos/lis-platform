---
id: TASK-022
type: task
title: "Partitioning + trend indexes on observation"
feature: FEAT-005
epic: EPIC-001
milestone: M1
priority: High
size: "M (1 day)"
area: db
dependencies: [TASK-020]
labels: [type:task, priority:high, area:db, milestone:m1, size:m]
status: Not Started
---

# TASK-022: Partitioning + trend indexes on observation

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-005`](../features/FEAT-005-observation-store.md) — Observation store &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Observation store** (FEAT-005). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-020` — Migration: observation (type-partitioned values)

## Expected output

Time partitioning + supporting indexes

## Acceptance criteria

- [ ] A 5-year trend query for one patient/analyte runs in under 100ms on seeded volume

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:high`, `area:db`, `milestone:m1`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M1
- **Parent issue:** FEAT-005
- **Project fields:** Type=Task, ID=TASK-022, Feature=FEAT-005, Priority=High, Size=M (1 day), Area=db, Milestone=M1, Status=Not Started
