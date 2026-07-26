---
id: EPIC-004
type: epic
title: "Analytical Core"
milestone: "M4, M5"
priority: Critical
dependencies: [EPIC-003]
labels: [type:epic, priority:critical, roadmap]
status: Not Started
---

# EPIC-004: Analytical Core

**Type:** Epic &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Milestone(s):** M4, M5 &nbsp;·&nbsp; **Status:** Not Started

## Description

The thesis milestone of the whole company: proves the structured, metadata-driven clinical result model end-to-end in production, then generalizes it to a second discipline and makes it dependable enough for a real bench to run a shift on.

## Outcome

Structured results, human verification, QC, criticals, and two disciplines (Chemistry, Haematology).

## Dependencies

- `EPIC-003` — Pre-Analytical Workflow

## Features in this epic

- [ ] `FEAT-014` — Result entry engine (Milestone M4)
- [ ] `FEAT-015` — Verification & criticals (Milestone M4)
- [ ] `FEAT-016` — Minimal report (Milestone M4)
- [ ] `FEAT-017` — Minimal worklist (Milestone M4)
- [ ] `FEAT-018` — QC materials & results as Observations (Milestone M5)
- [ ] `FEAT-019` — Levey-Jennings + Westgard engine (Milestone M5)
- [ ] `FEAT-020` — QC gating of result release (Milestone M5)
- [ ] `FEAT-021` — Critical notification, read-back & escalation (Milestone M5)
- [ ] `FEAT-022` — Worklist v2 (SLA, assignment, bulk) (Milestone M5)
- [ ] `FEAT-023` — Haematology CBC + differential (Milestone M5)
- [ ] `FEAT-024` — Peripheral film structured reporting (Milestone M5)
- [ ] `FEAT-025` — Delta checks (Milestone M5)

## Acceptance criteria (epic-level)

- [ ] All features listed above are merged and individually demoed
- [ ] The milestone(s) this epic spans have been demoed to the design-partner lab
- [ ] No violation of the five Constitution invariants was introduced anywhere in this epic
- [ ] Relevant ADRs are ratified and the knowledge base updated where authorized

## Definition of Done

- [ ] Every child feature meets its own Definition of Done
- [ ] The epic's outcome statement is demonstrably true in the deployed staging environment
- [ ] Epic closed only after its terminating milestone's exit criteria are met

## Labels

`type:epic`, `priority:critical`, `roadmap`

## GitHub metadata

- **Milestone (GitHub):** M4
- **Project fields:** Type=Epic, ID=EPIC-004, Priority=Critical, Milestone=M4, M5, Status=Not Started
