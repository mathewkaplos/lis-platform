# Implementation Proposal: FEAT-028 — Transactional outbox + event bus
Status: APPROVED
ADR: adr-0028 (outbox implementation choice — see §10)
Date: 2026-08-09    Backlog ID: FEAT-028 (issue #37)

## 1. Goal

Issue #37's literal AC: "An event and its triggering state change commit atomically or not at
all (outbox pattern verified under failure injection)." KB-25 (workflow engine) describes the
target consumer — a rule-evaluation engine subscribing to domain events via each context's
transactional outbox — but that engine (FEAT-029, still "Not Started") doesn't exist yet. This
proposal builds the outbox mechanism itself: a table + a same-transaction write helper + a
polling relay that delivers to an in-process handler registry — proven end-to-end against one
real, concrete domain event, not five speculative ones. FEAT-029/030/031 register their own
handlers against this mechanism later; this feature does not build rule evaluation, reflex, or
auto-verification.

## 2. Affected files

- `packages/db/src/schema/outbox-event.ts` — new `outbox_event` table, tenant-scoped, RLS'd from
  creation. Directly reuses `critical_notification.ts`'s own already-proven two-policy shape
  (`tenantIsolation()` using the 2-arg `current_setting(..., true)` form, plus a
  `schedulerEnumeration()` policy for `lis_scheduler`) — see §5 for why starting there matters.
- New migration — `GRANT SELECT (tenant_id) ON outbox_event TO lis_scheduler` +
  `CREATE POLICY scheduler_enumeration` (generated), reusing the *existing* `lis_scheduler` role
  (ADR-0017) rather than creating a second scheduler role.
- `packages/db/src/outbox.ts` — new `writeOutboxEvent(tx, {...})`, mirroring `writeAuditEvent`'s
  own shape/location: same-transaction insert, callable from any domain write.
- `apps/api/src/observation/observation.controller.ts`'s `verify()` — the one real producer this
  proposal wires: writes an `ObservationVerified` outbox event in the same transaction as the
  status update, matching KB-25's own literal example rule (`"on": "ObservationVerified"`).
- New `apps/api/src/outbox/` module: `outbox-relay.service.ts` (the polling relay,
  `@Interval`-scheduled, directly reusing `CriticalNotificationEscalationService`'s own two-role/
  per-tenant/isolated-failure shape — see §5), `outbox-handler.registry.ts` (a
  `Map<eventType, handler[]>` FEAT-029+ registers against later), and one trivial logging handler
  for `ObservationVerified` proving real delivery.
- New e2e tests proving the literal AC (§8).

## 3. Architecture consulted

- **KB-25 Workflow Engine** — "Execution model" step 1 ("consume a domain event... delivered via
  each context's transactional outbox") and "Execution is at-least-once; every command carries an
  idempotency key derived from (event_id, rule_id)." The idempotency-key requirement is
  **FEAT-029's own scope** (it's about *rule* dispatch, not outbox delivery) — noted, not built
  here.
- **KB-05 System Architecture** — "REST sync + events async + outbox," no external message broker
  chosen; confirms an in-process handler registry (not Kafka/RabbitMQ) matches the stated design.
- **ADR-0017** (critical-notification two-role escalation) + its own hard-won fix
  (`ALTER POLICY ... current_setting('app.tenant_id', true)`, migration 0019) — directly reused,
  not rediscovered (see §5).
- **`domain/critical-values` Skill entry #4** — "no event bus exists anywhere in this repo... no
  infra exists to build one ahead of FEAT-028" — this proposal is what removes that caveat for
  future critical-values work, though wiring `CriticalValueDetected` itself is not in this
  proposal's scope (see §10 Q1).
- `packages/db/src/audit.ts` (`writeAuditEvent`) — the direct structural precedent for
  `writeOutboxEvent`: a plain insert taking the caller's own open transaction.

## 4. Skills loaded

- `engineering/outbox-events` — **does not exist yet**. Not drafted speculatively here, same
  discipline `domain/analyzer-integration` followed for FEAT-026: draft it after this feature's
  real shape is proven, not ahead of any code.
- `engineering/database-design` — entries #2/#4/#5 (forward-reference/backfill/hand-written-
  migration precedents, though this migration is fully drizzle-generateable, no hand-written DDL
  needed since `lis_scheduler` already exists).

## 5. Assumptions & autonomous decisions

