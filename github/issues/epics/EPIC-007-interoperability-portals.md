---
id: EPIC-007
type: epic
title: "Interoperability & Portals"
milestone: "M8"
priority: High
dependencies: [EPIC-006]
labels: [type:epic, priority:high, roadmap]
status: Not Started
---

# EPIC-007: Interoperability & Portals

**Type:** Epic &nbsp;·&nbsp; **Priority:** High &nbsp;·&nbsp; **Milestone(s):** M8 &nbsp;·&nbsp; **Status:** Not Started

## Description

Connects the platform to the outside world and gives clinicians and patients direct access, validating the structured model against external interoperability standards.

## Outcome

HL7 v2, a FHIR façade, and clinician + patient portals.

## Dependencies

- `EPIC-006` — Configuration & Reporting

## Features in this epic

- [ ] `FEAT-036` — HL7 v2 inbound/outbound via ACL (Milestone M8)
- [ ] `FEAT-037` — FHIR R4 façade (Milestone M8)
- [ ] `FEAT-038` — Clinician portal (Milestone M8)
- [ ] `FEAT-039` — Patient portal (Milestone M8)
- [ ] `FEAT-040` — Fine-grained ABAC / relationship authz (Milestone M8)

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

- **Milestone (GitHub):** M8
- **Project fields:** Type=Epic, ID=EPIC-007, Priority=High, Milestone=M8, Status=Not Started
