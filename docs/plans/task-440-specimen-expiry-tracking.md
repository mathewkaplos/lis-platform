# Implementation Proposal: Specimen expiry tracking + reflex recollection fallback
Status: APPROVED
ADR: none (additive schema field + existing-pattern reuse; no new architectural decision)    Date: 2026-08-18    Backlog ID: issue #440 (lis-platform)

**Approved 2026-08-18** via the native options-prompt. All three §10 questions answered as
recommended: (1) volume/exhaustion tracking cut from this pass, file a separate follow-up issue
later; (2) `expiresAt` is caller-supplied only, no stability-window catalog; (3) audit action name
`ordered_test.reflex_recollection_required` as proposed.

## 1. Goal

KB-25's reflex/cascade sub-engine spec says a reflex should act on the existing specimen within
its stability window "where possible; if the specimen is exhausted/expired, the reflex raises a
recollection task instead of silently failing." FEAT-030 shipped only the "act on the existing
specimen" half — `AddReflexTest` unconditionally links every reflex to the triggering test's
specimen, because `specimen` has no expiry field of any kind to check (confirmed by grep during
FEAT-030's own planning, `engineering/workflow-engine` Skill entry #6). This proposal builds the
missing half: an `expiresAt` field on `specimen`, and an `AddReflexTest` branch that raises a
recollection instead of linking when that date has passed.

**Volume/exhaustion tracking is explicitly cut from this pass** — see §5 Q1.

## 2. Affected files

- `packages/db/src/schema/specimen.ts` — add nullable `expiresAt` (timestamptz) column.
- `db/migrations/0051_specimen_expiry.sql` (+ generated `meta` entry) — the migration itself.
- `packages/domain/src/specimen.ts` — `specimenCreateSchema`/`specimenSchema`: add optional
  `expiresAt` (ISO datetime string, nullable on read).
- `apps/api/src/specimen/specimen.controller.ts` — `create()`: pass `body.expiresAt` through to
  the insert, same optional pattern as `collectedAt` today. `toSpecimenDto()`: serialize the new
  column.
- `apps/api/src/reflex/add-reflex-test.command.ts` — `addReflexTestHandler`: after resolving
  `fulfillment.specimenId`, look up the specimen row itself (not just its id); if `expiresAt` is
  non-null and `<= now`, take the new recollection branch (§5) instead of the existing
  specimen-link branch.
- `apps/api/test/reflex.e2e-spec.ts` — new case(s) for the expired-specimen branch.
- `lis-engineering/skills/engineering/workflow-engine/SKILL.md` — entry #6 gets a follow-up note
  once this lands (not rewritten — appended, per that Skill's own "origin" convention).

No `apps/web` UI change: `expiresAt` is written the same way `collectedAt` already is today — an
optional field on the existing `POST /v1/specimens` body — and no screen currently exposes
`collectedAt` as an editable input either (checked: `specimen.controller.ts`'s own doc comment,
reception is the only writer, and `apps/web` has no reception-form UI yet for either field). The
recollection fallback surfaces entirely through the **existing** Collection Queue screen
(`apps/web/app/(app)/collection-queue/page.tsx`, `GET /v1/orders?status=ordered`) — zero UI
changes needed there either, since that screen already renders any `ordered_test` with
`status: 'ordered'` regardless of why it was created.

## 3. Architecture consulted

- **KB-25** (`25-workflow-engine.md`), "reflex/cascade sub-engine" section — the literal
  requirement this closes.
- **`engineering/workflow-engine` Skill**, entry #6 (this exact gap, filed as issue #440) and
  entry #4 (no-throw-on-expected-failure handler shape — the recollection branch follows the same
  logged, non-throwing pattern as every other "cannot safely act" branch already in this handler).
- **`domain/specimen-lifecycle` Skill**, entry #2 ("no dedicated 'record collection' task —
  reception is where collection/receipt/accessioning all first happen") and entry #4 (`specimenType`
  is free text, no catalog) — together these rule out "compute `expiresAt` automatically from a
  specimenType-keyed stability-window catalog" as this pass's scope: no such catalog exists, and
  building one is real, separate, per-specimen-type content work (see §5 Q2).
