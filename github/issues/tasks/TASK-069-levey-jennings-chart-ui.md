---
id: TASK-069
type: task
title: "Levey-Jennings chart UI"
feature: FEAT-019
epic: EPIC-004
milestone: M5
priority: Critical
size: "M (1-2 days)"
area: frontend
dependencies: [TASK-068]
labels: [type:task, priority:critical, area:frontend, milestone:m5, size:m]
status: Not Started
---

# TASK-069: Levey-Jennings chart UI

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-019`](../features/FEAT-019-levey-jennings-westgard-engine.md) — Levey-Jennings + Westgard engine &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1-2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Levey-Jennings + Westgard engine** (FEAT-019). Follow
the Engineering Operations Manual workflow: orient → (research if novel) → (ADR if load-bearing) →
load Skills → **write and get approval for the Implementation Proposal covering this task's parent
feature** → implement this task as one reviewed slice → test → commit → review → merge.

The Levey-Jennings chart itself (Stitch §14.2 QC Charts, §14.4 Levey-Jennings) plus a Westgard
violation indicator (§14.5) — the feature's only frontend surface, consuming TASK-068's chart-data
endpoint. Not yet specified in the Implementation Proposal (to be added as a revision once TASK-068
is real).

## Dependencies

- `TASK-068` — Levey-Jennings chart data API

## Expected output

A Levey-Jennings chart screen/component plotting control values against mean ± 1/2/3 SD bands, with
Westgard violations visibly flagged

## Acceptance criteria

- [ ] Levey-Jennings chart correctly plots control values against mean ± 1/2/3 SD bands
- [ ] Westgard rule violations are visibly flagged on the chart
- [ ] Composed from existing `packages/ui` primitives wherever a suitable pattern exists; all four
      states (populated, empty, loading, error) implemented; WCAG 2.2 AA + dark mode verified

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Manual test performed as the real user role
- [ ] No violation of the five Constitution invariants
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:frontend`, `milestone:m5`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-019
- **Project fields:** Type=Task, ID=TASK-069, Feature=FEAT-019, Priority=Critical, Size=M (1-2 days), Area=frontend, Milestone=M5, Status=Not Started
