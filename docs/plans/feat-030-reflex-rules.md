# Implementation Proposal: FEAT-030 — Reflex rules
Status: APPROVED
ADR: adr-0030 (reflex safety guardrails: cycle/depth bound, no-op-not-throw on unresolvable
command inputs — see §10 Q1)    Date: 2026-08-09    Backlog ID: FEAT-030 (issue #39)

## 1. Goal

Build KB-25's reflex/cascade sub-engine on top of FEAT-029's now-shipped mechanism: register
`AddReflexTest` as the **first real handler** in `WorkflowCommandRegistry` (which has shipped
empty since FEAT-029, exactly for this — see that registry's own header comment). When a
published rule's `when` matches a real `ObservationVerified` event and names
`do: {command: 'AddReflexTest', testCode: <code>}`, the handler creates a follow-on `ordered_test`
on the **same existing specimen** (no recollection), linked by a new lineage column so the whole
chain — triggering result -> rule fired -> reflex test created -> its own eventual result — is
traceable end-to-end. This is issue #39's literal, single acceptance criterion.

## 2. Affected files

- **Migration**: `ordered_test.parent_ordered_test_id` — nullable self-referencing FK (indexed),
  same `AnyPgColumn`-typed self-FK pattern `specimen.parentSpecimenId` already establishes in this
  codebase for aliquot lineage. A non-null value **is** the "this row was reflex-created" marker —
  no separate boolean column needed.
- New `apps/api/src/reflex/` module (deliberately separate from `apps/api/src/workflow/` — see
  §5): `add-reflex-test.command.ts` (the handler itself), `reflex.module.ts` (imports
  `WorkflowModule` for `WorkflowCommandRegistry`, registers `'AddReflexTest'` in `onModuleInit`,
  exactly mirroring how `WorkflowEngineService` registers itself against `OutboxHandlerRegistry`
  in FEAT-029).
- `packages/db/src/schema/order.ts` — add the new column to `orderedTest`.
- `apps/api/src/app.module.ts` — import `ReflexModule`.
- **Not touched**: `workflow-types.ts`/`workflow-condition-evaluator.ts`/`workflow-guardrails.ts` —
  `do: { command: string; [key: string]: unknown }` already accepts an arbitrary `testCode` field;
  no new `ALLOWED_FIELDS` entries are needed since a reflex rule's own `when` evaluates the same
  `ObservationVerified` payload shape FEAT-029 already exposes (e.g.
  `analyteId == 'TSH' && valueNum > 5.0`).
- `engineering/workflow-engine` Skill drafted from KB-25 + this feature's real findings
  (lis-engineering) — it does not exist yet; drafted now that the engine has a real command
  handler to document, not speculatively ahead of one (same discipline
  `domain/analyzer-integration` followed for FEAT-026).

## 3. Architecture consulted

- **KB-25 Workflow Engine**, specifically the "reflex/cascade sub-engine" section: condition lives
  on catalog data (here: the rule itself, per ADR-0029's already-chosen model, not literally on
  `TestDefinition` — see §5), orchestration lives in the engine; cascade depth bounded and
  cycle-checked; acts on the existing specimen where possible, else raises a recollection task.
- **ADR-0029** — `do: {command, ...}` shape reused unchanged; no evaluator/guardrail changes.
- **ADR-0028** — outbox is at-least-once, no dead-letter queue. This directly shaped §5's
  no-throw design for expected failure modes (see below): a command handler that throws for an
  *ordinary, expected* condition (bad `testCode`, a cyclical rule) would otherwise retry forever
  under this accepted design, and — because `WorkflowEngineService.handleEvent()` wraps its whole
  per-event rule loop in **one** transaction (FEAT-029's existing boundary, unchanged by this
  proposal) — a single throwing rule blocks every other rule in that same event from ever
  recording its own firing, every retry, indefinitely.
- `workflow-command.registry.ts`'s own header comment — explicit pointer that FEAT-030 is the
  first real registrant.
- `CriticalNotificationEscalationService` — the exact precedent for a non-HTTP, system-triggered
  write path's audit call: `writeAuditEvent(tx, {actorType: 'service', actorRole: 'system', ...})`
  directly, not the `@Audit()` decorator (which only wraps HTTP routes).
- Constitution Law #5 (every clinically significant action audited) — governs the audit-write
  requirement below.
- Schema review confirmed (by grep, not assumed): `specimen` has no volume/expiry/stability-window
  field of any kind — governs the explicit scope exclusion in §5.

## 4. Skills loaded

- `engineering/workflow-engine` — does not exist yet; drafted as part of this feature's own PR
  (§2), after the real shape is proven, not ahead of it.
- `engineering/database-design` — the self-FK pattern (`specimen.parentSpecimenId`) and entries
  #13/#14 (both from this session, both about this exact `db`/RLS/transaction machinery).
- `engineering/testing` entry #6 (vitest/esbuild `design:paramtypes` gap) — expected to recur in
  the new module's constructor injection, same as every prior feature this session.

## 5. Assumptions & autonomous decisions

- **Reflex condition lives in the rule's own `when`, not on `TestDefinition`.** KB-25's original
  vision splits the clinical *condition* onto the catalog (`TestDefinition`) and the *orchestration*
  into the engine. ADR-0029 already established a different, working model: the condition **and**
  the action both live in `workflow_definition.rules`, authored by `qa` via the existing
  `POST /v1/workflow-definitions` endpoint. This proposal continues that established precedent
  rather than reopening it — a lab scientist authors `{analyteId: 'TSH', valueNum: '>5.0'} ->
  AddReflexTest(FreeT4)` as one rule, the same way every other rule is authored, rather than a new,
  separate "reflex condition" field on the catalog. No catalog schema change.
- **`do` shape**: `{command: 'AddReflexTest', testCode: string}`. `testCode` resolves to
  `testDefinitionId` via `(tenantId, code)` — the identical lookup pattern already proven in
  `analyzer-correlation.service.ts`/`workflow.e2e-spec.ts`'s own `GLUCOSE_CODE` fixture.
- **Acts on the existing specimen, never recollects** (KB-25's own stated preference): the handler
  creates a new `specimen_fulfillment` row linking the reflex `ordered_test` to the **same**
  `specimen` that fulfilled the triggering `ordered_test` (resolved via the triggering
  `orderedTestId`, already present on the `ObservationVerified` payload's own `orderedTestId`
  field). New `ordered_test.status` starts at `'received'` directly — it skips `'ordered'`/
  `'collected'` because no physical collection step occurs for material already in hand.
- **Specimen exhaustion/expiry is explicitly out of scope.** KB-25 says an exhausted/expired
  specimen should raise a recollection task instead of silently failing. This repo's `specimen`
  table has no volume, expiry, or stability-window field at all today (confirmed by grep, not
  assumed) — there is nothing to check. Building a recollection-task fallback against a condition
  that cannot currently be detected would be speculative, not real coverage. Flagged as a genuine,
  real gap for a follow-up issue (see §10 Q2), not silently dropped.
- **Idempotent by construction** (KB-25's own literal requirement, "a no-op if it already exists"):
  before inserting, the handler checks whether an `ordered_test` with the same
  `(parentOrderedTestId, testDefinitionId)` pair already exists; if so, it is a no-op (recorded as
  `dispatched: true` — the handler ran, it just correctly did nothing). This is what makes the
  outbox's own at-least-once redelivery safe for this handler specifically.
- **Cycle/depth guardrail, no-op-and-log rather than throw.** Before inserting, the handler walks
  the `parent_ordered_test_id` chain (a bounded recursive query) collecting ancestor
  `testDefinitionId`s and counting depth. If the target `testDefinitionId` is already an ancestor
  (a cycle) or depth would exceed a fixed constant (proposing **5**, conservative, documented in
  code, not derived from any real lab data since none exists), the handler does **not** create the
  test, does **not** throw, and writes a log line explaining why — recorded to
  `workflow_rule_firing` as `dispatched: true` regardless (the handler ran; declining to act on a
  safety guardrail is itself part of the traceable outcome KB-25 asks for). Chosen specifically
  because of the ADR-0028 interaction described in §3: throwing here would retry-storm forever and
  block every other rule sharing that event, for a condition (a misconfigured rule set) that a
  human review can fix at the rule level, not by retrying the same event indefinitely.
- **An unresolvable `testCode` gets the identical no-op-and-log treatment**, for the same
  ADR-0028-interaction reason — not a thrown, retried-forever error. Genuinely unexpected failures
  (e.g. a DB connectivity error) are left to propagate and retry normally; only these two *expected,
  configuration-shaped* failure modes are handled as guardrail no-ops.
- **Audited via a direct `writeAuditEvent(tx, ...)` call**, not `@Audit()` — the handler runs from
  `OutboxRelayService`'s `@Interval` tick, never an HTTP request, so the decorator (route-only)
  doesn't apply. Mirrors `CriticalNotificationEscalationService`'s exact `actorType: 'service'`
  pattern, with the handler's own local sentinel actor id (not a shared constant — only the second
  such caller in this codebase; extracting a shared one is real, deferred work if a third appears).
- **New `apps/api/src/reflex/` module, not folded into `apps/api/src/workflow/`.** Keeps FEAT-029's
  general engine mechanism and FEAT-030's first real, domain-specific command handler in separate,
  independently reviewable modules — the same layering FEAT-028 -> FEAT-029 already established
  (`OutboxModule` <- `WorkflowModule`), extended one level further (`WorkflowModule` <-
  `ReflexModule`).

## 6. Risks

- The bounded-depth constant (5) and the "no-op, don't throw" guardrail behavior are both new,
  unprecedented safety choices in this codebase — reasoned from KB-25 + the ADR-0028 interaction,
  but not something any existing code already does that this proposal can point to as precedent.
  Flagged explicitly for human review (§10 Q1), and captured as ADR-0030 given it's a real,
  load-bearing safety decision, not a routine implementation detail.
- Reusing `parent_ordered_test_id` as both "the lineage pointer" and the implicit "was this
  reflex-created" signal means a hypothetical future feature wanting ordered-test lineage for a
  *non-reflex* reason (e.g. a human manually linking a related test) would collide with this
  semantics. No such feature exists yet — noted, not solved speculatively.
- No new UI this pass (matches the issue's own "not applicable, no new UI" line) — lineage is only
  queryable via `parentOrderedTestId` + `workflow_rule_firing` joins, not surfaced on any screen.
  A worklist/report view showing reflex lineage explicitly is real, deferred follow-on work.

## 7. Acceptance criteria

- [ ] A published rule with `do: {command: 'AddReflexTest', testCode: <code>}` whose `when` matches
      a real `ObservationVerified` event creates a new `ordered_test` (status `'received'`,
      `parentOrderedTestId` set) linked via a new `specimen_fulfillment` row to the same specimen
      that fulfilled the triggering test — issue #39's literal AC, proven end-to-end through a real
      draft/finalize/verify -> outbox relay -> reflex creation chain.
- [ ] Lineage is traceable end-to-end: given the reflex `ordered_test`'s id, its parent
      `ordered_test`, the triggering rule (via `workflow_rule_firing`), and the original specimen
      are all recoverable by query.
- [ ] Idempotent: redelivering the same `ObservationVerified` event does not create a duplicate
      reflex `ordered_test`.
- [ ] A rule set that would create a cycle, or exceed the bounded depth, does not create the test
      and does not throw/retry-storm; recorded as `dispatched: true` with a clear log explaining
      the no-op.
- [ ] An unresolvable `testCode` gets the same no-op-and-log treatment, not a thrown/retried error.
- [ ] The reflex `ordered_test`'s creation is audited (`writeAuditEvent`, `actorType: 'service'`).
- [ ] RLS isolation exercised for the new column/query paths (no new tenant-scoped table this
      feature).

## 8. Testing plan

- Unit tests: the cycle/depth-detection logic in isolation (a pure function over an ancestor-chain
  array), and the idempotency-check branch.
- e2e: a real published rule (`when: analyteId == 'TSH' && valueNum > 5.0`, `do: AddReflexTest
  testCode=<a seeded reflex-target code>`) evaluated against a real draft/finalize/verify of a TSH
  result on a real specimen fixture, delivered via `OutboxRelayService.tick()` — asserts the new
  `ordered_test` row, its `specimen_fulfillment` row against the same specimen, and its
  `audit_event` row. A second `tick()` (simulating outbox redelivery) proves no duplicate is
  created. A rule crafted to cycle back to its own ancestor proves the guardrail no-ops without
  throwing. A rule naming an unresolvable `testCode` proves the same. An RLS isolation test for the
  new lineage column/query path.
- If the seed catalog has no natural reflex pair (e.g. TSH -> Free T4) already, add one to
  `db/seed/chemistry-catalog.sql` as test fixture data, following the existing "placeholder,
  design-partner sign-off is separate" convention already documented in that seed file's own header.

## 9. Rollback plan

One additive nullable column (`ordered_test.parent_ordered_test_id`) + one new command handler
registration (`ReflexModule` import in `AppModule`). Reversible via dropping the column and
removing the import; no existing write path is touched or modified.

## 10. Questions requiring human approval — RESOLVED 2026-08-09

1. **Cycle/depth-bound design (§5) — RESOLVED: approved as proposed.** Max depth 5; cycle/bad-
   `testCode` handled as no-op-and-log, never throw/retry. Written up as **ADR-0030**.
2. **Specimen exhaustion/expiry (§5) — RESOLVED: approved, deferred.** Out of scope this pass; a
   follow-up issue is filed (see below) tracking it separately from #39.
3. **New `apps/api/src/reflex/` module (§5) — RESOLVED: approved as proposed.**
4. **`engineering/workflow-engine` Skill (§2/§4) — RESOLVED: approved, drafted in this PR.**
