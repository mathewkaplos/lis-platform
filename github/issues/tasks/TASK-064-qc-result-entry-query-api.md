---
id: TASK-064
type: task
title: "QC result entry & query API"
feature: FEAT-018
epic: EPIC-004
milestone: M5
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-063]
labels: [type:task, priority:critical, area:backend, milestone:m5, size:m]
status: Not Started
---

# TASK-064: QC result entry & query API

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-018`](../features/FEAT-018-qc-materials-results-as-observations.md) — QC materials & results as Observations &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **QC materials & results as Observations** (FEAT-018).
Follow the Engineering Operations Manual workflow: orient → (research if novel) → (ADR if
load-bearing) → load Skills → **write and get approval for the Implementation Proposal covering
this task's parent feature** → implement this task as one reviewed slice → test → commit → review
→ merge.

Delivers a write path that inserts a QC Observation linked to a `control_lot` (reusing the
`enter_result` capability, per ADR-0015), and a read path proving FEAT-018's literal AC: QC results
are queryable independently of patient results while sharing the same underlying engine. Depends on
TASK-063's schema.

## Dependencies

- `TASK-063` — Control lot & QC observation schema

## Expected output

QC result entry + query API

## Acceptance criteria

- [ ] A QC result on a control material persists as an Observation with the correct linkage to the
      control lot
- [ ] QC results are queryable independently of patient results but share the same underlying engine

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m5`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-018
- **Project fields:** Type=Task, ID=TASK-064, Feature=FEAT-018, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M5, Status=Not Started
