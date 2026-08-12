# Implementation Proposal: FEAT-060 — Reflex/add-on stains & IHC on existing blocks
Status: APPROVED
ADR: none (no load-bearing decision found — see §5)
Date: 2026-08-12    Backlog ID: #545 (FEAT-060, depends on FEAT-057 #538, FEAT-030)

**Approved 2026-08-12** via the native options-prompt — all three §10 questions answered with the
Recommended option as drafted: (1) separate `AddBlockReflexTest` command, not a parameterized
`AddReflexTest`, (2) no new ADR, (3) placeholder catalog fixture name, matching this repo's own
existing chemistry/haematology placeholder-catalog convention.

## 1. Goal

Special stains and immunohistochemistry (IHC) ordered as reflex/add-on rules that create new
OrderedTests on **existing blocks** — no recollection, traceable to the originating block (KB-17,
KB-25). Reuses the reflex-cascade engine already proven twice (FEAT-030's `AddReflexTest`,
FEAT-052's culture→organism-ID cascade — which added zero new handler code, only new
`workflow_definition` rule configuration reusing the same handler) — applied to anatomic
pathology as a third discipline, not rebuilt.

The one genuine difference from FEAT-030's existing handler: `AddReflexTest` links a reflex
`ordered_test` to its parent's **specimen** via `specimen_fulfillment`. AP reflexes/add-ons must
link to the parent's **block** via `block_fulfillment` instead (ADR-0049 §Decision 4, the table
FEAT-057 already built specifically for this: "reflex/add-on stains and IHC create new
OrderedTests on existing blocks" — until now, unused by any automated path, only by
`case.controller.ts`'s manual `POST /v1/blocks/:id/ordered-tests` route). This proposal adds one
new command handler for that one real difference; everything else (event, guardrails, rule
model, audit) is reused unchanged.

## 2. Affected files

- `apps/api/src/reflex/add-block-reflex-test.command.ts` (new) — `addBlockReflexTestHandler`,
  closely mirroring `add-reflex-test.command.ts`'s own structure (idempotency check, cycle/depth
  guardrails via the existing `checkReflexGuardrails`/`MAX_REFLEX_DEPTH`, no-op-and-log for every
  "cannot safely act" branch). The one real difference: resolves the parent's **block** via
  `block_fulfillment.orderedTestId = triggering event's orderedTestId` (not
  `specimen_fulfillment`), and inserts the new `ordered_test` linked to that **same block** via a
  new `block_fulfillment` row. If the triggering ordered_test has no `block_fulfillment` row at
  all (i.e. it isn't part of an AP case), logs a no-op — this is what makes the handler safely
  inert for chemistry/haematology/microbiology events without needing a new/filtered trigger
  event.
- `apps/api/src/reflex/reflex.module.ts` — registers the new handler as `'AddBlockReflexTest'` in
  `WorkflowCommandRegistry`, alongside the existing `'AddReflexTest'` registration (same module,
  same `ReflexCommandRegistration.onModuleInit()`, one more `this.commands.register(...)` call —
  not a new module, since this is still the reflex/cascade sub-engine's own domain).
- `apps/api/src/reflex/add-block-reflex-test.command.spec.ts` (new, if any pure logic is
  extracted beyond what `reflex-guardrails.spec.ts` already covers — otherwise this handler's own
  DB-touching logic is covered entirely by the e2e spec below, matching `add-reflex-test.command.ts`'s
  own precedent of having no dedicated unit spec, only `reflex-guardrails.spec.ts` for the pure
  part it reuses unchanged).
- `apps/api/test/reflex-block.e2e-spec.ts` (new) — proves both issue #545 ACs against a real
  published `workflow_definition` rule, a real block fixture (mirroring `case.e2e-spec.ts`'s own
  "AC #4: an add-on/reflex stain creates a new OrderedTest on an existing block" manual-route test
  shape, but automated via a real `ObservationVerified` event + `OutboxRelayService.tick()`,
  mirroring `reflex.e2e-spec.ts`'s own real-event-through-real-pipeline style), and a real
  `test_definition` fixture for the stain/IHC test itself (a placeholder catalog name, same class
  as this repo's existing `chemistry-catalog.sql`/`haematology-catalog.sql` placeholder framing —
  see §5, not a coded clinical vocabulary entry needing citation the way FEAT-058's synoptic
  elements did).
- No new migration — `block_fulfillment` (FEAT-057) and `workflow_definition`/`workflow_rule_firing`
  (FEAT-029) already exist with the columns this needs.
- `engineering/workflow-engine` Skill — a new entry documenting the block-vs-specimen fulfillment
  split for reflex handlers, once implemented (AGENTS.md's same-day Skill-extension rule).

## 3. Architecture consulted

- **KB-17 Histology** — "Special stains and immunohistochemistry (IHC) are ordered via reflex or
  add-on rules that create new OrderedTests on the existing blocks"; design-decisions table's own
  "Reflex/add-on OrderedTests on existing blocks... No recollection; traceable to block" row.
- **KB-25 Workflow Engine** — the reflex/cascade sub-engine section in full (condition-on-catalog
  vs. orchestration-in-engine split, cascade depth/cycle bounding, acts on existing
  specimen/no-recollection).
- **`engineering/workflow-engine` Skill** (17 entries, loaded in full) — entry #1 (condition+action
  both live in `workflow_definition.rules`, no catalog-level reflex field), #3 (a handler must
  never open its own `db.transaction()` — the engine's own `tx` is threaded through), #4
  (no-op-and-log, never throw, for expected/configuration failures — ADR-0028's no-DLQ design),
  #5 (`parentOrderedTestId` self-FK is the reflex-lineage marker, no separate flag), #6 (reflex
  acts on the existing specimen, no recollection — same reasoning extends to "acts on the
  existing block" here, and `block` has no volume/expiry field either, confirmed by reading
  `packages/db/src/schema/anatomic-pathology.ts` directly), #7 (`WorkflowCommandRegistry` vs.
  `OutboxHandlerRegistry` — this is a new `WorkflowCommandRegistry` registrant, not a new outbox
  consumer), #9 (a rule's `when` is never the safety boundary — not directly load-bearing here
  since this handler has no patient-safety gate beyond the existing cycle/depth guardrails, but
  kept in mind), #10 (handler signature carries `firingContext` — not used by this handler, same
  as `addReflexTestHandler` itself doesn't use it, since there is no dry-run-sensitive or
  rule-version-recording need beyond what `writeAuditEvent` already captures via `action`).
