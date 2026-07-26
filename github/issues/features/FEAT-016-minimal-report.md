---
id: FEAT-016
type: feature
title: "Minimal report"
epic: EPIC-004
milestone: M4
priority: Critical
effort_days: 5
area: fullstack
dependencies: [FEAT-015]
labels: [type:feature, priority:critical, area:fullstack, milestone:m4]
status: Not Started
---

# FEAT-016: Minimal report

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-004`](../epics/EPIC-004-analytical-core.md) — Analytical Core &nbsp;·&nbsp;
**Milestone:** M4 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~5 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Produce the artifact the lab actually sends to a clinician.

## Dependencies

- `FEAT-015` — Verification & criticals

## Required Skills

- `engineering/pdf-generation`

## Architecture documents to reference

- KB-12 Template Engine
- KB-13 Report Designer

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

- §18.1 Report Viewer

## Acceptance criteria

- [ ] PDF rendering from a config-defined template is deterministic and hash-stamped
- [ ] A 2-year-old result renders using its originally snapshotted reference range, not the current one
- [ ] Preliminary vs. final report status is unambiguous in the viewer

## Tasks

- [ ] `TASK-058` — Config template → HTML → PDF (hash-stamped) (L (2 days))
- [ ] `TASK-059` — Report data assembly with snapshotted ranges (M (1 day))
- [ ] `TASK-060` — Report viewer + download screen (M (1 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-016-minimal-report.md`

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
- **Project fields:** Type=Feature, ID=FEAT-016, Epic=EPIC-004, Priority=Critical, Effort=5d, Area=fullstack, Milestone=M4, Status=Not Started
