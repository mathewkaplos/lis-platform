---
id: EPIC-005
type: epic
title: "Automation & Instruments"
milestone: "M6"
priority: High
dependencies: [EPIC-004]
labels: [type:epic, priority:high, roadmap]
status: Not Started
---

# EPIC-005: Automation & Instruments

**Type:** Epic &nbsp;·&nbsp; **Priority:** High &nbsp;·&nbsp; **Milestone(s):** M6 &nbsp;·&nbsp; **Status:** Not Started

## Description

Eliminates manual transcription for the first analyzer and extracts the workflow engine from the real rules learned building the Analytical Core.

## Outcome

Analyzer feed, the metadata workflow engine, and safe auto-verification.

## Dependencies

- `EPIC-004` — Analytical Core

## Features in this epic

- [ ] `FEAT-026` — Edge integration gateway (Milestone M6)
- [ ] `FEAT-027` — Analyzer #1 driver + idempotent ingestion (Milestone M6)
- [ ] `FEAT-028` — Transactional outbox + event bus (Milestone M6)
- [ ] `FEAT-029` — Metadata workflow engine (Milestone M6)
- [ ] `FEAT-030` — Reflex rules (Milestone M6)
- [ ] `FEAT-031` — Auto-verification (deny-by-default) (Milestone M6)

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

- **Milestone (GitHub):** M6
- **Project fields:** Type=Epic, ID=EPIC-005, Priority=High, Milestone=M6, Status=Not Started
