---
id: TASK-067
type: task
title: "Westgard multirule evaluation engine"
feature: FEAT-019
epic: EPIC-004
milestone: M5
priority: Critical
size: "L (2 days)"
area: backend
dependencies: [TASK-064]
labels: [type:task, priority:critical, area:backend, milestone:m5, size:l]
status: Not Started
---

# TASK-067: Westgard multirule evaluation engine

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-019`](../features/FEAT-019-levey-jennings-westgard-engine.md) — Levey-Jennings + Westgard engine &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Levey-Jennings + Westgard engine** (FEAT-019). Follow
the Engineering Operations Manual workflow: orient → (research if novel) → (ADR if load-bearing) →
load Skills → **write and get approval for the Implementation Proposal covering this task's parent
feature** → implement this task as one reviewed slice → test → commit → review → merge.

Delivers ADR-0018's evaluation mechanism: a pure-function Westgard multirule evaluator
(`packages/domain/src/qc-westgard.ts`), a new `qc_rule_violation` table (tenant-scoped, RLS), and
wiring into the existing `POST /v1/control-lots/:id/results` write path (TASK-064) so a violation
is detected and persisted, in the same transaction, at the moment of QC entry. Does **not** build a
chart-data endpoint or any frontend — those are TASK-068/069. Does **not** build hold/gate/release
logic — that is FEAT-020's scope.

## Dependencies

- `TASK-064` — QC result entry & query API (FEAT-018) — this task extends `recordResult()`'s
  existing write path

## Expected output

`qc_rule_violation` table + `evaluateWestgardRules()` + `recordResult()` wired to detect and persist
violations, per ADR-0018

## Acceptance criteria

- [ ] `qc_rule_violation` exists, tenant-scoped, RLS-enforced, with a real composite FK to
      `observation.(id, created_at)` and a real FK to `control_lot`
- [ ] 1-2s, 1-3s, 2-2s, 4-1s, 10x are each correctly detected from a single control lot's own
      ordered history, including exact-boundary cases (a point at precisely 2 SD is not a 1-2s
      trigger)
- [ ] R-4s is correctly detected when a same-day sibling-level result exists (per ADR-0018's
      nearest-sibling pairing), and correctly not evaluated (no violation, no error) when none
      exists in the 24-hour window
- [ ] 1-2s alone persists as `severity: 'warning'`; a confirming rejection rule persists as
      `severity: 'rejection'` and suppresses the redundant 1-2s warning for the same point
- [ ] `POST /v1/control-lots/:id/results` returns detected violations in `after.violations`, and
      each is persisted in the same DB transaction as the QC Observation insert
- [ ] Every existing patient-flow and FEAT-018 write/read path is unaffected (full existing e2e
      suite green)

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal and
      ADR-0018
- [ ] Unit tests pass (pure-function rule evaluator, no Postgres needed); RLS isolation test added
      for the new tenant-scoped table
- [ ] Migration runs up **and** down cleanly on seeded data
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals
      never auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m5`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-019
- **Project fields:** Type=Task, ID=TASK-067, Feature=FEAT-019, Priority=Critical, Size=L (2 days), Area=backend, Milestone=M5, Status=Not Started
