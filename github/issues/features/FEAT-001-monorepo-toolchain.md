---
id: FEAT-001
type: feature
title: "Monorepo & toolchain"
epic: EPIC-001
milestone: M0
priority: Critical
effort_days: 2.5
area: infra
dependencies: []
labels: [type:feature, priority:critical, area:infra, milestone:m0]
status: Not Started
---

# FEAT-001: Monorepo & toolchain

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-001`](../epics/EPIC-001-platform-foundation.md) — Platform Foundation &nbsp;·&nbsp;
**Milestone:** M0 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~2.5 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

One repository structure every future task assumes.

## Dependencies

None.

## Required Skills

- `engineering/repo-scaffold`

## Architecture documents to reference

- KB-05 System Architecture
- KB-47 Deployment Pipeline

## ADRs to reference

- `ADR-0001` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] pnpm workspaces build successfully across all apps/packages
- [ ] Shared tsconfig/eslint/prettier presets applied and enforced
- [ ] apps/api and apps/web both scaffolded and buildable
- [ ] packages/domain, packages/ui, packages/config exist with working cross-package imports
- [ ] Local dev stack (Postgres+Valkey) runs via docker compose up

## Tasks

- [ ] `TASK-001` — Init pnpm monorepo, workspaces, shared presets (M (1 day))
- [ ] `TASK-002` — Scaffold apps/api (NestJS+Fastify) with /health (S (0.5 day))
- [ ] `TASK-003` — Scaffold apps/web (Next.js+Tailwind) (S (0.5 day))
- [ ] `TASK-004` — Create packages/domain, ui, config stubs (S (0.5 day))
- [ ] `TASK-005` — Docker Compose: Postgres 16 + Valkey; db:reset (S (0.5 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-001-monorepo-toolchain.md`

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

`type:feature`, `priority:critical`, `area:infra`, `milestone:m0`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** EPIC-001
- **Project fields:** Type=Feature, ID=FEAT-001, Epic=EPIC-001, Priority=Critical, Effort=2.5d, Area=infra, Milestone=M0, Status=Not Started
