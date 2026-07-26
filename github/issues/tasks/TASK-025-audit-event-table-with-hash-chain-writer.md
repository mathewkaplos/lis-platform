---
id: TASK-025
type: task
title: "audit_event table with hash chain + writer"
feature: FEAT-006
epic: EPIC-001
milestone: M1
priority: Critical
size: "M (1 day)"
area: db
dependencies: [TASK-024]
labels: [type:task, priority:critical, area:db, milestone:m1, size:m]
status: Not Started
---

# TASK-025: audit_event table with hash chain + writer

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-006`](../features/FEAT-006-order-specimen-tenancy-spine.md) — Order, specimen & tenancy spine &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Order, specimen & tenancy spine** (FEAT-006). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-024` — tenant_id + RLS policies on all tenant tables

## Expected output

db/migrations/000X_audit_event.sql + writer service

## Acceptance criteria

- [ ] Tampering with an audit row is detected by chain verification

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
- **Parent issue:** FEAT-006
- **Project fields:** Type=Task, ID=TASK-025, Feature=FEAT-006, Priority=Critical, Size=M (1 day), Area=db, Milestone=M1, Status=Not Started
