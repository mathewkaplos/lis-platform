---
id: FEAT-010
type: feature
title: "Design system v1"
epic: EPIC-002
milestone: M2
priority: Critical
effort_days: 5.5
area: design
dependencies: [FEAT-008]
labels: [type:feature, priority:critical, area:design, milestone:m2]
status: Not Started
---

# FEAT-010: Design system v1

**Type:** Feature &nbsp;·&nbsp; **Epic:** [`EPIC-002`](../epics/EPIC-002-identity-access-design-system.md) — Identity, Access & Design System &nbsp;·&nbsp;
**Milestone:** M2 &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Effort:** ~5.5 days &nbsp;·&nbsp; **Status:** Not Started

## Purpose

One coherent visual language established before the first real product screen.

## Dependencies

- `FEAT-008` — Authentication (Keycloak/OIDC)

## Required Skills

- `engineering/frontend-design`

## Architecture documents to reference

- Google Stitch Prompt Library §0, §1

## ADRs to reference

_None yet — write one if a load-bearing decision is discovered during planning._

## Google Stitch prompts required

- §0 Global Design System
- §1 Master Patterns A–G

## Acceptance criteria

- [ ] Design tokens (color, spacing, radius, typography) documented in docs/design.md for light and dark
- [ ] Six primitives (DataTable, StatusPill, FilterBar, SlideOver, StatCard, FormField) render correctly in Storybook, light and dark, keyboard-accessible
- [ ] App shell (sidebar, top bar, org/branch switcher, theme toggle, command palette stub) renders on every route and persists theme choice
- [ ] CI fails on a WCAG AA violation detected by axe

## Tasks

- [ ] `TASK-034` — Stitch reference screens; extract tokens to packages/ui (M (1 day))
- [ ] `TASK-035` — Build 6 primitives (DataTable, StatusPill, FilterBar, SlideOver, StatCard, FormField) (L (2 days))
- [ ] `TASK-036` — App shell: sidebar, top bar, org/branch switcher, theme, palette (M (1 day))
- [ ] `TASK-037` — Storybook + axe a11y check in CI (S (0.5 day))

## Implementation Proposal

- [ ] An Implementation Proposal has been written per the Engineering Operations Manual §7/§8
      (goal · affected files · architecture consulted · skills loaded · assumptions · risks ·
      acceptance criteria · testing plan · rollback plan · open questions)
- [ ] The proposal has been **approved** (status: `APPROVED`) before any task in this feature begins
- [ ] Proposal file: `docs/plans/feat-010-design-system-v1.md`

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

`type:feature`, `priority:critical`, `area:design`, `milestone:m2`

## GitHub metadata

- **Milestone (GitHub):** M2
- **Parent issue:** EPIC-002
- **Project fields:** Type=Feature, ID=FEAT-010, Epic=EPIC-002, Priority=Critical, Effort=5.5d, Area=design, Milestone=M2, Status=Not Started