- **`outbox_event`'s `tenantIsolation()` policy uses the 2-arg `current_setting('app.tenant_id',
  true)` form from its very first migration**, not the 1-arg form every other table defaults to.
  `critical_notification`'s own history (ADR-0017, migration 0019) already discovered the hard
  way that `lis_scheduler` (which never sets `app.tenant_id`, by design — it has no single
  tenant) makes the 1-arg form throw "unrecognized configuration parameter" on every query,
  aborting even the separate, more-permissive `scheduler_enumeration` policy that should have
  allowed it (Postgres OR's multiple PERMISSIVE policies together, but an exception in one
  aborts the whole evaluation). Starting with the 2-arg form here avoids reproducing a bug this
  repo has already paid to find and fix once.
- **Reuses the existing `lis_scheduler` role and `SCHEDULER_DATABASE_URL` connection** (ADR-0017)
  rather than creating a second scheduler role — `lis_scheduler`'s whole purpose (cross-tenant
  enumeration, NOBYPASSRLS, column-scoped grants) is identical for this feature's needs.
- **One real producer this phase: `ObservationVerified`**, wired into the already-existing
  `verify()` route. Not `OrderPlaced`/`SpecimenReceived`/`CriticalValueDetected`/`ReportFinalized`
  (KB-05's other four named events) — those are each their own real wiring decision (which
  transaction, what payload shape) belonging to whichever future feature/task actually needs that
  event consumed; this proposal proves the mechanism once, not "all five, unconsumed." See §10 Q1.
- **In-process handler registry, no external broker/queue** — matches KB-05's own "REST sync +
  events async + outbox" simplicity choice; this repo has no infrastructure to run a message
  broker, and the workflow engine (FEAT-029) is itself expected to run in-process (KB-25: "a
  coordinating context," not a separate deployable).
- **At-least-once delivery, no dead-letter queue.** A handler that throws increments `attempts`
  and records `lastError`, leaving the row `pending` for the next tick — retried indefinitely.
  Accepted for this scale (matches this repo's own repeated "don't build ahead of a real need"
  precedent); a max-attempts/dead-letter mechanism is a real, separate decision for whenever a
  handler actually demonstrates a poison-message problem, not pre-built speculatively.

## 6. Risks

- The relay's polling interval trades latency for simplicity (matches
  `CriticalNotificationEscalationService`'s own accepted 5-minute-interval trade-off) — an
  `ObservationVerified` handler doesn't react instantly. Acceptable: nothing in this repo
  currently needs sub-interval reaction latency (FEAT-029 doesn't exist yet to need it).
- `verify()`'s transaction grows by one insert — negligible; `writeOutboxEvent` is a plain insert,
  same shape as the already-present `writeAuditEvent` call on the same route family.
- Reusing `lis_scheduler` for a second table increases that role's blast radius slightly (one more
  table it can enumerate `tenant_id` from) — accepted, matches ADR-0017's own "cheaper shared
  default" framing rather than a role-per-table proliferation.

## 7. Acceptance criteria

(issue #37's own, verified per its literal wording)

- [ ] `verify()`'s status change and its `ObservationVerified` outbox row commit **atomically** —
      proven by a real transaction-rollback test (§8), not asserted from code reading alone.
- [ ] The relay delivers a pending event to its registered handler(s) and marks it processed.
- [ ] A handler that throws leaves the event retryable (not silently dropped, not marked
      processed) — `attempts`/`lastError` recorded.
- [ ] RLS isolation test added for the new tenant-scoped table.

## 8. Testing plan

- **Failure-injection atomicity test (the literal AC)**: open a real transaction directly via
  `createDb`, perform an `observation` status update + `writeOutboxEvent` call, then throw before
  commit; confirm afterward that **neither** the status change nor the outbox row exists. A
  second, positive-path test confirms a real `POST .../verify` call produces both together.
- Relay tests: insert a pending row directly, call `OutboxRelayService`'s own tick method directly
  (mirrors `CriticalNotificationEscalationService.escalateOverdue()`'s own existing test pattern —
  `@Interval` fires too slowly for a test), confirm handler invocation + `processedAt`. A
  handler-throws case confirms `attempts` increments and the row stays `pending`.
- RLS isolation: fixture added to `rls-isolation-check.ts` (or a lightweight standalone check if
  that script's own unrelated gap, issue #430, makes reuse awkward — decided during
  implementation, not here).

## 9. Rollback plan

New table + new module, no changes to any existing table's shape (only `verify()` gains one extra
same-transaction insert). Reversible via `DROP TABLE`; removing the `writeOutboxEvent` call from
`verify()` restores it to its pre-FEAT-028 behavior exactly.

## 10. Questions requiring human approval — RESOLVED 2026-08-09

1. **Scope of producers this phase — RESOLVED: `ObservationVerified` only.** Proves the mechanism
   once via `verify()`. `CriticalValueDetected` and every other KB-05 event stay unwired for
   whoever actually needs them consumed next (likely FEAT-030/031, or a dedicated follow-up).
2. **ADR-0028 — RESOLVED: approved as proposed.** DB-row + polling relay reusing `lis_scheduler`,
   in-process handler registry, at-least-once/no dead-letter queue. Written up as **ADR-0028**.
