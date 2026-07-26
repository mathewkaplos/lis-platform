---
id: FEAT-048
type: feature
title: "Internationalization"
epic: EPIC-009
milestone: M10
priority: Medium
effort_days: 5
area: frontend
dependencies: [FEAT-010]
labels: [type:feature, priority:medium, area:frontend, milestone:m10]
status: Not Started
---

# FEAT-048: Internationalization

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-009`](../epics/EPIC-009-commercial-readiness.md) — Commercial Readiness &nbsp;·&nbsp;
**Milestone:** M10 &nbsp;·&nbsp; **Priority:** Medium &nbsp;·&nbsp; **Effort:** ~5 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Support multiple languages and locales for the international ambition.

## Dependencies

- `FEAT-010` — Design system v1

## Required Skills

- `engineering/frontend-design`

## Architecture documents to reference

- KB-51 Commercialization

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

- §20.15 Localization

## Acceptance criteria

- [ ] The app correctly renders in at least one additional language with proper date/number/unit locale formatting

## Tasks

_Not yet decomposed — this feature belongs to a rolling-wave milestone (M5–M10) and will be broken into tasks at its milestone kickoff, per the Execution Plan §0._

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-048-internationalization.md`

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

`type:feature`, `priority:medium`, `area:frontend`, `milestone:m10`

## GitHub metadata

- **Milestone (GitHub):** M10
- **Parent issue:** EPIC-009
- **Project fields:** Type=Feature, ID=FEAT-048, Epic=EPIC-009, Priority=Medium, Effort=5d, Area=frontend, Milestone=M10, Status=Not Started
