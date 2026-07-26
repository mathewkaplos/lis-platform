---
id: FEAT-013
type: feature
title: "Accessioning, labels & reception"
epic: EPIC-003
milestone: M3
priority: Critical
effort_days: 6
area: fullstack
dependencies: [FEAT-012]
labels: [type:feature, priority:critical, area:fullstack, milestone:m3]
status: Not Started
---

# FEAT-013: Accessioning, labels & reception

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-003`](../epics/EPIC-003-pre-analytical-workflow.md) — Pre-Analytical Workflow &nbsp;·&nbsp;
**Milestone:** M3 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~6 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

The physical workflow — without a printed label there is no usable lab workflow.

## Dependencies

- `FEAT-012` — Order entry

## Required Skills

- `engineering/barcode-printing`
- `domain/specimen-lifecycle`

## Architecture documents to reference

- KB-22 Sample Management
- KB-23 Specimen Tracking
- KB-24 Barcoding

## ADRs to reference

- `ADR-0009` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

- §7.2 Barcode Printing
- §7.3 Sample Reception
- §7.8 Collection Queue

## Acceptance criteria

- [ ] Accession numbers never collide under concurrent requests
- [ ] A label prints correctly (Code128 + DataMatrix) on the design partner's actual printer
- [ ] Specimen rejection requires a coded reason and is fully audited
- [ ] Collection queue correctly lists pending collections with priority and required tubes

## Tasks

- [ ] `TASK-045` — Accession number generation (collision-safe) (M (1 day))
- [ ] `TASK-046` — Label rendering (Code128+DataMatrix) + print pipeline (L (2 days))
- [ ] `TASK-047` — Reception screen: scan-to-receive, coded rejection (M (1 day))
- [ ] `TASK-048` — Collection queue screen (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-013-accessioning-labels-reception.md`

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
- **Project fields:** Type=Feature, ID=FEAT-013, Epic=EPIC-003, Priority=Critical, Effort=6d, Area=fullstack, Milestone=M3, Status=Not Started
