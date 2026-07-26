---
id: FEAT-015
type: feature
title: "Verification & criticals"
epic: EPIC-004
milestone: M4
priority: Critical
effort_days: 4
area: backend
dependencies: [FEAT-014]
labels: [type:feature, priority:critical, area:backend, milestone:m4]
status: Not Started
---

# FEAT-015: Verification & criticals

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-004`](../epics/EPIC-004-analytical-core.md) — Analytical Core &nbsp;·&nbsp;
**Milestone:** M4 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~4 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

The safety gate: criticals never auto-verify and always block finalization until acknowledged.

## Dependencies

- `FEAT-014` — Result entry engine

## Required Skills

- `domain/critical-values`
- `domain/result-verification`

## Architecture documents to reference

- KB-14 Result Engine
- KB-34 Notification System

## ADRs to reference

- `ADR-0011` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] Golden dataset passes for HH/LL critical detection
- [ ] A verified observation is provably immutable; amendment creates a new version
- [ ] Report finalization returns 409 while any critical remains unacknowledged (integration-tested)
- [ ] A verifier can review and release a panel in under 30 seconds using the provided context

## Tasks

- [ ] `TASK-054` — Critical detection + CriticalValueDetected event (M (1 day))
- [ ] `TASK-055` — Verification action + append-only versioning (M (1 day))
- [ ] `TASK-056` — Finalization block on unacknowledged critical (409) (M (1 day))
- [ ] `TASK-057` — Verification UI (delta/QC/prior context, verify+next) (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-015-verification-criticals.md`

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

`type:feature`, `priority:critical`, `area:backend`, `milestone:m4`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** EPIC-004
- **Project fields:** Type=Feature, ID=FEAT-015, Epic=EPIC-004, Priority=Critical, Effort=4d, Area=backend, Milestone=M4, Status=Not Started
