# Implementation Proposal: FEAT-029 (remainder) — SLA timers via the workflow engine
Status: **APPROVED** (2026-08-10) — §10's three open questions resolved by the human via the
native options-prompt (2026-08-10), all three decided as the recommended option (polling-derived
detection; `view_operational_reports` gates the read list; `sla_breach` stays separate from
`critical_notification`).
ADR: none yet — write one if a load-bearing decision is discovered during planning (a durable
timer → outbox-event → workflow-rule pipeline is new shape; likely candidate, see §10 Q1)
Date: 2026-08-10    Backlog ID: FEAT-029 (issue #38, AC #2 — the deferred half)

## 1. Goal

Issue #38's own AC #2 — "existing Chemistry/Haematology hard-coded workflows are correctly
migrated to the engine with no behavior change" — was explicitly and prominently deferred by the
original FEAT-029 proposal (`docs/plans/feat-029-metadata-workflow-engine.md` §10 Q1), which built
only the engine mechanism (schema, safe condition evaluator, publish-time guardrails, outbox
wiring) with zero real command handlers. FEAT-030 (reflex) and FEAT-031 (auto-verification) later
registered the first two real handlers. This proposal picks up AC #2's remainder — but not by
migrating the three things issue #38's own text named ("critical-notification creation, delta-check
flagging, etc.").

**Those three are not safe migration candidates, and this proposal declines to touch them, for a
reason the original proposal didn't have visibility into yet (nothing had shipped to check against
at the time):** every one of them is synchronously coupled to the very API response that produces
the data being evaluated.
- Delta-check's result is merged directly into the observation's own `flags` column, in the same
  write, before that row is ever returned (`observation-write.service.ts:213-218`) — there is no
  "after the fact" moment to react to; the value doesn't exist without it.
