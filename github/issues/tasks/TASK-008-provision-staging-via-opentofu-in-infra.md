---
id: TASK-008
type: task
title: "Provision staging via OpenTofu in infra/"
feature: FEAT-002
epic: EPIC-001
milestone: M0
priority: Critical
size: "L (2 days)"
area: infra
dependencies: [TASK-007]
labels: [type:task, priority:critical, area:infra, milestone:m0, size:l]
status: Not Started
---

# TASK-008: Provision staging via OpenTofu in infra/

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-002`](../features/FEAT-002-ci-cd-environments.md) — CI/CD & environments &nbsp;·&nbsp;
**Epic:** EPIC-001 — Platform Foundation &nbsp;·&nbsp; **Milestone:** M0 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **CI/CD & environments** (FEAT-002). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-007` — Multi-stage Dockerfiles for api and web

## Expected output

infra/ OpenTofu modules for staging

## Acceptance criteria

- [ ] tofu apply creates a working staging environment from a clean state

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:infra`, `milestone:m0`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** FEAT-002
- **Project fields:** Type=Task, ID=TASK-008, Feature=FEAT-002, Priority=Critical, Size=L (2 days), Area=infra, Milestone=M0, Status=Not Started
