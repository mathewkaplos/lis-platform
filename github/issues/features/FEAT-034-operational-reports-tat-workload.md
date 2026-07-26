---
id: FEAT-034
type: feature
title: "Operational reports (TAT, workload)"
epic: EPIC-006
milestone: M7
priority: High
effort_days: 4
area: fullstack
dependencies: [FEAT-022]
labels: [type:feature, priority:high, area:fullstack, milestone:m7]
status: Not Started
---

# FEAT-034: Operational reports (TAT, workload)

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-006`](../epics/EPIC-006-configuration-reporting.md) — Configuration & Reporting &nbsp;·&nbsp;
**Milestone:** M7 &nbsp;·&nbsp; **Priority:** High &nbsp;·&nbsp; **Effort:** ~4 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Give lab management visibility into throughput and bottlenecks.

## Dependencies

- `FEAT-022` — Worklist v2 (SLA, assignment, bulk)

## Required Skills

- `engineering/observability`

## Architecture documents to reference

- KB-44 Analytics

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] TAT, workload, and rejection-rate reports render correctly against real seeded data

## Tasks

_Not yet decomposed — this feature belongs to a rolling-wave milestone (M5–M10) and will be broken into tasks at its milestone kickoff, per the Execution Plan §0._

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-034-operational-reports-tat-workload.md`

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

`type:feature`, `priority:high`, `area:fullstack`, `milestone:m7`

## GitHub metadata

- **Milestone (GitHub):** M7
- **Parent issue:** EPIC-006
- **Project fields:** Type=Feature, ID=FEAT-034, Epic=EPIC-006, Priority=High, Effort=4d, Area=fullstack, Milestone=M7, Status=Not Started
