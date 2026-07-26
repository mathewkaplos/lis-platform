---
id: EPIC-003
type: epic
title: "Pre-Analytical Workflow"
milestone: "M3"
priority: Critical
dependencies: [EPIC-002]
labels: [type:epic, priority:critical, roadmap]
status: Not Started
---

# EPIC-003: Pre-Analytical Workflow

**Type:** Epic &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Milestone(s):** M3 &nbsp;·&nbsp; **Status:** Not Started

## Description

The first genuinely usable slice of the product. Patient registration, order entry, accessioning, barcode/label printing, and sample reception.

## Outcome

Patient → order → specimen → label → receipt, usable standalone by a reception desk.

## Dependencies

- `EPIC-002` — Identity, Access & Design System

## Features in this epic

- [ ] `FEAT-011` — Patient management (Milestone M3)
- [ ] `FEAT-012` — Order entry (Milestone M3)
- [ ] `FEAT-013` — Accessioning, labels & reception (Milestone M3)

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

- **Milestone (GitHub):** M3
- **Project fields:** Type=Epic, ID=EPIC-003, Priority=Critical, Milestone=M3, Status=Not Started
