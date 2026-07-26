---
id: FEAT-007
type: feature
title: "Clinical validation harness"
epic: EPIC-001
milestone: M1
priority: High
effort_days: 2
area: backend
dependencies: [FEAT-005]
labels: [type:feature, priority:high, area:backend, milestone:m1]
status: Not Started
---

# FEAT-007: Clinical validation harness

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-001`](../epics/EPIC-001-platform-foundation.md) — Platform Foundation &nbsp;·&nbsp;
**Milestone:** M1 &nbsp;·&nbsp; **Priority:** High &nbsp;·&nbsp; **Effort:** ~2 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Prove clinical correctness from day one, not as an afterthought.

## Dependencies

- `FEAT-005` — Observation store

## Required Skills

- `engineering/testing`

## Architecture documents to reference

- KB-46 Testing Strategy

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] Golden-dataset runner executes in CI and fails loudly on any mismatch
- [ ] First golden dataset (chemistry ranges + criticals) is reviewed and signed off by the design-partner lab

## Tasks

- [ ] `TASK-026` — Golden-dataset test runner in CI (M (1 day))
- [ ] `TASK-027` — First golden dataset: chemistry ranges + criticals (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-007-clinical-validation-harness.md`

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

`type:feature`, `priority:high`, `area:backend`, `milestone:m1`

## GitHub metadata

- **Milestone (GitHub):** M1
- **Parent issue:** EPIC-001
- **Project fields:** Type=Feature, ID=FEAT-007, Epic=EPIC-001, Priority=High, Effort=2d, Area=backend, Milestone=M1, Status=Not Started
