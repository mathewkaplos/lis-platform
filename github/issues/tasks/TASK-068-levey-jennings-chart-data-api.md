---
id: TASK-068
type: task
title: "Levey-Jennings chart data API"
feature: FEAT-019
epic: EPIC-004
milestone: M5
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-067]
labels: [type:task, priority:critical, area:backend, milestone:m5, size:m]
status: Not Started
---

# TASK-068: Levey-Jennings chart data API

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-019`](../features/FEAT-019-levey-jennings-westgard-engine.md) — Levey-Jennings + Westgard engine &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Levey-Jennings + Westgard engine** (FEAT-019). Follow
the Engineering Operations Manual workflow: orient → (research if novel) → (ADR if load-bearing) →
load Skills → **write and get approval for the Implementation Proposal covering this task's parent
feature** → implement this task as one reviewed slice → test → commit → review → merge.

A read endpoint returning a control lot's ordered QC points, its target mean/SD band, and each
point's violation flags (from TASK-067's `qc_rule_violation`) — the data shape TASK-069's chart
needs. Not yet specified in the Implementation Proposal (to be added as a revision once TASK-067 is
real, per FEAT-018's own "specified once the prior task exists" precedent).

## Dependencies

- `TASK-067` — Westgard multirule evaluation engine

## Expected output

A chart-data read endpoint for a control lot's Levey-Jennings series + violation flags

## Acceptance criteria

- [ ] Control values, plus mean ± 1/2/3 SD bands, are queryable for a given control lot
- [ ] Each returned point carries any `qc_rule_violation` detected for it
- [ ] Queryable independently of patient results, matching FEAT-018's own established pattern

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit/integration tests pass; RLS isolation confirmed
- [ ] No violation of the five Constitution invariants
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m5`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-019
- **Project fields:** Type=Task, ID=TASK-068, Feature=FEAT-019, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M5, Status=Not Started
