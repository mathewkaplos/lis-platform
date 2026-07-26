---
id: TASK-018
type: task
title: "Migration: reference_range (sex/age/method/criticals/versioned)"
feature: FEAT-004
epic: EPIC-001
milestone: M1
priority: Critical
size: "L (2 days)"
area: db
dependencies: [TASK-016]
labels: [type:task, priority:critical, area:db, milestone:m1, size:l]
status: Not Started
---

# TASK-018: Migration: reference_range (sex/age/method/criticals/versioned)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-004`](../features/FEAT-004-catalog-metadata-model.md) — Catalog metadata model &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Catalog metadata model** (FEAT-004). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-016` — Migration: analyte, unit, code_system_value

## Expected output

db/migrations/000X_reference_range.sql

## Acceptance criteria

- [ ] Range resolution returns the correct row for a 45-year-old male test case

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
- **Parent issue:** FEAT-004
- **Project fields:** Type=Task, ID=TASK-018, Feature=FEAT-004, Priority=Critical, Size=L (2 days), Area=db, Milestone=M1, Status=Not Started
