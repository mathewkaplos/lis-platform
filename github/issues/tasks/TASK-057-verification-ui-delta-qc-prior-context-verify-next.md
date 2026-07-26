---
id: TASK-057
type: task
title: "Verification UI (delta/QC/prior context, verify+next)"
feature: FEAT-015
epic: EPIC-004
milestone: M4
priority: Critical
size: "M (1 day)"
area: frontend
dependencies: [TASK-055]
labels: [type:task, priority:critical, area:frontend, milestone:m4, size:m]
status: Not Started
---

# TASK-057: Verification UI (delta/QC/prior context, verify+next)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-015`](../features/FEAT-015-verification-criticals.md) — Verification & criticals &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M4 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Verification & criticals** (FEAT-015). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-055` — Verification action + append-only versioning

## Expected output

Verification screen

## Acceptance criteria

- [ ] A verifier can review and release a panel in under 30 seconds

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:frontend`, `milestone:m4`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** FEAT-015
- **Project fields:** Type=Task, ID=TASK-057, Feature=FEAT-015, Priority=Critical, Size=M (1 day), Area=frontend, Milestone=M4, Status=Not Started
