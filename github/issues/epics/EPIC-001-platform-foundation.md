---
id: EPIC-001
type: epic
title: "Platform Foundation"
milestone: "M0, M1"
priority: Critical
dependencies: []
labels: [type:epic, priority:critical, roadmap]
status: Not Started
---

# EPIC-001: Platform Foundation

**Type:** Epic &nbsp;·&nbsp; **Priority:** Critical &nbsp;·&nbsp; **Milestone(s):** M0, M1 &nbsp;·&nbsp; **Status:** Not Started

## Description

Establishes the monorepo, CI/CD, the AI engineering substrate (AGENTS.md, Skills, the Constitution CI gate), and the core structured Observation / catalog / tenancy schema that every later epic depends on. Nothing in this epic is customer-visible; everything after it depends on it.

## Outcome

Deployable skeleton + the metadata-driven clinical data spine.

## Dependencies

None.

## Features in this epic

- [ ] `FEAT-001` — Monorepo & toolchain (Milestone M0)
- [ ] `FEAT-002` — CI/CD & environments (Milestone M0)
- [ ] `FEAT-003` — AI engineering substrate (Milestone M0)
- [ ] `FEAT-004` — Catalog metadata model (Milestone M1)
- [ ] `FEAT-005` — Observation store (Milestone M1)
- [ ] `FEAT-006` — Order, specimen & tenancy spine (Milestone M1)
- [ ] `FEAT-007` — Clinical validation harness (Milestone M1)

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

- **Milestone (GitHub):** M0
- **Project fields:** Type=Epic, ID=EPIC-001, Priority=Critical, Milestone=M0, M1, Status=Not Started
