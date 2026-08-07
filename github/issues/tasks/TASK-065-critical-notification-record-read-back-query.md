---
id: TASK-065
type: task
title: "Critical notification record, read-back capture & query"
feature: FEAT-021
epic: EPIC-004
milestone: M5
priority: Critical
size: "L (2 days)"
area: backend
dependencies: [TASK-054]
labels: [type:task, priority:critical, area:backend, milestone:m5, size:l]
status: Not Started
---

# TASK-065: Critical notification record, read-back capture & query

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-021`](../features/FEAT-021-critical-notification-read-back-escalation.md) — Critical notification, read-back & escalation &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** L (2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Critical notification, read-back & escalation**
(FEAT-021). Follow the Engineering Operations Manual workflow: orient → (research if novel) →
(ADR if load-bearing) → load Skills → **write and get approval for the Implementation Proposal
covering this task's parent feature** → implement this task as one reviewed slice → test → commit
→ review → merge.

Delivers ADR-0016's schema mechanism: a new `critical_notification` table (tenant-scoped, RLS)
linked to `observation`, a creation hook inside `finalize()` folding a `criticalNotificationId`
into its already-audited event, an audited acknowledge (read-back) action, and a query endpoint.
Does **not** touch `FinalizationRollupInterceptor`'s existing finalization-block gate — that
widening, plus the escalation timer, is TASK-066's scope.

## Dependencies

- `TASK-054` — Critical detection (`criticalDetected`, computed in `finalize()`) — this task's own
  creation hook extends that same method

## Expected output

`critical_notification` table + `finalize()` creation hook + acknowledge/query endpoints per
ADR-0016

## Acceptance criteria

- [ ] `critical_notification` exists, tenant-scoped, RLS-enforced, with a real FK to `observation`
- [ ] `finalize()` creates exactly one `'pending'` row the first time an analyte is HH/LL-flagged,
      with no duplicate on a subsequent re-finalize while one is already pending/escalated
- [ ] `POST /v1/critical-notifications/:id/acknowledge` requires non-empty `readBack`, is gated by
      the `verify` capability, and is audited
- [ ] `GET /v1/critical-notifications` is queryable independently of `observation.verify()`'s state
- [ ] Every existing patient-flow write path is unaffected (full existing e2e suite green);
      `FinalizationRollupInterceptor`'s existing gate is untouched

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal and ADR-0016
- [ ] Unit tests pass; RLS isolation test added for the new tenant-scoped table
- [ ] Migration runs up **and** down cleanly on seeded data
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m5`, `size:l`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-021
- **Project fields:** Type=Task, ID=TASK-065, Feature=FEAT-021, Priority=Critical, Size=L (2 days), Area=backend, Milestone=M5, Status=Not Started
