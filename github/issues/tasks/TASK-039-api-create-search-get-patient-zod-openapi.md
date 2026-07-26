---
id: TASK-039
type: task
title: "API: create/search/get patient (Zod + OpenAPI)"
feature: FEAT-011
epic: EPIC-003
milestone: M3
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-038]
labels: [type:task, priority:critical, area:backend, milestone:m3, size:m]
status: Not Started
---

# TASK-039: API: create/search/get patient (Zod + OpenAPI)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-011`](../features/FEAT-011-patient-management.md) — Patient management &nbsp;·&nbsp;
**Epic:** EPIC-003 — Pre-Analytical Workflow &nbsp;·&nbsp; **Milestone:** M3 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Patient management** (FEAT-011). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-038` — Migration: patient + identifiers + alerts

## Expected output

Patient API endpoints, documented in OpenAPI

## Acceptance criteria

- [ ] Endpoints are RLS-enforced and validated via shared Zod schemas

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m3`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M3
- **Parent issue:** FEAT-011
- **Project fields:** Type=Task, ID=TASK-039, Feature=FEAT-011, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M3, Status=Not Started
