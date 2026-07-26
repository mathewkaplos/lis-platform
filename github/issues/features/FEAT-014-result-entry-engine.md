---
id: FEAT-014
type: feature
title: "Result entry engine"
epic: EPIC-004
milestone: M4
priority: Critical
effort_days: 8
area: fullstack
dependencies: [FEAT-013]
labels: [type:feature, priority:critical, area:fullstack, milestone:m4]
status: Not Started
---

# FEAT-014: Result entry engine

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-004`](../epics/EPIC-004-analytical-core.md) — Analytical Core &nbsp;·&nbsp;
**Milestone:** M4 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~8 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

The flagship screen: structured capture for any analyte, rendered from metadata.

## Dependencies

- `FEAT-013` — Accessioning, labels & reception

## Required Skills

- `domain/clinical-chemistry`
- `domain/reference-ranges`
- `engineering/api-design`

## Architecture documents to reference

- KB-14 Result Engine
- KB-15 Reference Ranges
- KB-16 Laboratory Disciplines

## ADRs to reference

- `ADR-0010` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

- §9.1 Dynamic Result Entry

## Acceptance criteria

- [ ] Golden dataset passes for range resolution across sex/age/method dimensions
- [ ] Boundary values (exactly at threshold) flag correctly per the golden dataset
- [ ] A full chemistry panel can be entered without touching the mouse
- [ ] Calculated fields (e.g. eGFR, LDL) recompute correctly server-side when a dependency changes

## Tasks

- [ ] `TASK-049` — Range-resolution service + snapshot onto observation (L (2 days))
- [ ] `TASK-050` — Flagging service (N/H/L/HH/LL) with boundary correctness (M (1 day))
- [ ] `TASK-051` — Result entry API (draft/submit, typed values) (L (2 days))
- [ ] `TASK-052` — Result entry UI (analyte grid, live flags, autosave) (L (2 days))
- [ ] `TASK-053` — Calculated fields (eGFR, LDL) server-side (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-014-result-entry-engine.md`

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

`type:feature`, `priority:critical`, `area:fullstack`, `milestone:m4`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** EPIC-004
- **Project fields:** Type=Feature, ID=FEAT-014, Epic=EPIC-004, Priority=Critical, Effort=8d, Area=fullstack, Milestone=M4, Status=Not Started
