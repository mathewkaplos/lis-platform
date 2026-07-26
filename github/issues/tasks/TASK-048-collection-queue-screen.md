---
id: TASK-048
type: task
title: "Collection queue screen"
feature: FEAT-013
epic: EPIC-003
milestone: M3
priority: High
size: "M (1 day)"
area: frontend
dependencies: [TASK-047]
labels: [type:task, priority:high, area:frontend, milestone:m3, size:m]
status: Not Started
---

# TASK-048: Collection queue screen

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-013`](../features/FEAT-013-accessioning-labels-reception.md) — Accessioning, labels & reception &nbsp;·&nbsp;
**Epic:** EPIC-003 — Pre-Analytical Workflow &nbsp;·&nbsp; **Milestone:** M3 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Accessioning, labels & reception** (FEAT-013). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-047` — Reception screen: scan-to-receive, coded rejection

## Expected output

Collection queue screen

## Acceptance criteria

- [ ] Pending collections list correctly with priority and required tubes

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
- **Parent issue:** FEAT-013
- **Project fields:** Type=Task, ID=TASK-048, Feature=FEAT-013, Priority=High, Size=M (1 day), Area=frontend, Milestone=M3, Status=Not Started
