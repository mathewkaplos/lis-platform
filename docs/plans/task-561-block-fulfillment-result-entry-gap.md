# Implementation Proposal: Block-linked `ordered_test`s can never have a result entered
Status: APPROVED
ADR: none (bug fix within already-decided ADR-0049 §Decision 4 semantics)    Date: 2026-08-13    Backlog ID: issue #561 (lis-platform)

**Approved 2026-08-13** via the native options-prompt. Both §10 questions answered: fix both call
sites together, and `status: 'received'` (direct, no intermediate step) is correct.

## 1. Goal
Fix a real, already-diagnosed correctness gap: `POST /v1/blocks/:id/ordered-tests`
(`case.controller.ts`'s `addOrderedTest`, FEAT-057) creates an `ordered_test` linked to a block
via `block_fulfillment` only — it leaves `status` at the schema default `'ordered'` and never
inserts a `specimen_fulfillment` row. `ObservationWriteService.loadWriteContext` — the shared
precondition every result-entry path goes through (`draft`, `finalize`, and analyzer ingestion via
`GatewayIngestService.ingest`) — unconditionally requires (a) `status` in `'received'`/`'in_process'`
and (b) a `specimen_fulfillment` row, with no `block_fulfillment` fallback anywhere in that method.
Net effect: **no result can ever be entered against a block-linked-only ordered_test**, via any
route — draft/finalize/verify/ingest all 409. Confirmed as a pre-existing gap from FEAT-057, found
while implementing FEAT-060, not a regression from that feature.

A second, currently-untested instance of the identical root cause exists in
`add-block-reflex-test.command.ts` (`AddBlockReflexTest`, FEAT-060's reflex handler): it sets
`status: 'received'` directly on insert (unlike `addOrderedTest`) but likewise never inserts a
`specimen_fulfillment` row, so a reflex-created block ordered_test passes the status guard but
still 409s on the fulfillment lookup. `reflex-block.e2e-spec.ts`'s own AC #1/#2 test never actually
enters a result against the reflex-created row, so this is unnoticed today. Both call sites are in
scope for this fix — same root cause, same remedy.

## 2. Affected files
- `apps/api/src/case/case.controller.ts` — `addOrderedTest` (`POST /v1/blocks/:id/ordered-tests`):
  after loading `specimenRow` (already fetched via `block.specimenId`, no new query needed), insert
  a `specimen_fulfillment` row targeting that same specimen, and set the new `orderedTest`'s
  `status: 'received'` at insert time — mirroring what `specimen.controller.ts`'s `receive()`
  handler already does for the specimen-only path, and what `add-block-reflex-test.command.ts`
  already does for `status` (just not for the fulfillment row).
- `apps/api/src/reflex/add-block-reflex-test.command.ts` — same fix: insert a `specimen_fulfillment`
  row targeting `fulfillment.blockId`'s own parent specimen, alongside the existing `block_fulfillment`
  insert. (Requires one extra lookup: `block_fulfillment.blockId` → `block.specimenId`, not
  currently loaded in this handler.)
- `apps/api/test/reflex-block.e2e-spec.ts` — remove the manual `specimen_fulfillment` insert +
  `status` update workaround (lines ~203-227) from `createBlockLinkedOrderedTest`, since the route
  now does it; add a new assertion that a result can actually be drafted/finalized against the
  resulting ordered_test (closing the gap that AC #1/#2 never exercised this). Add an equivalent
  result-entry assertion for the `AddBlockReflexTest`-created ordered_test (AC #1/#2's own test),
  which today only checks `reflex.status === 'received'` and `block_fulfillment` existence.
- No schema migration — both `block_fulfillment` and `specimen_fulfillment` tables already exist
  with the columns needed; this is a data-completeness fix in the write paths, not a schema change.
- No new route, no new DTO.

## 3. Architecture consulted
- ADR-0049 §Decision 4 (reflex/add-on stains create new OrderedTests on existing blocks, block is
  the stable unit) — this fix doesn't change that decision, it completes its write path so result
  entry actually works against the block-linked OrderedTests the decision already calls for.
- `engineering/workflow-engine` Skill (reflex-block section) — confirms `add-block-reflex-test.command.ts`
  was deliberately kept a separate handler from `add-reflex-test.command.ts` rather than a branch,
  and that a block's own parent specimen is the established real-world join target (same reasoning
  this fix reuses for `addOrderedTest`'s fix).
- `specimen.controller.ts`'s `receive()` handler (`apps/api/src/specimen/specimen.controller.ts:173-198`)
  — the existing, working reference pattern this fix mirrors: `specimen_fulfillment` insert +
  `status` update/set happen together, in the same transaction, as the thing that makes an
  ordered_test enterable.
- RLS: `specimen_fulfillment`'s `tenantIsolation()` policy (`packages/db/src/schema/specimen.ts:8-11`)
  is the same shape already satisfied by `addOrderedTest`'s existing `block_fulfillment` insert in
  the same transaction/tenant context — no new policy or migration needed.

## 4. Skills loaded
- `engineering/database-design` — confirmed no advisory-lock/deadlock concern: this fix adds a
  plain insert to an already-open transaction, not a new nested transaction (entry #14's documented
  failure mode doesn't apply).
- `engineering/workflow-engine` — reflex-block command handler context (§3 above).
- `engineering/testing` — e2e conventions for `apps/api/test/*.e2e-spec.ts` (existing fixture
  structure in `reflex-block.e2e-spec.ts` reused, not reinvented).
- `engineering/api-design` not required: no new route/DTO is being added, both affected handlers
  already exist.

## 5. Assumptions & autonomous decisions
- **Status set to `'received'` directly, not `'ordered'` → `'collected'` → `'received'`.** A
  block-linked ordered_test has no independent specimen-collection step of its own — the block's
  material is already in the lab (it was grossed from an already-received specimen) — so
  `'received'` is the correct terminal pre-entry status, consistent with how
  `add-block-reflex-test.command.ts` already sets it directly on insert today. Flagged for
  confirmation in §10 in case there's a workflow-state reason (e.g. a technologist-facing worklist
  step) to route it through an intermediate status instead.
- **The `specimen_fulfillment.specimenId` target is the block's own direct parent specimen**
  (`block.specimenId`), not the case's other specimens/parts. This is the same target the existing
  e2e workaround already uses, and is the only specimen a block has a real FK relationship to.
- Both `addOrderedTest` and `add-block-reflex-test.command.ts` get the fix in the same proposal
  (not split into two issues/PRs) since it's the identical root cause in two call sites and leaving
  one unfixed would just relocate the bug.

## 6. Risks
- **Regression risk on the existing specimen-only path**: none — this fix only touches the
  block-linked insert paths; `specimen.controller.ts`'s `receive()` and `ObservationWriteService`
  itself are unchanged.
- **Double-fulfillment ambiguity**: a block-linked ordered_test will now have both a
  `block_fulfillment` row (existing, unchanged) and a `specimen_fulfillment` row (new). Nothing in
  `loadWriteContext` or elsewhere treats having both as an error — `specimen_fulfillment` is purely
  additive, used only for the `specimenId` the observation FK needs. Confirmed no unique-constraint
  conflict: `ux_specimen_fulfillment_specimen_ordered_test` is keyed on `(specimenId, orderedTestId)`,
  and this is the only `specimen_fulfillment` row ever created for this `orderedTestId`.
- **Constitution Law #1/#2**: unaffected — this fix doesn't touch how Observations are structured or
  versioned, only whether the precondition to write one is satisfiable for block-linked tests.

## 7. Acceptance criteria
1. `POST /v1/blocks/:id/ordered-tests` response's `orderedTest.status` is `'received'`, and a
   `specimen_fulfillment` row exists for the new ordered_test, targeting the block's own parent
   specimen.
2. A result can be drafted and finalized (`POST .../draft`, `POST .../finalize`) against a
   block-linked-only ordered_test created via that route, with no manual DB workaround.
3. `AddBlockReflexTest`-created ordered_tests likewise get a `specimen_fulfillment` row at creation
   time, and a result can be drafted/finalized against one in a new or extended e2e test.
4. Existing `reflex-block.e2e-spec.ts` tests pass with the manual workaround insert removed.
5. No change in behavior for specimen-only (non-block) ordered_tests.

## 8. Testing plan
- Extend `apps/api/test/reflex-block.e2e-spec.ts`: remove the workaround insert from
  `createBlockLinkedOrderedTest`; add a draft+finalize assertion against the resulting ordered_test.
- Extend the same file's `AddBlockReflexTest` AC #1/#2 test (or add a sibling test) to assert a
  result can be drafted/finalized against the reflex-created ordered_test, not just that its status
  and `block_fulfillment` row exist.
- Full `apps/api` e2e suite run before commit, per `develop` Skill's existing gate.
- Regenerate `openapi.json`/SDK as the last step before commit (per this session's own `develop`
  Skill step 4a fix) — not expected to change (no DTO/route shape changes), run anyway to confirm.

## 9. Rollback plan
Pure application-code change, no migration. Revert the two handler diffs; no data cleanup needed
since the added `specimen_fulfillment` rows are valid, non-destructive records (same shape as any
other specimen-fulfillment row) even if the code were reverted afterward.

## 10. Questions requiring human approval
1. **Confirm `status: 'received'` (direct, no intermediate 'collected' step) is correct for
   block-linked ordered_tests in `addOrderedTest`** — matches `add-block-reflex-test.command.ts`'s
   existing behavior, but flagging since it's a judgment call, not something the issue itself
   dictates.
2. **Confirm both call sites (`addOrderedTest` and `AddBlockReflexTest`) should be fixed together
   in this one proposal**, rather than scoping this narrowly to just the route the issue named and
   filing the reflex-command instance as a separate follow-up issue.
