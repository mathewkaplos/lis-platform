---
id: TASK-006
type: task
title: "GitHub Actions PR workflow (lint/typecheck/test/build)"
feature: FEAT-002
epic: EPIC-001
milestone: M0
priority: Critical
size: "M (1 day)"
area: infra
dependencies: [TASK-001]
labels: [type:task, priority:critical, area:infra, milestone:m0, size:m]
status: Not Started
---

# TASK-006: GitHub Actions PR workflow (lint/typecheck/test/build)

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-002`](../features/FEAT-002-ci-cd-environments.md) — CI/CD & environments &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **CI/CD & environments** (FEAT-002). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-001` — Init pnpm monorepo, workspaces, shared presets

## Expected output

.github/workflows/pr.yml

## Acceptance criteria

- [ ] A red check on any step blocks merge on a protected main branch

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:infra`, `milestone:m0`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** FEAT-002
- **Project fields:** Type=Task, ID=TASK-006, Feature=FEAT-002, Priority=Critical, Size=M (1 day), Area=infra, Milestone=M0, Status=Not Started
