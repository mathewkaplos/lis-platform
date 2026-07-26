---
id: TASK-044
type: task
title: "Order list + detail screens"
feature: FEAT-012
epic: EPIC-003
milestone: M3
priority: High
size: "M (1 day)"
area: frontend
dependencies: [TASK-043]
labels: [type:task, priority:high, area:frontend, milestone:m3, size:m]
status: Not Started
---

# TASK-044: Order list + detail screens

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-012`](../features/FEAT-012-order-entry.md) — Order entry &nbsp;·&nbsp;
**Epic:** EPIC-003 — Pre-Analytical Workflow &nbsp;·&nbsp; **Milestone:** M3 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Order entry** (FEAT-012). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-043` — Order builder UI (catalog, panels, summary)

## Expected output

Order list + detail screens

## Acceptance criteria

- [ ] Filters by status/priority/date all return correct results

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:high`, `area:frontend`, `milestone:m3`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M3
- **Parent issue:** FEAT-012
- **Project fields:** Type=Task, ID=TASK-044, Feature=FEAT-012, Priority=High, Size=M (1 day), Area=frontend, Milestone=M3, Status=Not Started
