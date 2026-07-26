---
id: TASK-042
type: task
title: "API: create order + ordered tests; cancel action"
feature: FEAT-012
epic: EPIC-003
milestone: M3
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-039]
labels: [type:task, priority:critical, area:backend, milestone:m3, size:m]
status: Not Started
---

# TASK-042: API: create order + ordered tests; cancel action

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-012`](../features/FEAT-012-order-entry.md) — Order entry &nbsp;·&nbsp;
**Epic:** EPIC-003 — Pre-Analytical Workflow &nbsp;·&nbsp; **Milestone:** M3 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Order entry** (FEAT-012). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-039` — API: create/search/get patient (Zod + OpenAPI)

## Expected output

Order API endpoints

## Acceptance criteria

- [ ] Cancellation is implemented as an action sub-resource, never a status PATCH

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
- **Parent issue:** FEAT-012
- **Project fields:** Type=Task, ID=TASK-042, Feature=FEAT-012, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M3, Status=Not Started
