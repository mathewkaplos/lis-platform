---
id: TASK-002
type: task
title: "Scaffold apps/api (NestJS+Fastify) with /health"
feature: FEAT-001
epic: EPIC-001
milestone: M0
priority: Critical
size: "S (0.5 day)"
area: backend
dependencies: [TASK-001]
labels: [type:task, priority:critical, area:backend, milestone:m0, size:s]
status: Not Started
---

# TASK-002: Scaffold apps/api (NestJS+Fastify) with /health

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-001`](../features/FEAT-001-monorepo-toolchain.md) — Monorepo & toolchain &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** S (0.5 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Monorepo & toolchain** (FEAT-001). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-001` — Init pnpm monorepo, workspaces, shared presets

## Expected output

NestJS app running on the Fastify adapter

## Acceptance criteria

- [ ] GET /health returns 200 with the current build SHA locally

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m0`, `size:s`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** FEAT-001
- **Project fields:** Type=Task, ID=TASK-002, Feature=FEAT-001, Priority=Critical, Size=S (0.5 day), Area=backend, Milestone=M0, Status=Not Started
