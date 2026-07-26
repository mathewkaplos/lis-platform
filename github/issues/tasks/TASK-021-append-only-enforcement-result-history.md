---
id: TASK-021
type: task
title: "Append-only enforcement + result_history"
feature: FEAT-005
epic: EPIC-001
milestone: M1
priority: Critical
size: "M (1 day)"
area: db
dependencies: [TASK-020]
labels: [type:task, priority:critical, area:db, milestone:m1, size:m]
status: Not Started
---

# TASK-021: Append-only enforcement + result_history

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-005`](../features/FEAT-005-observation-store.md) — Observation store &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Observation store** (FEAT-005). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-020` — Migration: observation (type-partitioned values)

## Expected output

Trigger or service-layer guard preventing mutation of verified rows

## Acceptance criteria

- [ ] An attempted UPDATE of a verified observation fails and is logged

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:db`, `milestone:m1`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M1
- **Parent issue:** FEAT-005
- **Project fields:** Type=Task, ID=TASK-021, Feature=FEAT-005, Priority=Critical, Size=M (1 day), Area=db, Milestone=M1, Status=Not Started
