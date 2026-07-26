---
id: FEAT-005
type: feature
title: "Observation store"
epic: EPIC-001
milestone: M1
priority: Critical
effort_days: 5
area: db
dependencies: [FEAT-004]
labels: [type:feature, priority:critical, area:db, milestone:m1]
status: Not Started
---

# FEAT-005: Observation store

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-001`](../epics/EPIC-001-platform-foundation.md) — Platform Foundation &nbsp;·&nbsp;
**Milestone:** M1 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~5 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

The heart of the product: the type-partitioned, structured result store.

## Dependencies

- `FEAT-004` — Catalog metadata model

## Required Skills

- `engineering/database-design`
- `domain/result-verification`

## Architecture documents to reference

- KB-06 Database Architecture
- KB-14 Result Engine

## ADRs to reference

- `ADR-0005` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] Numeric, coded, and text-type results all persist correctly via the value_type discriminator
- [ ] An attempted UPDATE of a verified observation row fails (append-only enforced)
- [ ] A 5-year patient/analyte trend query returns correct results in under 100ms on seeded volume
- [ ] reference_range_snapshot is captured immutably on every observation at write time

## Tasks

- [ ] `TASK-020` — Migration: observation (type-partitioned values) (L (2 days))
- [ ] `TASK-021` — Append-only enforcement + result_history (M (1 day))
- [ ] `TASK-022` — Partitioning + trend indexes on observation (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-005-observation-store.md`

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

`type:feature`, `priority:critical`, `area:db`, `milestone:m1`

## GitHub metadata

- **Milestone (GitHub):** M1
- **Parent issue:** EPIC-001
- **Project fields:** Type=Feature, ID=FEAT-005, Epic=EPIC-001, Priority=Critical, Effort=5d, Area=db, Milestone=M1, Status=Not Started