- **`apps/api/src/reflex/add-reflex-test.command.ts`** (read in full) — the exact handler shape
  mirrored: idempotency check (existing `parentOrderedTestId` + `testDefinitionId` pair), ancestor
  walk + `checkReflexGuardrails`, `status: 'received'` (skips collection — no physical
  recollection for material already in hand, same reasoning applies to a block), direct
  `writeAuditEvent` (not `@Audit()` — this runs from `OutboxRelayService`'s own tick, never an
  HTTP request), a dedicated system-actor sentinel UUID distinct from every existing one.
- **`apps/api/src/reflex/reflex-guardrails.ts`** — `checkReflexGuardrails`/`MAX_REFLEX_DEPTH`,
  reused unchanged (pure, DB-free, already unit-tested).
- **`apps/api/src/workflow/workflow-command.registry.ts`** — `WorkflowCommandHandler`'s real
  signature (`command, eventPayload, tenantId, tx, firingContext`) and the registry's own
  `register()`/`handlerFor()` shape.
- **`packages/db/src/schema/anatomic-pathology.ts`** (re-read for this proposal) — confirmed
  `block_fulfillment` (FEAT-057) already has exactly the shape a reflex handler needs
  (`tenantId`, `blockId`, `orderedTestId`, unique on `(blockId, orderedTestId)`) — this proposal
  is genuinely the first automated writer of this table; FEAT-057 only wired the manual route.
