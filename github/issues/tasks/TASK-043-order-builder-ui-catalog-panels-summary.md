---
id: TASK-043
type: task
title: "Order builder UI (catalog, panels, summary)"
feature: FEAT-012
epic: EPIC-003
milestone: M3
priority: Critical
size: "L (2 days)"
area: frontend
dependencies: [TASK-042]
labels: [type:task, priority:critical, area:frontend, milestone:m3, size:l]
status: Not Started
---

# TASK-043: Order builder UI (catalog, panels, summary)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-012`](../features/FEAT-012-order-entry.md) — Order entry &nbsp;·&nbsp;
**Epic:** EPIC-003 — Pre-Analytical Workflow &nbsp;·&nbsp; **Milestone:** M3 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Order entry** (FEAT-012). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-042` — API: create order + ordered tests; cancel action

## Expected output

Order creation screen

## Acceptance criteria

- [ ] Ordering a lipid panel creates the correct set of ordered_test rows

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:frontend`, `milestone:m3`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M3
- **Parent issue:** FEAT-012
- **Project fields:** Type=Task, ID=TASK-043, Feature=FEAT-012, Priority=Critical, Size=L (2 days), Area=frontend, Milestone=M3, Status=Not Started
