---
id: TASK-058
type: task
title: "Config template → HTML → PDF (hash-stamped)"
feature: FEAT-016
epic: EPIC-004
milestone: M4
priority: Critical
size: "L (2 days)"
area: backend
dependencies: [TASK-055]
labels: [type:task, priority:critical, area:backend, milestone:m4, size:l]
status: Not Started
---

# TASK-058: Config template → HTML → PDF (hash-stamped)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-016`](../features/FEAT-016-minimal-report.md) — Minimal report &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M4 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Minimal report** (FEAT-016). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-055` — Verification action + append-only versioning

## Expected output

PDF rendering pipeline

## Acceptance criteria

- [ ] Output is deterministic and the content hash is recorded with the report

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m4`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** FEAT-016
- **Project fields:** Type=Task, ID=TASK-058, Feature=FEAT-016, Priority=Critical, Size=L (2 days), Area=backend, Milestone=M4, Status=Not Started
