---
id: TASK-037
type: task
title: "Storybook + axe a11y check in CI"
feature: FEAT-010
epic: EPIC-002
milestone: M2
priority: High
size: "S (0.5 day)"
area: frontend
dependencies: [TASK-035]
labels: [type:task, priority:high, area:frontend, milestone:m2, size:s]
status: Not Started
---

# TASK-037: Storybook + axe a11y check in CI

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-010`](../features/FEAT-010-design-system-v1.md) — Design system v1 &nbsp;·&nbsp;
**Epic:** EPIC-002 — Identity, Access & Design System &nbsp;·&nbsp; **Milestone:** M2 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** S (0.5 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Design system v1** (FEAT-010). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-035` — Build 6 primitives (DataTable, StatusPill, FilterBar, SlideOver, StatCard, FormField)

## Expected output

Storybook config + CI a11y step

## Acceptance criteria

- [ ] CI fails when a WCAG AA violation is introduced into a primitive

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:high`, `area:frontend`, `milestone:m2`, `size:s`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Parent issue:** FEAT-010
- **Project fields:** Type=Task, ID=TASK-037, Feature=FEAT-010, Priority=High, Size=S (0.5 day), Area=frontend, Milestone=M2, Status=Not Started
