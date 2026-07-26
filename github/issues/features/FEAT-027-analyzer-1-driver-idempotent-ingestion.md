---
id: FEAT-027
type: feature
title: "Analyzer #1 driver + idempotent ingestion"
epic: EPIC-005
milestone: M6
priority: Critical
effort_days: 8
area: backend
dependencies: [FEAT-026]
labels: [type:feature, priority:critical, area:backend, milestone:m6]
status: Not Started
---

# FEAT-027: Analyzer #1 driver + idempotent ingestion

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-005`](../epics/EPIC-005-automation-instruments.md) — Automation & Instruments &nbsp;·&nbsp;
**Milestone:** M6 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~8 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Eliminate manual transcription for the design partner's highest-volume instrument.

## Dependencies

- `FEAT-026` — Edge integration gateway

## Required Skills

- `domain/analyzer-integration`
- `domain/hl7-v2`

## Architecture documents to reference

- KB-29 Analyzer Integration
- KB-30 HL7

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] Results from the real analyzer ingest correctly via ASTM/HL7 without re-keying
- [ ] A retried/duplicate message is correctly deduplicated via idempotency key (instrument, specimen, analyte, run)

## Tasks

_Not yet decomposed — this feature belongs to a rolling-wave milestone (M5–M10) and will be broken into tasks at its milestone kickoff, per the Execution Plan §0._

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-027-analyzer-1-driver-idempotent-ingestion.md`

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

`type:feature`, `priority:critical`, `area:backend`, `milestone:m6`

## GitHub metadata

- **Milestone (GitHub):** M6
- **Parent issue:** EPIC-005
- **Project fields:** Type=Feature, ID=FEAT-027, Epic=EPIC-005, Priority=Critical, Effort=8d, Area=backend, Milestone=M6, Status=Not Started
