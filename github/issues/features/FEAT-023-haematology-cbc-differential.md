---
id: FEAT-023
type: feature
title: "Haematology CBC + differential"
epic: EPIC-004
milestone: M5
priority: Critical
effort_days: 5
area: fullstack
dependencies: [FEAT-014]
labels: [type:feature, priority:critical, area:fullstack, milestone:m5]
status: Not Started
---

# FEAT-023: Haematology CBC + differential

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-004`](../epics/EPIC-004-analytical-core.md) — Analytical Core &nbsp;·&nbsp;
**Milestone:** M5 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~5 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Prove the metadata model generalizes to a second discipline at low marginal cost.

## Dependencies

- `FEAT-014` — Result entry engine

## Required Skills

- `domain/haematology`

## Architecture documents to reference

- KB-19 Haematology

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

- §12.1 CBC Entry

## Acceptance criteria

- [ ] CBC panel enters correctly with age/sex-dependent ranges
- [ ] Differential sub-grid computes both % and calculated absolute counts correctly with flags

## Tasks

_Not yet decomposed — this feature belongs to a rolling-wave milestone (M5–M10) and will be broken into tasks at its milestone kickoff, per the Execution Plan §0._

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-023-haematology-cbc-differential.md`

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

`type:feature`, `priority:critical`, `area:fullstack`, `milestone:m5`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** EPIC-004
- **Project fields:** Type=Feature, ID=FEAT-023, Epic=EPIC-004, Priority=Critical, Effort=5d, Area=fullstack, Milestone=M5, Status=Not Started
