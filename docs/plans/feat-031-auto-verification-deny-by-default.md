# Implementation Proposal: FEAT-031 — Auto-verification (deny-by-default)
Status: IMPLEMENTED (merged 2026-08-09, PR #443, commit 0c98acd4ccce4fcd473f9edb1b37341610c0ea2d)
ADR: adr-0031 (auto-verification safety design: four hard-coded gates, AutoVerifyObservation as a
new command with VerifyObservation staying denylisted forever, handler-level dry-run — see §10)
Date: 2026-08-09    Backlog ID: FEAT-031 (issue #40)

## 1. Goal

Build KB-25's "safety core": a new `AutoVerifyObservation` handler — the second real
`WorkflowCommandRegistry` registrant after FEAT-030's `AddReflexTest` — that releases an
Observation to `verified` **without a human**, but only when it affirmatively passes every one of
a fixed, hard-coded set of deny-by-default gates re-checked directly against live database state.
The workflow rule's own `when` condition is a coarse, configurable pre-filter (e.g. "only consider
analyzer-sourced results"); it is **never** the safety boundary. The safety boundary is the
handler itself, unconditionally, regardless of how any rule is configured — this is what makes
issue #40's AC #2 ("never auto-verified under any configuration") true by construction rather than
by review discipline. Also delivers AC #3 (dry-run) by making dry-run a real property the engine
and handler both honor, not just a documentation convention.

## 2. Affected files

- **Migration**: `workflow_rule_firing.dry_run` — boolean, `NOT NULL DEFAULT false`. Records
  whether a firing ran in dry-run mode, so a review query can distinguish "this would have
  auto-verified" firings from live ones without guessing from `dispatched` alone.
- `apps/api/src/workflow/workflow-types.ts` — `WorkflowRule` gains an optional `dryRun?: boolean`
  field (default false/undefined = live).
- `apps/api/src/workflow/workflow-schemas.ts` — the create-schema accepts `dryRun` per rule.
- `apps/api/src/workflow/workflow-command.registry.ts` — `WorkflowCommandHandler`'s signature gains
  a 5th parameter, `firingContext: { workflowDefinitionId: string; ruleId: string; dryRun: boolean
  }` — needed so a handler can (a) record which rule/definition version released a result (KB-25's
  own explicit requirement: "each auto-verified result records the rule set version that released
  it") and (b) honor dry-run itself (see §5 on why the *engine* skipping the handler entirely isn't
  enough for this particular command).
- `apps/api/src/workflow/workflow-engine.service.ts` — passes `{workflowDefinitionId: definition.id,
  ruleId: rule.id, dryRun: rule.dryRun === true}` to the handler call; writes `dryRun` onto the
  `workflow_rule_firing` insert.
- `apps/api/src/observation/observation.controller.ts` — `finalize()` gains a new
  `writeOutboxEvent(tx, {eventType: 'ObservationFinalized', payload: toObservationDto(updated)})`
  call, mirroring `verify()`'s own existing `ObservationVerified` emission exactly. This is the
  **first new outbox event type since FEAT-028** — auto-verify needs to react when a result becomes
  eligible for verification (`status: 'preliminary'`), and nothing currently fires at that point;
  `ObservationVerified` only fires *after* verification already happened, too late to trigger it.
- `apps/api/src/observation/observation-write.service.ts` — new method,
  `applyVerification(tx, existingRow, actor): Promise<ObservationRow>` — the raw 3-field UPDATE
  (`status: 'verified'`, `verifierUserId`, `verifiedAt`) hoisted out of the controller's `verify()`
  body, callable by both the HTTP route and the new handler. A small, surgical extraction (not a
  restructure like ADR-0027's) — `verify()`'s own 404/409 precondition checks stay exactly where
  they are; only the final UPDATE moves.
- `apps/api/src/observation/observation.controller.ts` — `verify()` calls the new shared method
  instead of inlining the UPDATE.
- New `apps/api/src/auto-verify/` module: `auto-verify-observation.command.ts` (the handler),
  `auto-verify.module.ts` (imports `WorkflowModule`, registers `'AutoVerifyObservation'` in
  `WorkflowCommandRegistry`'s `onModuleInit`, mirroring `ReflexModule`'s own layering).
- `apps/api/src/app.module.ts` — import `AutoVerifyModule`.
- **Not touched**: `workflow-guardrails.ts`'s denylist. `AutoVerifyObservation` is a **new, distinct**
  command name — `'VerifyObservation'` stays denylisted forever (see §5). No relaxation of the
  existing guardrail validator is needed or proposed.
- `engineering/workflow-engine` Skill (lis-engineering) gets new entries from this feature's real
  findings (the `ObservationFinalized` event, the handler-is-the-safety-boundary design, the
  dry-run mechanism) — `domain/critical-values` Skill gets a cross-reference entry pointing here.

## 3. Architecture consulted

- **KB-25**, "Auto-verification (the safety core)" section verbatim: "An Observation auto-verifies
  only if it affirmatively passes *every* gate: in analytic range, not critical, delta-check
  passed, QC in control, no instrument error flag, patient context complete. Any miss -> human
  review queue." Also: "Criticals never auto-verify. This is a hard invariant... not a configurable
  rule." Also the Guardrails section's own general principle that a fixed set of invariants sits
  *below* the metadata layer.
- **KB-14**, "Validation, flagging, delta checks, criticals" pipeline (type/unit validation ->
  range/flagging -> critical detection -> delta check -> plausibility/QC) and its own "Auto-
  verification" paragraph: "Configurable rules (metadata) can auto-verify observations that pass
  all checks... Anything failing routes to a human worklist. Auto-verification decisions are
  audited."
- **Constitution Law #3** verbatim, and `FinalizationRollupInterceptor`
  (`apps/api/src/observation/finalization-rollup.interceptor.ts`) — the existing, already-shipped
  enforcement of that law at panel-completion time. Read closely to confirm no interaction/gap:
  that interceptor only runs inside the `finalize()` HTTP route and only ever gates
  `ordered_test.status -> 'resulted'`; it never touches `observation.status`. Human `verify()` and
  the new auto-verify handler both only ever flip `observation.status: preliminary -> verified`,
  entirely orthogonal to that gate — same blast radius as the existing human path, not a new
  interaction to reason about.
- `packages/db/src/flagging.ts`'s `computeFlags`/`mergeDeltaFlag` — read directly, not assumed:
  `flags` is `N|L|H|LL|HH` (exactly one severity flag) with `D` appended independently. "Clean
  normal" (the in-range-and-not-critical-and-no-delta gate) is precisely `flags.length === 1 &&
  flags[0] === 'N'` — anything else (including `['N','D']`) fails.
- `apps/api/src/observation/finalization-rollup.interceptor.ts`'s own QC-violation gate query
  (ADR-0019) — read and reused verbatim as the "QC in control" check: no unresolved
  (`resolvedAt IS NULL`), `severity = 'rejection'` `qc_rule_violation` row exists for this
  observation's `analyteId`, scoped by analyte alone (matching that gate's own documented
  over-block decision — `control_lot.instrumentId` is never populated by any code today).
- ADR-0029 (`workflow-guardrails.ts`'s denylist rationale) and ADR-0030 (`AddReflexTest`'s own
  transaction-threading and no-op-not-throw precedents) — both directly reused, not re-derived (see
  §5).
- Grepped for any "instrument error flag" or "patient context completeness" concept anywhere in
  this codebase: **neither exists**. KB-25/KB-14 name both as gates; this proposal does not build
  either (see §5/§10 Q1) — same "don't build against fields that don't exist" discipline FEAT-030
  applied to specimen exhaustion/expiry (issue #440).

## 4. Skills loaded

- `domain/critical-values` — all 8 entries, especially #1 (critical detection already exists as a
  flags-column side effect, don't rebuild it), #2 (the critical range low/high inversion, already
  correctly handled by the code this proposal reuses), #4 (no event bus existed at FEAT-015's own
  time — now FEAT-028 exists, and this proposal's own new `ObservationFinalized` event is exactly
  the kind of real, deliberate producer that Skill entry anticipated becoming necessary, not an
  ad hoc invention).
- `engineering/workflow-engine` — all 7 entries, especially #3 (transaction-threading — this
  feature's handler follows the identical `tx`-only rule) and #4 (no-op-not-throw for expected
  failures — reused directly, see §5).
- `engineering/database-design` entries #13/#14 (unaffected here, but the transaction-threading
  discipline they document is exactly what keeps this feature's own handler safe under
  `DB_POOL_MAX=1`).

## 5. Assumptions & autonomous decisions

- **The handler is the sole safety boundary; the rule's `when` is a coarse pre-filter only.** A
  rule's `when` condition can only reference fields already on the `ObservationFinalized` payload
  (`toObservationDto`'s shape — `analyteId`, `valueNum`, `unit`, `flags`, `status`, `source`,
  `dataType`, already covered by the existing `ALLOWED_FIELDS` allow-list, no evaluator change
  needed). It **cannot** express "QC in control" (that requires a `qc_rule_violation` table lookup,
  not a field on the event payload) — so even a maximally permissive rule (`when: {field: 'status',
  op: 'eq', value: 'preliminary'}`, matching everything) still cannot auto-verify a critical or
  QC-held result, because the handler independently re-checks every gate against live DB state
  before ever writing. This is *why* this proposal does not need KB-25's own implied "publish-time
  static analysis proving the condition excludes criticals" — there is nothing a condition could do
  to bypass a check it structurally cannot express or influence.
- **Four gates, all re-derived from real, already-existing signals, all required, all hard-coded
  (not configurable per rule):**
  1. **Clean normal**: `flags.length === 1 && flags[0] === 'N'` — simultaneously satisfies "in
     analytic range," "not critical," and "delta-check passed" in one check, since `computeFlags`/
     `mergeDeltaFlag` already guarantee any of H/L/HH/LL/D shows up in the array if applicable.
  2. **Not critical** (Constitution Law #3, checked explicitly and redundantly with gate 1 on
     purpose — defense in depth for the one gate the Constitution names as a hard invariant, not
     merely inferred from gate 1 passing): `!flags.includes('HH') && !flags.includes('LL')`.
  3. **QC in control**: no unresolved, rejection-severity `qc_rule_violation` for this
     observation's `analyteId` (the exact query `FinalizationRollupInterceptor` already runs,
     reused verbatim).
  4. **Source is `'analyzer'`**: KB-25's own illustrative rule gates on `source == 'analyzer'`.
     Proposed as a **hard-coded handler requirement**, not left to a rule author's own `when`
     clause — a manually-typed result already has a human in the loop by construction; removing a
     review step from a human-entered value doesn't reduce workload the way it does for a machine
     result, and a lab should not be able to configure this boundary away. **Flagged for explicit
     approval, §10 Q2** — this is a real, debatable scoping choice, not a fact.
  Deliberately **not built**: "no instrument error flag" and "patient context complete" (KB-25/
  KB-14's other two named gates) — neither concept exists anywhere in this schema today (confirmed
  by grep, not assumed). Building a check against fields that don't exist would be speculative, not
  real coverage — same discipline as issue #440's own scoping.
- **New `ObservationFinalized` outbox event**, emitted from `finalize()` in the same transaction as
  the status update, identical shape/pattern to `verify()`'s existing `ObservationVerified`
  emission. Named for *this* repo's real state machine (`registered -> preliminary -> verified`),
  not copied literally from KB-25's own illustrative `ObservationRegistered` (which doesn't map
  onto this codebase's actual status vocabulary — `'registered'` here means "drafted, not yet
  finalized," the wrong point to trigger auto-verify eligibility from).
- **New command name `AutoVerifyObservation`, not the literal `VerifyObservation`.** ADR-0029's own
  resolution anticipated "FEAT-031 is the feature that earns the right to register that command and
  correspondingly relax this validator" — this proposal deliberately does **not** do that. Keeping
  `'VerifyObservation'` permanently denylisted and unreachable from any workflow rule is a real,
  permanent safety boundary in its own right: nobody should ever be able to configure a rule that
  invokes the literal human-verification action's own name, which would blur the actor/audit
  distinction this proposal otherwise keeps clean (`observation.auto_verify`, `actorType:
  'service'`, vs. `observation.verify`, `actorType: 'human'`). No change to
  `workflow-guardrails.ts`'s denylist is needed or proposed — flagged for explicit approval, §10 Q3,
  since it's a real deviation from what ADR-0029 anticipated.
- **Audited via a direct `writeAuditEvent(tx, ...)` call**, not `@Audit()` (HTTP-route-only, same
  reasoning as `AddReflexTest`'s own precedent) — `action: 'observation.auto_verify'` (distinct from
  the human path's `'observation.verify'`), `actorType: 'service'`, and `context: {
  workflowDefinitionId, ruleId }` so the audit trail directly answers KB-25's own requirement
  ("records the rule set version that released it") without a new column anywhere.
- **Dry-run is honored by the handler itself, not by the engine skipping the handler.** A rule
  author needs to know *whether a given finalized result would actually have passed every gate*,
  not merely whether its own `when` pre-filter matched — the two are different questions, and only
  the handler can answer the first one (the gates aren't expressible as `when` conditions at all,
  per the point above). So: the engine still calls the handler for a `dryRun: true` rule, passing
  `firingContext.dryRun: true`; the handler runs every gate check exactly as normal and logs the
  real outcome (which gate, if any, would have blocked it), but skips the actual `UPDATE`/audit/
  outbox-write on success. `workflow_rule_firing.dry_run` records this so a review query
  (`dry_run = true` firings that would have qualified) is a real, meaningful signal a lab can review
  before flipping a rule live — not just "the rule syntactically matched something." Flagged for
  explicit approval, §10 Q4, since a cheaper "engine never calls the handler" alternative exists and
  this proposal is choosing the more informative but slightly more involved one deliberately.
- **`manage_workflow` (existing capability, `qa`-only) governs authoring an auto-verify rule** —
  same as every other workflow rule (FEAT-029/030); no new capability.

## 6. Risks

- This is the most safety-critical automation this codebase has ever shipped — Constitution Law #3
  by name. The four-gate design is deliberately conservative and re-derives every check from
  already-proven code paths (the same flags/QC-violation logic `FinalizationRollupInterceptor`
  already gates panel completion on) rather than inventing new logic, specifically to minimize the
  surface of anything genuinely new that could be wrong. Reviewed carefully in this proposal's own
  §7/§8, not assumed safe by construction alone.
- `ObservationFinalized` is a new, permanent addition to this tenant's event surface — any future
  workflow rule can now react to *every* finalized result, not just verified ones. This is a
  strictly additive capability (more events to react to), not a risk to existing behavior, but
  worth noting as a real, permanent expansion of what's observable to the rule engine.
- The `source: 'analyzer'`-only restriction (§5, gate 4) means this feature does not (yet) reduce
  manual-entry review burden at all — acceptable and arguably correct for a first, conservative
  pass, but worth being explicit that this narrows AC #1's "in-range, QC-passed results auto-verify
  correctly" to analyzer-sourced results specifically, not literally every in-range result
  regardless of source.
- No golden-dataset coverage exists for auto-verification specifically (golden datasets validate
  reference ranges, not workflow behavior) — this feature's own e2e tests are the only proof,
  matching FEAT-029/030's own precedent (workflow correctness isn't golden-dataset-shaped).

## 7. Acceptance criteria

(directly issue #40's own three, made concrete)

- [ ] An analyzer-sourced, clean-normal (flags exactly `['N']`), QC-in-control result, once
      finalized, is auto-verified by a live `AutoVerifyObservation` rule — `observation.status ->
      'verified'`, `verifierUserId` unset (no human), audited as `observation.auto_verify` with
      `actorType: 'service'` and the releasing rule/definition id in `context`, and a real
      `ObservationVerified` outbox event emitted.
- [ ] A critical (HH/LL) result is never auto-verified, proven for real against the handler's own
      gate — not merely asserted from reading the code — regardless of how permissively the rule's
      own `when` condition is written (e.g. even `{field: 'status', op: 'eq', value:
      'preliminary'}`, matching everything).
- [ ] A result held by an unresolved, rejection-severity QC violation is never auto-verified.
- [ ] A manually-entered (`source: 'manual'`) result, even if otherwise clean-normal, is never
      auto-verified (gate 4, §5).
- [ ] A `dryRun: true` rule never performs a real verification, but its firings distinguishably
      record whether the result *would have* qualified (all four gates passed) via
      `workflow_rule_firing.dry_run` plus the handler's own logged outcome — reviewable before the
      rule is ever published live.
- [ ] RLS isolation exercised for the new migration column/query paths (no new tenant-scoped table
      this feature).

## 8. Testing plan

- e2e (real pipeline, matching `reflex.e2e-spec.ts`/`workflow.e2e-spec.ts`'s own style): a real
  published rule (`on: 'ObservationFinalized'`, `do: {command: 'AutoVerifyObservation'}`) against a
  real draft/finalize of an analyzer-sourced, in-range chemistry result -> `OutboxRelayService
  .tick()` -> asserts `observation.status = 'verified'`, `verifierUserId IS NULL`, the audit row,
  and the `ObservationVerified` outbox row it itself produces.
- A critical (e.g. Potassium >= 6.5) analyzer-sourced result, same rule: asserts it is **not**
  auto-verified (stays `'preliminary'`) and the panel-hold/critical-notification path is completely
  unaffected (still works exactly as `critical-notification.e2e-spec.ts` already proves).
- A result held by a real, seeded unresolved rejection-severity `qc_rule_violation` for the same
  analyte: asserts it is not auto-verified.
- A manually-entered (`source: 'manual'`) clean-normal result: asserts it is not auto-verified
  (gate 4).
- A `dryRun: true` rule against a real qualifying result: asserts `observation.status` stays
  `'preliminary'` (nothing actually happened) but a `workflow_rule_firing` row with `dry_run: true`
  and (however §10 Q4 resolves) the would-have-qualified signal is recorded.
- Unit tests for the gate-check logic in isolation (pure function over a flags array + a boolean
  "QC held"/"is analyzer" pair), same style as `reflex-guardrails.spec.ts`.
- RLS isolation test for the new column/query path.

## 9. Rollback plan

One additive column (`workflow_rule_firing.dry_run`), one new outbox event type (additive — no
existing consumer breaks), one small extraction in `ObservationWriteService` (behavior-preserving,
verified by the existing `verify()`-path e2e tests passing unchanged), and one new command handler
registration. Reversible via dropping the column, removing the `AutoVerifyModule` import, and
reverting the `finalize()`/`observation-write.service.ts` changes; no data migration needed since
nothing downstream depends on `ObservationFinalized` existing except this feature's own handler.

## 10. Questions requiring human approval — RESOLVED 2026-08-09

1. **Four hard-coded gates (§5) — RESOLVED: approved as proposed.** Written up as **ADR-0031**.
2. **Source-is-analyzer as a hard-coded handler requirement (§5) — RESOLVED: approved.** Manually
   entered results are never auto-verify-eligible under any rule configuration.
3. **New command name `AutoVerifyObservation`, `VerifyObservation` stays denylisted forever (§5) —
   RESOLVED: approved as proposed.**
4. **Handler-level dry-run (§5) — RESOLVED: approved as proposed.**
