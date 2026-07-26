---
id: FEAT-003
type: feature
title: "AI engineering substrate"
epic: EPIC-001
milestone: M0
priority: Critical
effort_days: 6
area: ai
dependencies: [FEAT-001]
labels: [type:feature, priority:critical, area:ai, milestone:m0]
status: Not Started
---

# FEAT-003: AI engineering substrate

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-001`](../epics/EPIC-001-platform-foundation.md) — Platform Foundation &nbsp;·&nbsp;
**Milestone:** M0 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~6 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

Every future Claude Code session starts informed and constrained by the same rules.

## Dependencies

- `FEAT-001` — Monorepo & toolchain

## Required Skills

- `meta/skill-author`

## Architecture documents to reference

- Engineering Operations Manual

## ADRs to reference

- `ADR-0003` (to be drafted via the `plan`/`architect` skill if a load-bearing decision surfaces)

## Google Stitch prompts required

_Not applicable — no new UI, or composed entirely from existing `packages/ui` primitives._

## Acceptance criteria

- [ ] AGENTS.md answers stack/commands/structure/five-invariants questions correctly in a fresh session
- [ ] lis-engineering repo scaffolded with constitution/, knowledge-base/ (56 docs imported), adr/, skills/{workflow,engineering,domain,meta}/
- [ ] implementation-proposal.md and adr.md templates are usable verbatim
- [ ] plan and develop workflow Skills exist; develop refuses to write code without an approved proposal
- [ ] CI blocks a deliberately non-compliant PR (free-text clinical column / missing RLS / missing audit) with a clear message

## Tasks

- [ ] `TASK-011` — Write AGENTS.md and CLAUDE.md (M (1 day))
- [ ] `TASK-012` — Scaffold lis-engineering repo; import 56-doc KB (M (1 day))
- [ ] `TASK-013` — Write implementation-proposal and ADR templates (S (0.5 day))
- [ ] `TASK-014` — Author plan + develop workflow skills (M (1 day))
- [ ] `TASK-015` — Constitution CI gate (invariant enforcement) (L (2 days))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-003-ai-engineering-substrate.md`

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

`type:feature`, `priority:critical`, `area:ai`, `milestone:m0`

## GitHub metadata

- **Milestone (GitHub):** M0
- **Parent issue:** EPIC-001
- **Project fields:** Type=Feature, ID=FEAT-003, Epic=EPIC-001, Priority=Critical, Effort=6d, Area=ai, Milestone=M0, Status=Not Started
