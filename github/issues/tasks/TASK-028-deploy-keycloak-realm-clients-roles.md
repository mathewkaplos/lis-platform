---
id: TASK-028
type: task
title: "Deploy Keycloak; realm, clients, roles"
feature: FEAT-008
epic: EPIC-002
milestone: M2
priority: Critical
size: "L (2 days)"
area: infra
dependencies: [TASK-009]
labels: [type:task, priority:critical, area:infra, milestone:m2, size:l]
status: Not Started
---

# TASK-028: Deploy Keycloak; realm, clients, roles

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-008`](../features/FEAT-008-authentication-keycloak-oidc.md) — Authentication (Keycloak/OIDC) &nbsp;·&nbsp;
**Epic:** EPIC-002 — Identity, Access & Design System &nbsp;·&nbsp; **Milestone:** M2 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Authentication (Keycloak/OIDC)** (FEAT-008). Follow the Engineering Operations
Manual workflow: orient → (research if novel) → (ADR if load-bearing) → load Skills → **write and get approval
for the Implementation Proposal covering this task's parent feature** → implement this task as one reviewed slice
→ test → commit → review → merge.

## Dependencies

- `TASK-009` — Deploy-on-merge workflow + smoke test

## Expected output

Running Keycloak instance with the LIS realm configured

## Acceptance criteria

- [ ] A test user can obtain a valid token against the configured realm

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal
- [ ] Unit tests pass; any clinical logic touched has golden-dataset coverage
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:infra`, `milestone:m2`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Parent issue:** FEAT-008
- **Project fields:** Type=Task, ID=TASK-028, Feature=FEAT-008, Priority=Critical, Size=L (2 days), Area=infra, Milestone=M2, Status=Not Started
