# Implementation Proposal: `finalize()` panel-hold 409 carries a distinguishable code and the persisted value
Status: APPROVED
ADR: ADR-0021 (accepted 2026-08-08 — the mechanism this proposal implements)    Date: 2026-08-08    Backlog ID: #400 (found during TASK-073, FEAT-023 — not FEAT-023's own scope)

## 1. Goal

Fix lis-platform issue #400: `FinalizationRollupInterceptor`'s panel-hold 409 fires **after** the
analyte's own write has already committed (`domain/critical-values` Skill entry #7's own documented,
deliberate design), but `apps/web`'s `finalizeResult()` cannot tell this apart from a genuine
pre-write rejection (`loadWriteContext`'s 409) — every non-ok response gets the same generic error
text and a `FAILURE` spread (`valueNum: null`, etc.) over the row. A technologist sees an apparently
lost, greyed-out value for data that is, in fact, already saved. Confirmed live via `web-verify`
against a real 20-analyte CBC panel (TASK-073).

Per ADR-0021: give both of `FinalizationRollupInterceptor`'s post-commit hold branches (not just the
one #400 happened to reproduce) a distinguishable `panel_hold` problem-details `code`, echo the
already-committed observation in the response body, and have the frontend render a distinct
"held, not lost" row state instead of the generic failure.

## 2. Affected files

- `apps/api/src/observation/finalization-rollup.interceptor.ts` — new exception class thrown from
  both post-commit branches (L184-188 unacknowledged-critical, L213-217 QC-hold), each populated with
  the already-captured `result` (L82) for the analyte just written.
- `apps/api/src/common/problem-details.filter.ts` — new `catch()` branch recognizing the new
  exception, copying `code`/`reason`/`heldObservation` onto the `ProblemDetails` response (mirroring
  the existing `ZodValidationException` branch); `ProblemDetails` interface gains the two new optional
  fields.
- `apps/web/app/(app)/orders/[id]/results/actions.ts` — `finalizeResult()` parses the response body's
  `code` before falling back to today's flat `writeErrorMessage(status)` path; `ResultActionOutcome`
  gains a third `status` value and the held-value fields.
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` — renders the new outcome variant as an
  informational, non-`danger` caption (reusing the existing "Pending inputs"/"Not yet received" muted
  styling precedent, not inventing a new visual language), keeps the real `valueNum`/`flags` visible
  instead of blanking them.
- `apps/api/test/critical-notification.e2e-spec.ts` (extend `finalizeSodiumCritical()` /L107-143 area)
  and `apps/api/test/qc-gate.e2e-spec.ts` (extend the rollup-block case /L326-355 area) — new
  assertions on the 409 **response body** shape; neither file currently inspects the body, only the
  status code.

No `packages/domain`/`packages/sdk` schema changes: `finalize()`'s response is already excluded from
`@ZodResponse` generation (confirmed `content?: never` in `packages/sdk/src/schema.ts`), so this is
consistent with how the existing success shape is already hand-typed on the frontend, not a new gap.

## 3. Architecture consulted

- **ADR-0021** (this session) — the accepted decision this proposal implements.
- **ADR-0019** (§ interceptor precedent) — nearest prior example of extending a post-commit
  interceptor's gate logic.
- **ADR-0013** §2 — RFC 9457 `problem+json` as the one global error shape; this proposal extends it
  with optional extension members, doesn't replace it.
- `domain/critical-values` Skill entry #7 (the two-transaction design `PanelHoldException` must not
  disturb) and entry #8 (this exact gap, its origin, and why it wasn't fixed inline by TASK-073).
- `engineering/api-design` Skill entry #2 (global `problem+json`, must stay backward compatible) and
  entry #14 (why `finalize()`'s response has no generated OpenAPI/SDK type to update).

## 4. Skills loaded

`domain/critical-values`, `domain/qc-westgard` (QC-hold branch shares the same interceptor and fix),
`engineering/api-design`, `engineering/testing` (for the e2e body-shape assertions).

## 5. Assumptions & autonomous decisions

- **Fixing both post-commit branches (critical-hold and QC-hold), not just the one #400 reproduced.**
  Same mechanism, same latent bug in the QC-hold branch (no existing test would catch it separately).
  Treated as in-scope for this task rather than a follow-up, since the fix is the same shape either
  way and splitting it would leave a known-identical bug unfixed on purpose.
- **`code: 'panel_hold'`, not `exception.name`.** Matches the filter's existing lowercase-snake-case
  convention (`validation_failed`, `internal_error`) rather than defaulting to
  `"PanelHoldException"` the way an untouched `ConflictException` branch would.
- **`reason: 'unacknowledged_critical' | 'qc_violation'`** included alongside `code`, so a future
  consumer (e.g. issue #390's QC-held indicator) doesn't need to re-derive which branch fired from
  `detail`'s free-text message.
- **`loadWriteContext`'s pre-write 409 is deliberately left untouched** — it's the control case the
  frontend's `code` check falls back to; changing it is out of scope and would remove the very signal
  this fix relies on to tell the two apart.
- **No new visual "held" badge/color token invented** — reusing the grid's two existing
  muted-informational-caption precedents rather than adding a new status color, since neither ADR-0021
  nor issue #400 asked for new visual design, only for the value not to look lost.

## 6. Risks

- This path is Constitution Law #3-adjacent (criticals never auto-verify) — the fix changes only the
  **response shape** of an already-accepted hold, not the hold logic itself; the e2e additions must
  assert the hold still actually blocks completion (`orderedTest.status` stays non-`resulted`), not
  just that the body now looks nicer, so a regression in the gate itself would still be caught.
  `problem-details.filter.ts` unit-level behavior for every *other* exception type is unchanged — only
  a new `else if` branch is added.
- `apps/web`'s response-body parsing must not throw if a 409 body is somehow not valid JSON (network
  edge case) — falls back to today's `writeErrorMessage(status)` path on any parse failure, not a new
  unhandled exception.
- GitHub GraphQL quota was low (263/5000) as of session start — PR creation/review for this task
  should prefer REST-shaped `gh` calls where possible.

## 7. Acceptance criteria

1. Finalizing the last analyte in a panel while an earlier analyte has an unacknowledged critical
   still returns 409 and still leaves the panel's `orderedTest.status` at `'received'`/`'in_process'`
   (unchanged gate behavior) — but the response body has `code: 'panel_hold'`,
   `reason: 'unacknowledged_critical'`, and `heldObservation` matching the value that was actually
   persisted.
2. The same holds for the QC-hold branch (`reason: 'qc_violation'`), verified with a new or extended
   `qc-gate.e2e-spec.ts` case.
3. `loadWriteContext`'s pre-write 409 (ordered_test not in an enterable status) is unchanged: still a
   bare `ConflictException`, `code: 'ConflictException'`, no `heldObservation`.
4. In the browser (`web-verify`), the same TASK-073 repro (20-analyte CBC panel, Platelet Count
   critical, Basophils %/Absolute completing the panel) shows the real saved value and a
   non-`danger`-colored "held" caption — not a blank/greyed-out row with the old generic error text.
5. Existing e2e suites (`critical-notification.e2e-spec.ts`, `qc-gate.e2e-spec.ts`, and the full
   `apps/api` suite) pass unmodified in every case not directly touched by this change.

## 8. Testing plan

- Extend `critical-notification.e2e-spec.ts`'s existing critical-hold case to assert the new body
  shape instead of only re-querying the DB to work around the 409 carrying no id (per the Explore
  research: this re-query is the exact workaround the fix removes the need for).
- Extend `qc-gate.e2e-spec.ts`'s existing rollup-block case (~L326-355) the same way for the QC-hold
  branch.
- `web-verify` pass reproducing TASK-073's exact panel-hold scenario, light + dark, screenshots,
  zero console errors — the same discipline TASK-073 itself used to find this gap.

## 9. Rollback plan

Revert the four source-file changes; `ProblemDetailsFilter`'s new branch and `PanelHoldException` are
additive (no existing branch is removed or reordered), so reverting is a clean file-level revert with
no migration or data implications — this task touches no schema.

## 10. Questions requiring human approval

1. Exception class name — proposing `PanelHoldException`. No strong alternative identified; flagging
   only because it's a new, permanent public shape other code will reference.
2. Should issue #390 (QC-held indicator elsewhere in the UI) be explicitly linked as a follow-up task
   once this merges, or left to be picked up opportunistically? ADR-0021 assumes the latter (separate,
   not bundled) — confirm that's still correct before this proposal is approved.
