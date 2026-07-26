---
id: TASK-020
type: task
title: "Migration: observation (type-partitioned values)"
feature: FEAT-005
epic: EPIC-001
milestone: M1
priority: Critical
size: "L (2 days)"
area: db
dependencies: [TASK-018]
labels: [type:task, priority:critical, area:db, milestone:m1, size:l]
status: Not Started
---

# TASK-020: Migration: observation (type-partitioned values)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-005`](../features/FEAT-005-observation-store.md) — Observation store &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Observation store** (FEAT-005). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-018` — Migration: reference_range (sex/age/method/criticals/versioned)

## Expected output

db/migrations/000X_observation.sql

## Acceptance criteria

- [ ] Numeric, coded, and text results all persist correctly via the value_type discriminator

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:db`, `milestone:m1`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M1
- **Parent issue:** FEAT-005
- **Project fields:** Type=Task, ID=TASK-020, Feature=FEAT-005, Priority=Critical, Size=L (2 days), Area=db, Milestone=M1, Status=Not Started
