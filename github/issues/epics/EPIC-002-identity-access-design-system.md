---
id: EPIC-002
type: epic
title: "Identity, Access & Design System"
milestone: "M2"
priority: Critical
dependencies: [EPIC-001]
labels: [type:epic, priority:critical, roadmap]
status: Not Started
---

# EPIC-002: Identity, Access & Design System

**Type:** Epic &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Milestone(s):** M2 &nbsp;·&nbsp; **Status:** Not Started

## Description

Adds authentication (Keycloak/OIDC), authorization (RBAC, entry-vs-verification split), the hash-chained audit trail, and the design system (tokens + six primitives) that every screen thereafter composes from.

## Outcome

A secure, tenant-isolated app with one coherent visual language.

## Dependencies

- `EPIC-001` — Platform Foundation

## Features in this epic

- [ ] `FEAT-008` — Authentication (Keycloak/OIDC) (Milestone M2)
- [ ] `FEAT-009` — Authorization & audit (Milestone M2)
- [ ] `FEAT-010` — Design system v1 (Milestone M2)

## Acceptance criteria (epic-level)

- [ ] All features listed above are merged and individually demoed
- [ ] The milestone(s) this epic spans have been demoed to the design-partner lab
- [ ] No violation of the five Constitution invariants was introduced anywhere in this epic
- [ ] Relevant ADRs are ratified and the knowledge base updated where authorized

## Definition of Done

- [ ] Every child feature meets its own Definition of Done
- [ ] The epic's outcome statement is demonstrably true in the deployed staging environment
- [ ] Epic closed only after its terminating milestone's exit criteria are met

## Labels

`type:epic`, `priority:critical`, `roadmap`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Project fields:** Type=Epic, ID=EPIC-002, Priority=Critical, Milestone=M2, Status=Not Started
