---
id: TASK-063
type: task
title: "Control lot & QC observation schema"
feature: FEAT-018
epic: EPIC-004
milestone: M5
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-020]
labels: [type:task, priority:critical, area:backend, milestone:m5, size:m]
status: Not Started
---

# TASK-063: Control lot & QC observation schema

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-018`](../features/FEAT-018-qc-materials-results-as-observations.md) — QC materials & results as Observations &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **QC materials & results as Observations** (FEAT-018).
Follow the Engineering Operations Manual workflow: orient → (research if novel) → (ADR if
load-bearing) → load Skills → **write and get approval for the Implementation Proposal covering
this task's parent feature** → implement this task as one reviewed slice → test → commit → review
→ merge.

Delivers ADR-0015's schema mechanism: a new `control_lot` table (tenant-scoped, RLS) and the
`observation` table widened with an `isControl` discriminator and nullable `patientId`/
`orderedTestId`/`specimenId`, enforced by a CHECK constraint. No HTTP surface — schema/migration
only; TASK-064 is the first real caller.

## Dependencies

- `TASK-020` — Observation type, partitioned values (the table this task modifies)

## Expected output

`control_lot` table + `observation` schema changes per ADR-0015

## Acceptance criteria

- [ ] `control_lot` exists, tenant-scoped, RLS-enforced, with a real FK to `analyte`
- [ ] `observation.isControl`/`controlLotId` exist; `patientId`/`orderedTestId`/`specimenId` are
      nullable; the `chk_observation_subject` CHECK constraint is enforced both directions
- [ ] Every existing patient-flow write path is unaffected (full existing e2e suite green)

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal and ADR-0015
- [ ] Unit tests pass; RLS isolation test added for the new tenant-scoped table
- [ ] Migration runs up **and** down cleanly on seeded data
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m5`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-018
- **Project fields:** Type=Task, ID=TASK-063, Feature=FEAT-018, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M5, Status=Not Started