- `docs/plans/feat-030-reflex-rules.md` §5/§10 Q2 — the original deferral this issue tracks.
- `apps/web/app/(app)/collection-queue/page.tsx` — confirmed the exact predicate the recollection
  branch needs to satisfy: any `ordered_test` row with `status: 'ordered'` on a real `order`
  appears there automatically, sorted by priority/age. No new table or endpoint needed.
- Schema review (by reading, not assumed): `specimen` has no `volumeMl`/exhaustion concept today,
  and no consumption-ledger table exists anywhere in the schema to compute one from.

## 4. Skills loaded

- `domain/specimen-lifecycle`
- `engineering/workflow-engine`
- `engineering/database-design` (new nullable column + migration numbering)
- `engineering/api-design` (no new route, but `specimen.controller.ts`'s existing route gains a
  field — loaded per the plan Skill's own "if in doubt, load it" rule)

## 5. Assumptions & autonomous decisions

- **Recollection = a new `ordered_test` row with `status: 'ordered'` and no `specimen_fulfillment`
  row**, not a new "recollection task" table/concept. This is the smallest change that satisfies
  KB-25's literal requirement: it reuses the exact mechanism a fresh order already uses to reach
  the Collection Queue (`collection-queue/page.tsx`'s own documented predicate: "at least one
  `orderedTest` row still `status: 'ordered'`"), so staff see the same screen they already use for
  every other pending collection, with zero new UI. `parentOrderedTestId` is still set (reflex
  lineage is unconditional per `engineering/workflow-engine` Skill entry #5), so the recollected
  test is still traceable to the triggering reflex rule even though it takes the collection path
  instead of the direct-link path.
- **The recollection branch is a no-op-and-log-and-create, not a throw** — same ADR-0030 shape
  every other branch in this handler already follows (`engineering/workflow-engine` entry #4).
  It writes a distinct audit action, `ordered_test.reflex_recollection_required` (vs. the existing
  `ordered_test.reflex_create`), so the audit trail can tell the two outcomes apart without
  parsing log text.
- **`expiresAt` is written manually at specimen creation, not computed.** No specimenType-keyed
  stability-window catalog exists (`domain/specimen-lifecycle` entry #4); inventing one is
  out of scope here (§5 Q2). This mirrors the existing `collectedAt`/`orderedTestIds` precedent:
  an optional, caller-supplied field with no auto-derivation.
- **No existing specimen gets a retroactive `expiresAt`.** The column defaults to `NULL` (no
  migration backfill) — `NULL` means "not tracked," identical in effect to today's behavior
  (`AddReflexTest` always links). This is not a behavior change for any specimen that doesn't set
  the field.

## 6. Risks

- **A caller could set `expiresAt` in the past at creation time**, immediately marking a
  brand-new specimen as expired. No validation rejects this — `collectedAt` already allows the
  same class of "caller asserts a past timestamp" input today, and rejecting it would need a
  policy this codebase doesn't have an opinion on yet (how far in the past is plausible for a
  specimen collection timestamp). Left as caller-trusted input, matching existing precedent, not a
  new gap.
- **Every currently-published reflex rule's own e2e/manual testing assumed the direct-link
  branch.** The recollection branch only fires when `expiresAt` is both set and past — since no
  existing specimen has this field populated (§5, no backfill), this is additive and changes no
  existing rule's observed behavior until a caller starts setting `expiresAt`.
- **`toSpecimenDto()`'s `after` payload for `create()` feeds `AuditInterceptor`'s hash** (per that
  function's own comment about `fulfilledOrderedTestIds`) — must add `expiresAt` as an
  always-present key (`null` when unset), never an omitted-when-undefined key, to avoid the same
  audit-hash-instability bug that comment already warns about.

## 7. Acceptance criteria

- [ ] `specimen.expiresAt` exists (nullable timestamptz), settable via `POST /v1/specimens`,
      returned by `GET /v1/specimens/:id` and search().
- [ ] A published reflex rule (`do: {command: 'AddReflexTest', ...}`) firing against a specimen
      with `expiresAt` in the future (or null) still creates the reflex `ordered_test` directly
      against the existing specimen — unchanged behavior, proven by re-running the existing
      `reflex.e2e-spec.ts` suite green.
- [ ] The same rule firing against a specimen with `expiresAt` in the past creates a new
      `ordered_test` with `status: 'ordered'`, `parentOrderedTestId` set, and **no**
      `specimen_fulfillment` row — proven end to end via a real draft/finalize/verify ->
      outbox relay -> reflex evaluation chain, same harness shape as the existing suite.
- [ ] That new `ordered_test` appears on `GET /v1/orders?status=ordered` (i.e., the real Collection
      Queue query), proving the reuse claim in §5 is real, not assumed.
- [ ] A distinct `audit_event` (`ordered_test.reflex_recollection_required`) is written for the
      recollection branch, distinguishable from `ordered_test.reflex_create`.
- [ ] Idempotency holds for the recollection branch too: a second `tick()` (simulating outbox
      redelivery) does not create a second recollection `ordered_test`.

## 8. Testing plan

- `apps/api/test/reflex.e2e-spec.ts`: new case seeding a specimen with `expiresAt` in the past,
  asserting the recollection-branch AC's above (new `ordered_test` row shape, no
  `specimen_fulfillment`, correct audit action, idempotent redelivery).
- Existing suite re-run unchanged (regression check for the direct-link branch).
- `apps/api` unit/typecheck for the schema/domain/controller changes.
- No `apps/web` change, so no `web-verify` pass needed for this task specifically — the Collection
  Queue screen itself is unmodified code exercising a data shape it already handles.

## 9. Rollback plan

Additive-only: a new nullable column with no backfill, an additive Zod field, an additive
branch in `AddReflexTest` gated on that column being both set and past. Reverting the migration
and the three code changes is a clean revert with no data-loss risk (nothing depends on
`expiresAt` being present) and no risk to already-published reflex rules (they still evaluate
identically for any specimen with `expiresAt` unset).

## 10. Questions requiring human approval

1. **Volume/exhaustion tracking is cut from this pass entirely — approve, or fold it in now?**
   Recommend: cut. Unlike expiry (a single timestamp comparison), "exhausted" requires knowing how
   much volume has already been consumed, which needs a consumption ledger (nothing currently
   decrements a specimen's volume anywhere in this codebase — not on result entry, not on reflex
   creation). Building that ledger is real, separate scope with its own design questions (does
   every discipline's result-entry path start writing to it? what happens to volume on a rejected
   specimen?) that would blow up this proposal's size for a feature (KB-25's "exhausted" half) the
   original issue's own text already anticipated as a design decision "for whoever picks this up."
   Recommend filing a fresh follow-up issue for volume/exhaustion specifically, scoped separately
   from this one, once real usage data suggests it's needed.
2. **Should `expiresAt` be computable from a specimenType-keyed stability-window catalog instead
   of purely caller-supplied?** Recommend: no, not this pass — no such catalog exists anywhere in
   this codebase (`domain/specimen-lifecycle` entry #4, `specimenType` is uncontrolled free text),
   and building one is a real, separate content-authoring effort (which stability window for which
   of an open-ended set of free-text specimen types?), not a natural extension of this task's own
   scope. Caller-supplied `expiresAt` (optional, defaults null) ships the KB-25 behavior for any
   caller that already knows its own stability policy, without inventing platform-wide content.
3. **Audit action naming: `ordered_test.reflex_recollection_required` — approve, or prefer a
   different name?** No existing precedent to match against (this is the first audited "reflex
   could not act directly" outcome); picked to read clearly next to the existing
   `ordered_test.reflex_create` in an audit log.
