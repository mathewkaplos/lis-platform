---
id: TASK-038
type: task
title: "Migration: patient + identifiers + alerts"
feature: FEAT-011
epic: EPIC-003
milestone: M3
priority: Critical
size: "M (1 day)"
area: db
dependencies: [TASK-024]
labels: [type:task, priority:critical, area:db, milestone:m3, size:m]
status: Not Started
---

# TASK-038: Migration: patient + identifiers + alerts

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-011`](../features/FEAT-011-patient-management.md) — Patient management &nbsp;·&nbsp;
**Epic:** EPIC-003 — Pre-Analytical Workflow &nbsp;·&nbsp; **Milestone:** M3 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Patient management** (FEAT-011). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-024` — tenant_id + RLS policies on all tenant tables

## Expected output

db/migrations/000X_patient.sql

## Acceptance criteria

- [ ] A patient is queryable by both national ID and MRN

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:db`, `milestone:m3`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M3
- **Parent issue:** FEAT-011
- **Project fields:** Type=Task, ID=TASK-038, Feature=FEAT-011, Priority=Critical, Size=M (1 day), Area=db, Milestone=M3, Status=Not Started
