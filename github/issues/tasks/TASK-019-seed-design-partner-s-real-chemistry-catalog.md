---
id: TASK-019
type: task
title: "Seed design partner's real chemistry catalog"
feature: FEAT-004
epic: EPIC-001
milestone: M1
priority: High
size: "M (1 day)"
area: db
dependencies: [TASK-018]
labels: [type:task, priority:high, area:db, milestone:m1, size:m]
status: Not Started
---

# TASK-019: Seed design partner's real chemistry catalog

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-004`](../features/FEAT-004-catalog-metadata-model.md) — Catalog metadata model &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Catalog metadata model** (FEAT-004). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-018` — Migration: reference_range (sex/age/method/criticals/versioned)

## Expected output

db/seed/chemistry-catalog.sql

## Acceptance criteria

- [ ] The partner's actual chemistry test menu is present and queryable

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
- **Parent issue:** FEAT-004
- **Project fields:** Type=Task, ID=TASK-019, Feature=FEAT-004, Priority=High, Size=M (1 day), Area=db, Milestone=M1, Status=Not Started