- Critical detection reads `row.flags` from that same just-written row, and `criticalNotificationId`
  is returned synchronously in `finalize()`'s own response body (`observation.controller.ts:585`) —
  `apps/web`'s `finalizeResult` almost certainly surfaces this in the same render, not on a later
  poll. An async, eventually-consistent workflow-engine dispatch (the engine's whole design,
  correctly, given ADR-0028's plain-polling-relay outbox) would change *when* a technologist sees a
  critical flag — a real behavior change on the single most patient-safety-sensitive path in this
  codebase, not a refactor.
- Calculated-field cascading (`maybeComputeDependents`) is even more tightly synchronous: dependent
  analyte values are computed and returned in the same `finalize()` response, before any event is
  even emitted.

Re-platforming any of these onto an async, at-least-once, eventually-consistent execution model
(ADR-0028's own explicit design) is the exact re-platforming-in-one-risky-pass the original
proposal already declined to attempt, for the same reason, one layer further in.

**What this proposal actually does instead:** builds the one piece of KB-25's Workflow Engine
document that genuinely doesn't exist anywhere yet and has zero synchronous-response coupling to
break — "SLA timers and escalation" (KB-25 §"SLA timers and escalation"). Today, `sla_target`
(FEAT-022/ADR-0024) is a pure lookup table; "at risk" is a fixed 80% ratio computed at read time in
the worklist query (`worklist.controller.ts:227-266`) and nothing else — no durable timer, no
breach event, no escalation, no notification. This is real, additive capability, not a migration,
and it fits the engine's async model *by construction*: a timer firing is inherently an
after-the-fact event, exactly the shape `WorkflowEngineService` already consumes.

Concretely: an `SlaBreached` outbox event fires when an `ordered_test` passes its
`sla_target.targetMinutes` still unverified. `WorkflowEngineService` (already wired to
`OutboxHandlerRegistry`) gains a third registration for it, so a **new, real, authorable workflow
rule** — e.g. "if priority is stat, notify" — decides what happens, with a new
`NotifySlaBreach` command handler as the concrete action, mirroring `critical_notification`'s own
"bump status/level, audit, no new delivery channel" precedent (`critical-notification-escalation
.service.ts`'s own header comment). This is a genuine instance of "a new workflow rule can be added
via configuration without a code deployment" (AC #1) applied to a brand-new trigger, and it
directly closes the one part of KB-25 §"SLA timers and escalation" that is 100% unbuilt today,
without touching a single line of the three synchronous, safety-adjacent paths above.

Issue #38's AC #2 stays **partially** open after this proposal — delta-check/critical-
notification/calculated-fields remain explicitly deferred, this time with a concrete architectural
reason (not just "not yet attempted") that any future proposal attempting them needs to reckon
with directly: they would need either a synchronous rule-evaluation path the engine doesn't have
today, or a deliberate, human-approved decision to accept the response-timing change. See §10 Q1.

## 2. Affected files

- New `packages/db/src/schema/sla-breach.ts` — `sla_breach` table, tenant-scoped, RLS'd:
  `id`, `tenantId`, `orderedTestId`, `priority` (text, denormalized at breach time so a later
  `sla_target` edit never rewrites history — same reasoning as `workflow_definition`'s own
  immutable-once-published versioning), `targetMinutes` (denormalized, same reason),
  `breachedAt`, `status` (`pending`/`escalated`/`resolved`, mirrors `critical_notification`'s own
  three-state shape), `escalationLevel` (int, default 0), `lastEscalatedAt` (nullable),
  `createdAt`. Partial unique index: at most one non-`resolved` row per `orderedTestId` (same
  "reuse the existing row, don't spawn a duplicate" precedent as `criticalNotification`'s own
  insert-or-reuse check).
- New `apps/api/src/sla/` module:
  - `sla-breach-detector.service.ts` — the new scheduled job. Two-phase per tick, reusing
    `CriticalNotificationEscalationService`'s exact proven shape: phase 1 enumerates
    `(tenantId, orderedTestId)` pairs past their target via `schedulerDb`/`lis_scheduler` (a new,
    narrow RLS policy scoped to unverified `ordered_test` rows joined against `sla_target`,
    mirroring migration `0018`'s own `scheduler_enumeration` policy); phase 2, per tenant, opens a
    real `db.transaction()` under `lis_app`/RLS, re-verifies each candidate is still unverified
    (a late-breaking `verify()` between phase 1 and phase 2 is a real, expected race — re-check,
    don't trust phase 1's snapshot), inserts (or reuses, per the unique index above) the
    `sla_breach` row, and calls `writeOutboxEvent(tx, { eventType: 'SlaBreached', ... })` in the
    *same* transaction as the insert — the breach record and the event that announces it are
    never allowed to diverge.
  - `notify-sla-breach.command.ts` — the new `WorkflowCommandHandler`, registered as
    `NotifySlaBreach` in `WorkflowCommandRegistry`. On a matched rule, re-verifies the
    `ordered_test` is still unverified (workflow-engine Skill entry #9: the rule's `when` is never
    the safety/correctness boundary, the handler is — same discipline `AutoVerifyObservation`
    already established, applied here to a non-clinical but still-real correctness question:
    don't notify on a panel that got verified in the gap between breach detection and rule
    dispatch), bumps `sla_breach.status`/`escalationLevel`, and calls `writeAuditEvent()` — no new
    delivery channel, matching `critical-notification-escalation.service.ts`'s own explicit scope
    note.
  - `sla.module.ts` — DI wiring; registers the new outbox handler and command handler.
- `apps/api/src/workflow/workflow-engine.service.ts` — `onModuleInit()` gains a third
  `this.outboxHandlers.register('SlaBreached', ...)` call, identical shape to the existing two.
- `apps/api/src/auth/capabilities.ts` — no new capability; `SlaBreached` rule authoring reuses the
  existing `manage_workflow` capability (`qa` role) FEAT-029 already gated workflow-definition
  writes behind. Reading `sla_breach` rows (a new `GET /v1/sla-breaches` list, mirroring
  `GET /v1/critical-notifications`) is gated behind the existing `resolve_qc`-adjacent... **open
  question, see §10 Q2** (which existing capability, if any, should read this list).
- Migration: new `sla_breach` table + the new `lis_scheduler` RLS policy (mirrors migration `0018`'s
  shape for `critical_notification`, scoped to `ordered_test`/`sla_target` instead).
- Not touched: `observation-write.service.ts`, `observation.controller.ts`,
  `apps/api/src/reflex/`, `apps/api/src/auto-verify/`, `delta-check` anything, calculated-field
  cascading anything — see §1 for why.

## 3. Architecture consulted

- **KB-25 Workflow Engine** — the "SLA timers and escalation" section specifically: "the engine
  schedules durable timers... a timer firing is itself an event -> rules react (escalate, notify
  on-call, raise priority)... timers are persisted... the scheduler is idempotent and cancels
  timers when the tracked transition completes." This proposal implements a **polling-derived**
  timer (breach detected by a scheduled scan against `ordered_test.createdAt` + `sla_target
  .targetMinutes`, not a per-row scheduled callback) rather than a literal per-order durable timer
  object — see §5 for why, and §10 Q1 for the explicit trade-off this narrows.
- **ADR-0028** (transactional outbox) — plain DB-row + polling relay, no broker, no DLQ; a
  scheduled detector job writing outbox rows is the same shape `CriticalNotificationEscalationService`
  already uses for its own DB writes, just adding an outbox event as one more write in the same
  transaction.
- **ADR-0017** (critical-notification escalation) — the two-phase `lis_scheduler`/`db.transaction()`
  pattern this proposal reuses verbatim for a different table.
- **ADR-0029/adr-0030/adr-0031** — the engine's own guardrail/handler/no-throw discipline this
  proposal's new `NotifySlaBreach` handler must follow (workflow-engine Skill entries #3, #4, #9,
  #10).
- **`engineering/workflow-engine` Skill** (all 11 entries) — entry #3 (handler must never open its
  own `db.transaction()` — `NotifySlaBreach` receives the engine's already-open `tx`, same as
  `AddReflexTest`/`AutoVerifyObservation`); entry #4 (a handler's "can't safely act" case is a
  logged no-op, never a throw — applies directly to the late-verification race above); entry #9
  (the `when` condition is never the safety boundary); entry #10 (`firingContext`/`dryRun` must be
  used, not re-derived).
- **`domain/critical-values` Skill** — checked for anything specific to notification-shaped tables
  that should carry over to `sla_breach`; nothing beyond what §2 already reuses.

## 4. Skills loaded

- `engineering/workflow-engine` (required by issue #38 itself)
- `engineering/testing` (entry #13, this session's own newest finding, directly relevant: any e2e
  fixture that needs to simulate an SLA breach will backdate `ordered_test.createdAt` the same way
  FEAT-034's TAT fixture did — the exact "exclude real now from the window" discipline that entry
  documents applies again here, not coincidentally, since it's the same underlying table)
- `engineering/database-design` (RLS/migration conventions for the new `sla_breach` table and
  `lis_scheduler` policy)
- `engineering/api-design` (list-endpoint conventions for the new `GET /v1/sla-breaches`)

## 5. Assumptions & autonomous decisions

- **Polling-derived breach detection, not a literal per-row scheduled timer.** KB-25's prose
  ("the engine schedules durable timers... cancels timers when the tracked transition completes")
  reads like a per-aggregate timer object. This proposal instead reuses the proven, simpler
  `CriticalNotificationEscalationService` shape: a fixed-interval scan comparing `now()` against
  `ordered_test.createdAt + sla_target.targetMinutes` for still-unverified rows. This is
  functionally equivalent (a breach is detected within one poll interval of crossing the target,
  same latency class the existing critical-escalation job already accepts) without needing any new
  durable-timer infrastructure (no per-row scheduled job, no cancellation bookkeeping — "cancelled"
  is just "no longer matches the unverified-and-overdue `WHERE` clause"). Flagged for explicit
  approval in §10 Q1 since it's a real narrowing of KB-25's own literal wording, the same class of
  decision ADR-0029 already made once for the condition evaluator.
- **Poll interval: 5 minutes, matching `CriticalNotificationEscalationService`'s own
  `POLL_INTERVAL_MS`.** No stated reason to pick a different cadence; reusing the existing constant
  keeps one scheduling rhythm in the app rather than two.
- **`sla_breach` denormalizes `priority`/`targetMinutes` at breach time.** Same reasoning
  `workflow_definition` versioning already established: a later `sla_target` edit must never
  rewrite what a past breach's own record says was true when it fired.
- **No new capability; `manage_workflow` covers rule authoring, per FEAT-029's own precedent** —
  `SlaBreached` rules are just more rows in the same `workflow_definition.rules` array, authored
  through the same existing `POST /v1/workflow-definitions` endpoint.

## 6. Risks

- **Query cost at scale**: the detector's phase-1 enumeration scans `ordered_test` joined against
  `sla_target` for every unverified row, every 5 minutes, across every tenant — the same class of
  risk FEAT-034's own §8 already flagged for its own unindexed date-range TAT scan (`database-design`
  Skill entry #15). Needs its own `EXPLAIN ANALYZE` check against realistic data before shipping,
  not assumed safe by analogy.
- **Re-verification race** (§2, `notify-sla-breach.command.ts`) — a panel can verify between phase-1
  detection and the command handler's dispatch; handled as a logged no-op per Skill entry #4, but
  worth stating plainly: this is expected, not a bug, and must not throw.
- **`sla_breach` escalation and `critical_notification` escalation are two structurally identical
  but entirely separate systems** — a stat panel that's both critical *and* SLA-breached produces
  two independent notification rows today. Not unified in this proposal (no shared "operational
  alert" abstraction exists yet); flagged as a real, deliberate non-goal, not an oversight.

## 7. Acceptance criteria

- [ ] An `ordered_test` that crosses its `sla_target.targetMinutes` while still unverified produces
      exactly one `sla_breach` row and one `SlaBreached` outbox event, detected within one poll
      interval.
- [ ] A published `workflow_definition` rule with `"on": "SlaBreached"` and a matching `when`
      correctly fires `NotifySlaBreach`, recorded in `workflow_rule_firing`.
- [ ] A panel that verifies between breach-detection and rule-dispatch is a logged no-op, not a
      thrown error, and does not leave `sla_breach` in an inconsistent state.
- [ ] RLS: a breach in tenant A is invisible to tenant B via both the enumeration query and
      `GET /v1/sla-breaches`.
- [ ] A re-scan of an already-`pending` breach does not insert a second `sla_breach` row for the
      same `orderedTestId`.
- [ ] No change in behavior for delta-check, critical-notification, or calculated-field cascading
      — proven by the existing e2e suites for each passing unmodified, not just by not touching
      their files.

## 8. Testing plan

- Unit: `sla-breach-detector.service.spec.ts` — enumeration query shape; `notify-sla-breach
  .command.spec.ts` — the re-verification no-op path.
- e2e (real Postgres, matching `engineering/testing` Skill entry #1): backdate an `ordered_test
  .createdAt` (same technique as FEAT-034's TAT fixture, same append-only-safe reasoning — it's not
  `observation`), run the detector directly (not wait 5 real minutes), assert the `sla_breach` row
  and outbox event; publish an `SlaBreached` rule and assert `NotifySlaBreach` fires end-to-end
  through the real outbox relay; RLS cross-tenant isolation; re-verification race (verify the panel
  between detection and dispatch, assert a clean no-op).
- `EXPLAIN ANALYZE` the phase-1 enumeration query against a realistic row count before merging,
  per §6's own flagged risk — not deferred to a future finding the way FEAT-034's `ix_obs_trend`
  gap was, since this one is known up front.
- Full apps/api e2e suite run at least twice against a freshly reset DB to catch any fixture-window
  contamination early, per `engineering/testing` Skill entry #13's own lesson from this exact area
  of the codebase.

## 9. Rollback plan

Purely additive — a new table, a new module, one new `outboxHandlers.register()` call, and no
edits to any existing write path. Revertable by dropping the PR; no data migration of existing
rows is needed either direction.

## 10. Questions requiring human approval

1. **Polling-derived breach detection (§5) vs. a literal per-row durable timer.** Approve the
   simpler, `CriticalNotificationEscalationService`-shaped polling design, or require a real
   per-aggregate scheduled-timer mechanism (a materially larger build: durable timer rows,
   cancellation on verify, a scheduler that wakes exactly at each timer's due time rather than
   scanning on a fixed interval)? **Recommendation: approve polling** — matches this codebase's
   only existing precedent for "something needs to happen N minutes after an event," costs far
   less to build and reason about, and the latency difference (up to one poll interval, 5 minutes)
   is the same the existing critical-escalation job already accepts for a more safety-sensitive
   case.
2. **Who can read `GET /v1/sla-breaches`?** No existing capability obviously fits (`resolve_qc` is
   QC-specific; `view_operational_reports` is read-only aggregate reports, not a per-breach
   worklist). **Recommendation:** gate it behind `view_operational_reports` (already `qa`-only,
   already the "lab-oversight" persona this session established for FEAT-034) rather than
   inventing a new capability for one list endpoint — revisit if a future feature needs a narrower
   split.
3. **Should `sla_breach` and `critical_notification` be unified into one "operational alert" table
   in this pass, given §6 already names them as structurally identical?** **Recommendation: no** —
   unifying two already-shipped, independently-tested systems is exactly the kind of scope
   creep this proposal's own §1 argues against; a real future proposal if/when a third alert type
   makes the duplication actually costly, not speculatively here.
