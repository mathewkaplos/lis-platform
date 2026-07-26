---
id: TASK-016
type: task
title: "Migration: analyte, unit, code_system_value"
feature: FEAT-004
epic: EPIC-001
milestone: M1
priority: Critical
size: "M (1 day)"
area: db
dependencies: [TASK-005]
labels: [type:task, priority:critical, area:db, milestone:m1, size:m]
status: Not Started
---

# TASK-016: Migration: analyte, unit, code_system_value

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-004`](../features/FEAT-004-catalog-metadata-model.md) — Catalog metadata model &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Catalog metadata model** (FEAT-004). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-005` — Docker Compose: Postgres 16 + Valkey; db:reset

## Expected output

db/migrations/000X_catalog_base.sql

## Acceptance criteria

- [ ] A LOINC-coded analyte inserts and is queryable by its (system,code,version) tuple

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
- **Parent issue:** FEAT-004
- **Project fields:** Type=Task, ID=TASK-016, Feature=FEAT-004, Priority=Critical, Size=M (1 day), Area=db, Milestone=M1, Status=Not Started
