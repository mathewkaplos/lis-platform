---
id: TASK-034
type: task
title: "Stitch reference screens; extract tokens to packages/ui"
feature: FEAT-010
epic: EPIC-002
milestone: M2
priority: Critical
size: "M (1 day)"
area: design
dependencies: [TASK-031]
labels: [type:task, priority:critical, area:design, milestone:m2, size:m]
status: Not Started
---

# TASK-034: Stitch reference screens; extract tokens to packages/ui

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-010`](../features/FEAT-010-design-system-v1.md) — Design system v1 &nbsp;·&nbsp;
**Epic:** EPIC-002 — Identity, Access & Design System &nbsp;·&nbsp; **Milestone:** M2 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Design system v1** (FEAT-010). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-031` — Web auth: login, session, protected routes, sign-out

## Expected output

docs/design.md + packages/ui/tokens.ts

## Acceptance criteria

- [ ] Design tokens documented for light and dark and applied consistently

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:design`, `milestone:m2`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Parent issue:** FEAT-010
- **Project fields:** Type=Task, ID=TASK-034, Feature=FEAT-010, Priority=Critical, Size=M (1 day), Area=design, Milestone=M2, Status=Not Started
