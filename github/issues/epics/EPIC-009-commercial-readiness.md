---
id: EPIC-009
type: epic
title: "Commercial Readiness"
milestone: "M10"
priority: High
dependencies: [EPIC-008]
labels: [type:epic, priority:high, roadmap]
status: Not Started
---

# EPIC-009: Commercial Readiness

**Type:** Epic &nbsp;·&nbsp; **Priority:** High &nbsp;·&nbsp; **Milestone(s):** M10 &nbsp;·&nbsp; **Status:** Not Started

## Description

Turns a working system into a sellable, self-service, multi-customer commercial product.

## Outcome

Multi-tenant isolation tiers, billing, i18n, the visual report designer, and scale hardening.

## Dependencies

- `EPIC-008` — Governed AI

## Features in this epic

- [ ] `FEAT-045` — Tenancy tiers (schema/DB isolation) (Milestone M10)
- [ ] `FEAT-046` — Billing & payments (incl. mobile money) (Milestone M10)
- [ ] `FEAT-047` — Visual report designer v1 (Milestone M10)
- [ ] `FEAT-048` — Internationalization (Milestone M10)
- [ ] `FEAT-049` — Self-service onboarding (Milestone M10)
- [ ] `FEAT-050` — DR, backup rehearsal & scale hardening (Milestone M10)

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

`type:epic`, `priority:high`, `roadmap`

## GitHub metadata

- **Milestone (GitHub):** M10
- **Project fields:** Type=Epic, ID=EPIC-009, Priority=High, Milestone=M10, Status=Not Started
