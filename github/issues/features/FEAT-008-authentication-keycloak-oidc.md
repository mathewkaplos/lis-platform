---
id: FEAT-008
type: feature
title: "Authentication (Keycloak/OIDC)"
epic: EPIC-002
milestone: M2
priority: Critical
effort_days: 6
area: backend
dependencies: [FEAT-006]
labels: [type:feature, priority:critical, area:backend, milestone:m2]
status: Not Started
---

# FEAT-008: Authentication (Keycloak/OIDC)

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-002`](../epics/EPIC-002-identity-access-design-system.md) — Identity, Access & Design System &nbsp;·&nbsp;
**Milestone:** M2 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~6 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Real, provable identity before any clinical write is possible.

## Dependencies

- `FEAT-006` — Order, specimen & tenancy spine

## Required Skills

- `engineering/authentication`

## Architecture documents to reference

- KB-09 Identity Architecture
- KB-37 Security

## ADRs to reference

- `ADR-0007` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

- §2.1 Login
- §2.5 Organization Selection
- §2.6 Branch Selection

## Acceptance criteria

- [ ] Keycloak issues a valid token for a test user against the configured realm
- [ ] Unauthenticated API requests return 401
- [ ] Authenticated tenant context is correctly resolved and bound to RLS
- [ ] Full login → authenticated app → logout flow works end-to-end in the browser

## Tasks

- [ ] `TASK-028` — Deploy Keycloak; realm, clients, roles (L (2 days))
- [ ] `TASK-029` — API auth guard: JWT validation, tenant/user context (M (1 day))
- [ ] `TASK-030` — Bind RLS session variable to authenticated tenant (M (1 day))
- [ ] `TASK-031` — Web auth: login, session, protected routes, sign-out (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-008-authentication-keycloak-oidc.md`

## Backend work

- [ ] API endpoints implemented per `standards/api-design.md` (action sub-resources, not status PATCH, where applicable)
- [ ] Domain logic covered by unit tests; edge cases and boundary values included

## Frontend work

- [ ] UI composed from existing `packages/ui` primitives wherever a suitable pattern exists
- [ ] All four states implemented: populated, empty, loading (skeleton), error
- [ ] Keyboard navigation and WCAG 2.2 AA contrast verified; dark mode verified

## Database work

- [ ] Migration(s) reviewed for RLS coverage on any new tenant-scoped table
- [ ] Append-only/versioning applied to any clinical data touched
- [ ] Migration runs up **and** down cleanly on seeded data

## Testing

- [ ] Unit tests cover logic and boundary cases
- [ ] Integration tests run against a real Postgres instance
- [ ] RLS isolation test added for any new tenant-scoped table
- [ ] Golden-dataset validation added/updated for any clinical logic (lab-reviewed where applicable)
- [ ] Manual test performed as the real user role

## Documentation updates

- [ ] PR description generated from the actual diff, referencing the Implementation Proposal and any ADR
- [ ] Relevant Skill(s) updated with anything the AI was corrected on
- [ ] Knowledge base updated **only** if an ADR authorized the change, in the same PR

## Definition of Done

- [ ] All tasks above complete and their acceptance criteria met
- [ ] None of the five Constitution invariants violated (verified in review, not assumed)
- [ ] Feature demoed on staging; design-partner feedback captured as follow-up issues where relevant
- [ ] Implementation Proposal archived with status `IMPLEMENTED` and the merge commit SHA

## Labels

`type:feature`, `priority:critical`, `area:backend`, `milestone:m2`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Parent issue:** EPIC-002
- **Project fields:** Type=Feature, ID=FEAT-008, Epic=EPIC-002, Priority=Critical, Effort=6d, Area=backend, Milestone=M2, Status=Not Started
