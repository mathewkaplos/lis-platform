---
id: FEAT-017
type: feature
title: "Minimal worklist"
epic: EPIC-004
milestone: M4
priority: High
effort_days: 3
area: fullstack
dependencies: [FEAT-014]
labels: [type:feature, priority:high, area:fullstack, milestone:m4]
status: Not Started
---

# FEAT-017: Minimal worklist

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-004`](../epics/EPIC-004-analytical-core.md) — Analytical Core &nbsp;·&nbsp;
**Milestone:** M4 &nbsp;·&nbsp; **Priority:** High &nbsp;·&nbsp; **Effort:** ~3 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

The technologist's home screen — without it, result entry has no usable entry point.

## Dependencies

- `FEAT-014` — Result entry engine

## Required Skills

- `engineering/api-design`

## Architecture documents to reference

- KB-26 Task Management

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

- §8.0 Work Queue master

## Acceptance criteria

- [ ] Worklist returns correct counts per stage (pending/in-progress/verified)
- [ ] A technologist goes from login to entering a result in two clicks or fewer

## Tasks

- [ ] `TASK-061` — Worklist query API with filters + TAT (M (1 day))
- [ ] `TASK-062` — Worklist UI (tabs, filters, priority, TAT) (L (2 days))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-017-minimal-worklist.md`

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

`type:feature`, `priority:high`, `area:fullstack`, `milestone:m4`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Parent issue:** EPIC-004
- **Project fields:** Type=Feature, ID=FEAT-017, Epic=EPIC-004, Priority=High, Effort=3d, Area=fullstack, Milestone=M4, Status=Not Started
