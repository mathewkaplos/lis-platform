---
id: FEAT-011
type: feature
title: "Patient management"
epic: EPIC-003
milestone: M3
priority: Critical
effort_days: 6
area: fullstack
dependencies: [FEAT-010]
labels: [type:feature, priority:critical, area:fullstack, milestone:m3]
status: Not Started
---

# FEAT-011: Patient management

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-003`](../epics/EPIC-003-pre-analytical-workflow.md) — Pre-Analytical Workflow &nbsp;·&nbsp;
**Milestone:** M3 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~6 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

The record every clinical action attaches to.

## Dependencies

- `FEAT-010` — Design system v1

## Required Skills

- `engineering/api-design`
- `domain/patient-identity`

## Architecture documents to reference

- KB-02 Domain Model
- KB-41 Patient Records

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

- §4.1 Patient Registration
- §4.2 Patient Search
- §4.3 Patient Profile

## Acceptance criteria

- [ ] Patient searchable by national ID and MRN with correct results
- [ ] Duplicate-patient warning triggers on matching name+DOB+ID combination
- [ ] Registration form captures the design partner's actual required field set
- [ ] Search and profile screens implement all four states (populated/empty/loading/error) and full keyboard navigation

## Tasks

- [ ] `TASK-038` — Migration: patient + identifiers + alerts (M (1 day))
- [ ] `TASK-039` — API: create/search/get patient (Zod + OpenAPI) (M (1 day))
- [ ] `TASK-040` — Registration form + duplicate detection (L (2 days))
- [ ] `TASK-041` — Patient search + profile screens (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-011-patient-management.md`

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

`type:feature`, `priority:critical`, `area:fullstack`, `milestone:m3`

## GitHub metadata

- **Milestone (GitHub):** M3
- **Parent issue:** EPIC-003
- **Project fields:** Type=Feature, ID=FEAT-011, Epic=EPIC-003, Priority=Critical, Effort=6d, Area=fullstack, Milestone=M3, Status=Not Started
