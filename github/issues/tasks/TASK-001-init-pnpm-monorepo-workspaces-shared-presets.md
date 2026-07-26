---
id: TASK-001
type: task
title: "Init pnpm monorepo, workspaces, shared presets"
feature: FEAT-001
epic: EPIC-001
milestone: M0
priority: Critical
size: "M (1 day)"
area: infra
dependencies: []
labels: [type:task, priority:critical, area:infra, milestone:m0, size:m]
status: Not Started
---

# TASK-001: Init pnpm monorepo, workspaces, shared presets

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-001`](../features/FEAT-001-monorepo-toolchain.md) — Monorepo & toolchain &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Monorepo & toolchain** (FEAT-001). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

None.

## Expected output

pnpm install && pnpm build succeeds at repo root

## Acceptance criteria

- [ ] Both apps and all packages build with zero errors
- [ ] Shared eslint/tsconfig/prettier presets are applied and enforced

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
- **Parent issue:** FEAT-001
- **Project fields:** Type=Task, ID=TASK-001, Feature=FEAT-001, Priority=Critical, Size=M (1 day), Area=infra, Milestone=M0, Status=Not Started
