---
id: TASK-030
type: task
title: "Bind RLS session variable to authenticated tenant"
feature: FEAT-008
epic: EPIC-002
milestone: M2
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-029]
labels: [type:task, priority:critical, area:backend, milestone:m2, size:m]
status: Not Started
---

# TASK-030: Bind RLS session variable to authenticated tenant

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-008`](../features/FEAT-008-authentication-keycloak-oidc.md) — Authentication (Keycloak/OIDC) &nbsp;·&nbsp;
**Epic:** EPIC-002 — Identity, Access & Design System &nbsp;·&nbsp; **Milestone:** M2 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Authentication (Keycloak/OIDC)** (FEAT-008). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-029` — API auth guard: JWT validation, tenant/user context

## Expected output

Tenant context correctly bound per request

## Acceptance criteria

- [ ] The RLS isolation test passes when exercised through the live API, not only in SQL

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m2`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Parent issue:** FEAT-008
- **Project fields:** Type=Task, ID=TASK-030, Feature=FEAT-008, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M2, Status=Not Started
