---
id: TASK-012
type: task
title: "Scaffold lis-engineering repo; import 56-doc KB"
feature: FEAT-003
epic: EPIC-001
milestone: M0
priority: Critical
size: "M (1 day)"
area: ai
dependencies: []
labels: [type:task, priority:critical, area:ai, milestone:m0, size:m]
status: Not Started
---

# TASK-012: Scaffold lis-engineering repo; import 56-doc KB

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-003`](../features/FEAT-003-ai-engineering-substrate.md) — AI engineering substrate &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **AI engineering substrate** (FEAT-003). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

None.

## Expected output

lis-engineering repository pushed to GitHub

## Acceptance criteria

- [ ] All 56 knowledge-base documents are present and readable in knowledge-base/

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:ai`, `milestone:m0`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** FEAT-003
- **Project fields:** Type=Task, ID=TASK-012, Feature=FEAT-003, Priority=Critical, Size=M (1 day), Area=ai, Milestone=M0, Status=Not Started
