# Implementation Proposal: Prostate/Lung synoptic protocol pilot + multi-select elements
Status: APPROVED
ADR: adr-0050 (FEAT-058, existing)    Date: 2026-08-20    Backlog ID: issue #645 (lis-platform)

## 1. Goal

Seed two more real CAP synoptic protocols (Prostate, Lung) as a pilot for the much larger
`D:\LIS\research\cap documents` library (106 real CAP Cancer Protocol templates), proving the
docx-to-seed-data pipeline before any decision to scale further. Along the way, extend the
synoptic-protocol schema/response model/generic renderer (all shipped by issue #642) to support
**multi-select elements** ("select all that apply") — confirmed as a real, recurring pattern in
both source documents, not an edge case, and not representable by the current schema (every
element accepts exactly one value today).

This is explicitly a pilot, not a commitment to seed all 106 protocols — per the human's own
framing when this was scoped.

## 2. Affected files

- `packages/db/src/schema/synoptic-protocol.ts` — extend the `ck_synoptic_element_data_type`
  CHECK constraint and comment to admit a new `coded_multi` value alongside
  `coded`/`quantity`/`text`. New migration.
- `packages/domain/src/synoptic-protocol.ts` — add `'coded_multi'` to
  `SYNOPTIC_ELEMENT_DATA_TYPES`; widen `synopticResponseCreateSchema`'s per-entry `value` to
  `z.union([z.string(), z.number(), z.array(z.string()).min(1)])`; widen
  `synopticResponseResultEntrySchema` the same way.
- `apps/api/src/synoptic-protocol/synoptic-response-recorder.ts` — `assembleAndPersistSynopticResponse`:
  validate a `coded_multi` element's value as `string[]`, every entry checked against
  `responseOptions` (same check as `coded` today, applied per-array-entry); write it as an
  `observation` row with `dataType: 'structured'`, `valueJson: selectedValues` (reusing the
  existing `structured` variant — `observation`'s own CHECK
  `ck_observation_structured_value` already requires `valueJson` for that dataType; no
  `observation` schema change needed). The `context` object built for `visibilityCondition`
  evaluation (`Record<string, unknown>`) already accepts an array value unchanged —
  `evaluateCondition`'s existing `'includes'` operator (`packages/domain/src/conditions.ts`,
  unmodified since issue #642's own move) is what a future `visibilityCondition` keyed on a
  multi-select answer would use; no evaluator change needed.
- `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/protocol-form.tsx` — add a checkbox-group
  branch to the existing `element.dataType === 'coded' | 'quantity' | ...` chain for
  `'coded_multi'`, storing `values[element.key]` as `string[]` instead of a scalar. The component
  is still one generic renderer — no protocol-specific branching.
- `db/seed/synoptic-protocol-prostate.sql` (new), `db/seed/synoptic-protocol-lung.sql` (new) —
  transcribed from `Prostate_4.3.0.0.REL_CAPCP.docx` / `Lung_5.1.0.0.REL_CAPCP.docx`, following
  the exact citation-and-cross-check convention the three existing seed files established (source
  standard, version, posting date, direct quote of the real document's own section, explicit
  scope-cut notes for anything deliberately deferred).
- `apps/api/test/synoptic-protocol.e2e-spec.ts` — extend with a `coded_multi` recording case
  (valid multi-select recorded correctly; an invalid entry in the array rejected the same way a
  single invalid `coded` value is today).

## 3. Architecture consulted

- ADR-0050 / `docs/plans/feat-058-generic-synoptic-protocol-engine.md` (the engine this extends).
- `docs/plans/task-642-synoptic-protocol-recording.md` (the UI this extends — its own §3.2 finding
  that no protocol seeded so far uses `parentElementId` grouping still holds; Prostate/Lung don't
  change that either, confirmed below).
- `packages/db/src/schema/observation.ts` (the `structured`/`valueJson` variant this reuses,
  confirmed directly: `ck_observation_structured_value` already requires `valueJson` when
  `dataType = 'structured'` — no schema change needed on the `observation` table itself).
- The two real source documents, read directly (not summarized from a prior pass): each
  document's own CASE SUMMARY section text was extracted and read in full before drafting this
  proposal.

## 4. Skills loaded

- `frontend-design` (required — `protocol-form.tsx` changes). No new route/segment-naming
  concerns; this is a data-shape extension of an existing component, not a new page.
- `api-design` (required — `assembleAndPersistSynopticResponse`'s request/response shape changes).
  Entry #1 (one schema, three consumers) directly governs: `coded_multi`'s value shape is defined
  once in `packages/domain` and used by both the Zod validation pipe and the frontend's own
  `SynopticElement`/`SynopticResponseCreateInput` types, per the same pattern every other element
  type already follows.
- `database-design` (new CHECK constraint / migration) — not separately loaded in full for this
  proposal; the only schema change is a CHECK-constraint value-list widening, the same shape
  `synoptic_element_data_type`'s own existing CHECK already uses, no new table/FK/RLS concern.

## 5. Assumptions & autonomous decisions

**5.1 — Multi-select values persist via `observation.dataType = 'structured'` / `valueJson`, not a
new `observation` column or a one-row-per-selection shape.** The `structured` variant already
exists specifically for JSON-shaped answers and already has the exact CHECK constraint this needs
(`valueJson IS NOT NULL`). One row per multi-select *element* (holding the full selected-value
array), matching the existing one-row-per-element convention every other `coded`/`quantity`/`text`
answer already uses — not one row per individual selection, which would break the
one-`observationId`-per-`SynopticResponseResultEntry` shape the frontend confirmation view (issue
#642) already depends on.

**5.2 — `coded_multi` validation checks every array entry against the element's own
`responseOptions`, all-or-nothing.** Matches the existing all-or-nothing rejection discipline
`assembleAndPersistSynopticResponse` already applies to every other element type (proposal
`task-642`'s own §1, carried over verbatim — a partially-valid multi-select answer is a worse
safety outcome than a clear upfront rejection).

**5.3 — Source documents: the primary resection protocol for each organ, not a biopsy/TURP
variant.** `Prostate_4.3.0.0.REL_CAPCP.docx` ("Radical Prostatectomy") and
`Lung_5.1.0.0.REL_CAPCP.docx` ("LUNG", covers wedge/lobectomy/pneumonectomy procedures) — matching
the existing precedent (Breast/Colorectal were both seeded from their own primary-resection
protocol, not a biopsy-only variant).

**5.4 — Neither document uses `parentElementId` grouping either.** Confirmed directly from both
documents' own CASE SUMMARY text (section headers like SPECIMEN/TUMOR/TUMOR
QUANTITATION/MARGINS/PATHOLOGIC STAGE are present as visual section breaks in the source document,
the same way Breast/Colorectal's own un-grouped real data already is) — issue #642's own §3.2
finding (the generic renderer supports grouping but no seeded protocol uses it) is unchanged by
this pilot. Not treated as a reason to introduce grouping here; a genuinely future concern once a
real protocol's own transcription benefits from it.

**5.5 — Fidelity level for this pilot: Core (required) elements plus their own directly-dependent
Conditional sub-fields; deep multi-level nested branches (e.g. Prostate's per-Gleason-grade-group
tertiary-pattern sub-questions, each grade group option carrying its own further conditional
percentage-of-pattern-4 sub-branch) are flattened to their own top-level conditional elements
rather than modeled as nested option-specific sub-forms.** For example, "Minor Tertiary Pattern 5"
and "Percentage of Pattern 4" become their own elements with a `visibilityCondition` keyed on the
parent Gleason grade-group selection (an `in` condition covering the specific grade-group values
that carry that sub-question), rather than the UI presenting a materially different sub-form per
grade group. This preserves data-entry correctness (every real CAP data element is still
recordable, still validated) while keeping the seed transcription tractable for a two-protocol
pilot. Flagged explicitly as §10 Q1 for approval, not decided unilaterally, since it's a real
fidelity trade-off a domain reviewer should confirm is acceptable.

## 5.6 Broader-library sanity check (not just the two pilot documents)

Per explicit request, before locking the schema extension to `coded_multi` alone, sampled seven
more real documents from `D:\LIS\research\cap documents` across different organ systems and one
different genre (Bladder, Kidney, Skin/Melanoma, Stomach, Testis, Thyroid, Uterus resection
protocols, plus `cp-biomarker-thyroid-2016-v1001.docx`, a biomarker/molecular-testing template —
structurally different from a tumor-resection CASE SUMMARY). Read each document's own real CASE
SUMMARY (or equivalent) text directly, not assumed from the two pilot documents alone.

**Findings:**
- "Select all that apply" (multi-select) is confirmed common across all seven organ protocols
  sampled, not unique to Prostate/Lung — strengthens confidence that `coded_multi` is a
  broadly-needed primitive, not a one-off.
- Skin/Melanoma and Uterus both show a *nested* multi-select-under-multi-select shape (e.g.
  Skin's Tumor Site multi-select has "Penis"/"Vulva" options that each carry their own further
  multi-select sub-checklist). This is a deeper nesting than either pilot document needed, but
  §5.5's own flattening approach already generalizes to it: a nested sub-checklist becomes its own
  top-level `coded_multi` element gated by a `visibilityCondition` using `evaluateCondition`'s
  existing `'includes'` operator against the parent multi-select's own selected array. No new
  primitive required to handle this correctly, even though this pilot's own two protocols don't
  happen to need it.
- The biomarker template (`cp-biomarker-thyroid`) is a different genre — molecular/IHC results
  with nested drill-down single-select mutation choices, percentage/quantity fields, and
  "Other (specify)" free-text pairs — but every field in it is representable by the schema
  *already planned* for this pilot (`coded`, `quantity`, `text`, `visibilityCondition`); it did
  not surface any further new input-format gap.
- No other novel primitive (a date/time field, a file-attachment field, a ratio-pair field beyond
  what `quantity` already handles) appeared anywhere in this sample.

**Conclusion:** `coded_multi` is very likely the only schema extension a substantially larger slice
of the CAP library would need, not just these two pilot protocols — worth remembering for any
future decision on scaling past this pilot, but not a reason to expand this PR's own scope beyond
Prostate + Lung (§10 Q3 still holds).

## 6. Risks

- **Transcription accuracy.** Manual transcription of ~40-60 real elements across two dense
  documents carries real risk of a missed or mis-typed element, response option, or condition —
  mitigated by the same citation-and-explicit-scope-cut discipline the three existing seed files
  already use, and by the new e2e coverage exercising at least one full real submission per
  protocol against the actual seeded rows (not just schema-level unit tests).
- **`coded_multi` widens the attack/validation surface slightly** — an array of unbounded length
  submitted by a caller. Mitigated by validating every entry against `responseOptions` (5.2); a
  reasonable array-length cap is not currently proposed since `responseOptions` itself bounds the
  realistic maximum (a caller can select at most as many distinct valid options as exist).
- **Frontend checkbox-group state shape change** (`values[key]` becomes `string | number | string[]`
  depending on element type) touches `protocol-form.tsx`'s existing single-value assumptions in a
  few places (the `handleChange`/`isVisible`/submit-filtering logic) — needs care to avoid
  regressing the already-shipped single-value element types, verified via re-running the existing
  Breast/Colorectal/Pap live-verification scenarios from `task-642`'s own §8 as regression, not
  just testing the two new protocols in isolation.

## 7. Acceptance criteria

1. A new `synoptic_element.data_type = 'coded_multi'` element renders as a checkbox group (not a
   `<select>`) in the generic renderer, sourcing its options from `responseOptions` exactly like
   `coded` elements do today.
2. Selecting/deselecting checkboxes updates the element's own array value; submitting sends
   `{elementKey, value: string[]}` for that element.
3. The backend rejects a submission containing any array entry not present in the element's own
   `responseOptions`, and accepts one where every entry is valid.
4. A successful `coded_multi` submission persists as a single `observation` row
   (`dataType: 'structured'`, `valueJson` holding the selected array) — confirmed by direct query,
   not inferred.
5. `Prostate_4.3.0.0` and `Lung_5.1.0.0` are both seeded as `published` protocol versions and
   render correctly, end-to-end, through the same generic renderer already proven against
   Breast/Colorectal/Pap — no protocol-specific frontend code added.
6. A real submission on each of the two new protocols succeeds and correctly interacts with
   `buildCaseReportContent()`'s existing synoptic-response snapshot logic (unchanged code path,
   confirmed via regression, not re-implemented).
7. Regression: Breast/Colorectal/Pap (all single-value element types) continue to render, validate,
   and submit correctly after the `protocol-form.tsx` state-shape change.

## 8. Testing plan

- New unit/e2e coverage in `synoptic-protocol.e2e-spec.ts`: a `coded_multi` element records
  correctly with 2+ selections; an invalid entry anywhere in the array is rejected; the persisted
  `observation` row's `valueJson` matches the submitted array exactly.
- Re-run `synoptic-response-recorder.spec.ts`, `workflow-condition-evaluator.spec.ts`,
  `case-sign-out.e2e-spec.ts` unmodified as regression (the last one specifically re-confirms
  `buildCaseReportContent()`'s synoptic-response snapshot is unaffected).
- Live browser verification (`web-verify`), extending `task-642`'s own scenario list: Prostate and
  Lung both render their full real element sets through the generic renderer; a real submission on
  each succeeds with a correct confirmation view; at least one real checkbox-group interaction is
  driven live (select two options, confirm both submitted; deselect one, confirm only one
  submitted); regression pass re-confirms Breast's own single-select/quantity/text elements still
  work after the state-shape change.

## 9. Rollback plan

Additive: a new CHECK-constraint value, a new Zod union member, a new renderer branch, two new
seed files. Revert is a plain `git revert` plus a down-migration removing `coded_multi` from the
CHECK constraint (safe only once confirmed no `coded_multi` element rows exist yet, i.e. before
the two new protocols are seeded in any environment that matters — true at merge time for this PR).

## 10. Questions requiring human approval

All three resolved by explicit human walkthrough, 2026-08-20 — recommended defaults taken in every
case:

**Q1 — Transcription fidelity for deeply-nested conditional sub-branches (§5.5). RESOLVED: flatten
to top-level conditional elements.** Each nested sub-question becomes its own top-level element
with an `in`-style `visibilityCondition` on the relevant parent selections (Prostate's
tertiary-pattern/percentage-of-pattern-4 sub-fields; Lung's per-focality-option
nodule/metastasis counts). Every real data element stays recordable and validated; only the
*presentation grouping* is flattened relative to the source document's own visual indentation.

**Q2 — `coded_multi` array value in `visibilityCondition`/outbox-event context. RESOLVED: reuse
the existing `'includes'` operator, no new operator or schema change.** `context: Record<string,
unknown>` already accepts an array unchanged, and `evaluateCondition`'s existing `'includes'`
operator already does exactly what's needed.

**Q3 — Scope confirmation. RESOLVED: exactly Prostate + Lung, no additional protocols added
opportunistically in this PR** — even though §5.6's broader survey confirms `coded_multi` would
likely benefit a much larger slice of the CAP library. Any further protocols are a separate,
future decision.
