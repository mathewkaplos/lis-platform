---
id: TASK-029
type: task
title: "API auth guard: JWT validation, tenant/user context"
feature: FEAT-008
epic: EPIC-002
milestone: M2
priority: Critical
size: "M (1 day)"
area: backend
dependencies: [TASK-028]
labels: [type:task, priority:critical, area:backend, milestone:m2, size:m]
status: Not Started
---

# TASK-029: API auth guard: JWT validation, tenant/user context

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-008`](../features/FEAT-008-authentication-keycloak-oidc.md) — Authentication (Keycloak/OIDC) &nbsp;·&nbsp;
**Epic:** EPIC-002 — Identity, Access & Design System &nbsp;·&nbsp; **Milestone:** M2 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1 day) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Authentication (Keycloak/OIDC)** (FEAT-008). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-028` — Deploy Keycloak; realm, clients, roles

## Expected output

NestJS auth guard + request context

## Acceptance criteria

- [ ] An unauthenticated request returns 401; a valid token resolves correct tenant and user

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
- **Project fields:** Type=Task, ID=TASK-029, Feature=FEAT-008, Priority=Critical, Size=M (1 day), Area=backend, Milestone=M2, Status=Not Started