- **`apps/api/src/observation/observation.controller.ts` + `observation-write.service.ts`** —
  confirmed the existing `results/:analyteId/finalize`/`results/:analyteId/verify` routes are
  discipline-agnostic (keyed by `orderedTestId`/`analyteId` only, no discipline branch), so
  `ObservationVerified` (FEAT-030/052's own trigger event) is reusable here unchanged — no new
  outbox producer needed. **Correction found during implementation, not assumed correctly here
  originally**: `ObservationWriteService.loadWriteContext` unconditionally requires a
  `specimen_fulfillment` row (hard-coded, `block_fulfillment` isn't recognized at all) and an
  `ENTERABLE_ORDERED_TEST_STATUSES` status — a purely `block_fulfillment`-only ordered_test (what
  FEAT-057's own manual `POST /v1/blocks/:id/ordered-tests` route actually produces: `status:
  'ordered'`, no `specimen_fulfillment` row) cannot have a result entered against it at all today.
  This is a real, pre-existing gap FEAT-057 itself never exercised (nothing before this feature
  ever tried to enter a result on a block-linked ordered_test), not something this feature's own
  narrow AC scope requires fixing — a block's own specimen (the part it was grossed from) is a
  real, valid `specimen_fulfillment` target, so the e2e fixture (§8) adds that row directly,
  matching the coherent real-world fact rather than working around a bug. Flagged here, filed as
  issue #561, and noted in the new `engineering/workflow-engine` Skill entry as a known gap for a
  future feature (in the same spirit as issue #440's specimen-exhaustion gap), not fixed by this
  proposal.
- **`apps/api/test/reflex.e2e-spec.ts` + `apps/api/test/case.e2e-spec.ts`** (read in full) — the
  exact e2e fixture/assertion shapes mirrored (published-rule setup, real draft→finalize→verify
  chain, `OutboxRelayService.tick()`, and the block-creation fixture from `case.e2e-spec.ts`'s own
  "AC #4" test).

## 4. Skills loaded

`engineering/workflow-engine` (full, 17 entries).

## 5. Assumptions & autonomous decisions

- **No new ADR.** The issue's own "write one only if a load-bearing decision is discovered (e.g.
  whether IHC panels need their own catalog concept beyond a plain OrderedTest)" is resolved
  **no**: a stain/IHC test is a plain `test_definition` row, identical in kind to every other
  placeholder catalog entry this repo already has (`FreeT4`, `Organism ID`, etc.) — not a coded
  clinical vocabulary needing citation the way FEAT-058's synoptic protocol elements did (a test
  *name* in a lab catalog is not itself patient-facing coded clinical data). No new table, no new
  column, no new concept.
- **Trigger event: reuse `ObservationVerified` unchanged** (the existing FEAT-030/FEAT-052
  trigger), not a new AP-specific event. The handler resolves "is this ordered_test part of an AP
  case" purely by checking whether a `block_fulfillment` row exists for it — an ordered_test with
  none (every non-AP discipline, today) is a no-op, not an error. This avoids inventing a new
  outbox producer for a need the existing event already covers structurally.
- **`parentOrderedTestId` is still set** on the new reflex ordered_test, even though
  `block_fulfillment` alone already proves "traces back to its originating block" (AC #2) —
  keeping the same reflex-lineage marker every other discipline uses (entry #5) lets this new
  handler reuse `checkReflexGuardrails`'s existing ancestor-walk unchanged, rather than needing a
  second, block-specific lineage mechanism.
- **A new command (`AddBlockReflexTest`), not a parameterized `AddReflexTest`.** `AddReflexTest`'s
  own fulfillment-table choice (`specimen_fulfillment`) is load-bearing for every existing
  chemistry/haematology/microbiology rule already published against it — branching that one
  function on "does a block_fulfillment row exist instead" would silently change its behavior for
  every existing caller depending on which fulfillment tables happen to exist, an implicit,
  fragile signal. A second, explicitly-named command is a small amount of duplication for a much
  more legible, independently-reasoned-about handler — matching this repo's own preference
  (`microbiology-catalog.controller.ts`'s "own precedent, don't touch the general one" pattern)
  over a hidden branch in shared code.
- **Reflex acts on the existing block, no recollection** — same reasoning KB-25/entry #6 already
  established for specimen: `block` has no volume/expiry/stability field (confirmed directly by
  reading its schema), so there is nothing to check; an exhaustion/recollection path is the same
  already-filed, not-yet-built gap (issue #440) this repo's existing reflex handler also defers.

## 6. Risks

- **A block with no active/received status is not separately checked** by this handler (unlike
  `case.controller.ts finalize()`'s own active-block/active-slide completeness check) — a reflex
  could in principle attach a new ordered_test to a `disposed` block. Not guarded here because
  KB-25/FEAT-030's own precedent (`specimen.status` is never checked by `AddReflexTest` either) —
  keeping this handler's gates symmetric with its own closest precedent rather than introducing an
  asymmetric new check with no analog on the specimen-reflex side. Flagged, not silently assumed
  safe; a future feature can add it to both handlers together if it becomes a real problem.
- **Two near-identical command handlers** (`AddReflexTest`/`AddBlockReflexTest`) is real,
  accepted duplication (§5) — a third discipline needing yet another fulfillment-table variant
  would be a signal to actually extract the shared shape, not to keep copy-pasting a third time.
- **`engineering/workflow-engine` Skill has no entry yet distinguishing block- vs.
  specimen-fulfillment reflexes** — this feature's own implementation findings become its first
  content here (AGENTS.md's same-day rule), not invented speculatively in this proposal.
- **Real pre-existing gap found (issue #561, §3 correction)**: a block-linked-only ordered_test
  cannot have a result entered against it through the generic result-entry path today
  (`ObservationWriteService.loadWriteContext` hard-requires `specimen_fulfillment`, doesn't
  recognize `block_fulfillment`). Worked around in this feature's own e2e fixture (adds the
  specimen_fulfillment row directly, a real, coherent fact not a hack); filed, not fixed here.

## 7. Acceptance criteria

Per issue #545's own 2 ACs:
- [ ] An IHC/stain reflex rule creates a new OrderedTest on an existing block without creating a
  new Case or Specimen row — proven by asserting the case's `parts`/lineage row counts are
  unchanged before/after the reflex fires (mirroring FEAT-052's own reflex-cascade test shape).
- [ ] The new OrderedTest's lineage traces back to its originating block — proven via both the new
  `block_fulfillment` row (`blockId` matches the parent's block) and `parentOrderedTestId`.

## 8. Testing plan

1. `apps/api/src/reflex/add-block-reflex-test.command.ts` — no dedicated unit spec beyond the
   already-existing `reflex-guardrails.spec.ts` coverage of the pure guardrail function it reuses
   unchanged (matching `add-reflex-test.command.ts`'s own precedent).
2. `apps/api/test/reflex-block.e2e-spec.ts` (new) — real published `workflow_definition` rule
   (`on: 'ObservationVerified'`, `do: [{ command: 'AddBlockReflexTest', testCode: '<placeholder
   IHC code>' }]`), a real case→part→block fixture (`case.e2e-spec.ts`'s own shape), a real
   draft→finalize→verify chain against a histology-stain analyte on that block's own ordered_test,
   a real `OutboxRelayService.tick()`, then asserts both ACs plus: idempotency (ticking twice
   creates exactly one reflex row), the no-op path (an ordinary chemistry `ObservationVerified`
   event with no `block_fulfillment` row triggers nothing), and cycle/depth guardrail reuse (same
   assertion shape as `reflex.e2e-spec.ts`'s own, if that file tests it directly — confirmed at
   implementation time).
3. Full local verification: fresh `db-reset.sh`, `rls-isolation-check.ts` (no new tenant table,
   should be unaffected), full `apps/api` e2e suite under `DB_POOL_MAX=1` (entry #3's own
   nested-transaction-deadlock reason this specific flag matters for anything touching
   `WorkflowCommandRegistry`), single fresh-reset + full-suite run.
4. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Purely additive: one new handler file, one new registration line in `reflex.module.ts`, one new
e2e spec. No existing table, migration, or handler is modified. Reverting the PR removes the
`'AddBlockReflexTest'` registration; any workflow rule referencing that command simply records
`workflow_rule_firing.dispatched: false` again (FEAT-029's own already-existing behavior for an
unregistered command), not an error.

## 10. Questions requiring human approval

All three resolved 2026-08-12, Recommended option selected in every case:
1. **RESOLVED — separate `AddBlockReflexTest` command**, not a parameterized `AddReflexTest`.
2. **RESOLVED — no new ADR.** A stain/IHC test is a plain `test_definition`, not a new catalog
   concept. KB-17's broader "IHC ordering: default reflex versus add-on per scenario" open
   question remains genuinely open, not resolved by this feature's own narrow AC scope.
3. **RESOLVED — placeholder catalog fixture name**, matching this repo's own established
   chemistry/haematology placeholder-catalog convention.

**No further questions — implementation begins now.**
