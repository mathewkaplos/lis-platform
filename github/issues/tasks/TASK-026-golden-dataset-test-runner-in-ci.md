---
id: TASK-026
type: task
title: "Golden-dataset test runner in CI"
feature: FEAT-007
epic: EPIC-001
milestone: M1
priority: High
size: "M (1 day)"
area: backend
dependencies: [TASK-020]
labels: [type:task, priority:high, area:backend, milestone:m1, size:m]
status: Not Started
---

# TASK-026: Golden-dataset test runner in CI

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-007`](../features/FEAT-007-clinical-validation-harness.md) — Clinical validation harness &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M1 &nbsp;·&nbsp;
**Priority:** High &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Clinical validation harness** (FEAT-007). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-020` — Migration: observation (type-partitioned values)

## Expected output

scripts/run-golden-datasets + CI step

## Acceptance criteria

- [ ] The runner executes in CI and fails loudly on any expected-value mismatch

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:high`, `area:backend`, `milestone:m1`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M1
- **Parent issue:** FEAT-007
- **Project fields:** Type=Task, ID=TASK-026, Feature=FEAT-007, Priority=High, Size=M (1 day), Area=backend, Milestone=M1, Status=Not Started
