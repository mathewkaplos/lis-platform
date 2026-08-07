---
id: TASK-066
type: task
title: "Escalation timer & finalization-gate widening"
feature: FEAT-021
epic: EPIC-004
milestone: M5
priority: Critical
size: "M (1-2 days)"
area: backend
dependencies: [TASK-065]
labels: [type:task, priority:critical, area:backend, milestone:m5, size:m]
status: Not Started
---

# TASK-066: Escalation timer & finalization-gate widening

**Type:** Task &nbsp;·&nbsp; **Feature:** [`FEAT-021`](../features/FEAT-021-critical-notification-read-back-escalation.md) — Critical notification, read-back & escalation &nbsp;·&nbsp;
**Epic:** EPIC-004 — Analytical Core &nbsp;·&nbsp; **Milestone:** M5 &nbsp;·&nbsp;
**Priority:** Critical &nbsp;·&nbsp; **Effort:** M (1-2 days) &nbsp;·&nbsp; **Status:** Not Started

## Description

Implementation-sized unit of work within **Critical notification, read-back & escalation**
(FEAT-021). Follow the Engineering Operations Manual workflow: orient → (research if novel) →
(ADR if load-bearing) → load Skills → **write and get approval for the Implementation Proposal
covering this task's parent feature** → implement this task as one reviewed slice → test → commit
→ review → merge.

Depends on TASK-065's `critical_notification` table existing as a real, tested entity. Adds a
scheduled job (new dependency — evaluate and get explicit approval for the specific package, e.g.
`@nestjs/schedule` — before adding it) that escalates any `critical_notification` still `'pending'`
past a configured threshold. Widens `FinalizationRollupInterceptor`'s existing gate to also require
`critical_notification.status = 'acknowledged'` (not just `observation.status = 'verified'`) for any
HH/LL-flagged row on the panel — closing the real, temporary gap ADR-0016 names explicitly: today, a
verified critical can finalize a report before its read-back is ever captured.

No SMS/email/push channel, no on-call routing/contact-selection infra — KB-34 lists both as
open/future items; "escalate to a defined escalation contact" is narrowed for this task to
re-surfacing the notification (bumped `escalationLevel`, audited) to the same `verify`-capable
pool, not a new routing concept.

## Dependencies

- `TASK-065` — Critical notification record, read-back capture & query (the table and acknowledge
  action this task's gate-widening and escalation query depend on)

## Expected output

Scheduled escalation job + widened `FinalizationRollupInterceptor` gate

## Acceptance criteria

- [ ] A `critical_notification` still `'pending'` past the configured escalation window is marked
      `'escalated'` (incremented `escalationLevel`, `lastEscalatedAt` set), audited
- [ ] `FinalizationRollupInterceptor`'s gate returns 409 for any HH/LL-flagged observation on the
      panel whose `critical_notification` is not `'acknowledged'`, in addition to its existing
      `observation.status <> 'verified'` check
- [ ] Every existing patient-flow write path is unaffected (full existing e2e suite green), except
      the intended, newly-covered case above
- [ ] The new scheduling dependency is named and justified in this task's own PR description

## Definition of Done

- [ ] Diff read line-by-line and understood in full before merge
- [ ] Conventional commit written, referencing the parent feature's Implementation Proposal and ADR-0016
- [ ] Unit tests pass; the widened finalization gate has its own e2e coverage (both the
      already-covered verified-only case and the new acknowledged-required case)
- [ ] No violation of the five Constitution invariants (structured data, append-only, criticals never
      auto-verify, RLS tenant isolation, audit on clinical writes)
- [ ] CI green on the branch before merge

## Labels

`type:task`, `priority:critical`, `area:backend`, `milestone:m5`, `size:m`

## GitHub metadata

- **Milestone (GitHub):** M5
- **Parent issue:** FEAT-021
- **Project fields:** Type=Task, ID=TASK-066, Feature=FEAT-021, Priority=Critical, Size=M (1-2 days), Area=backend, Milestone=M5, Status=Not Started
