# Implementation Proposal: Repeating element groups (issue #666)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #666

## 1. Goal

Real CAP/ICCR protocols repeat a sub-form N times (CAP Breast's Tumor
Characteristics, keyed by "Tumor Identifier", up to 5 instances; biomarker
panels; repeated nodal basins). `synoptic_element` has no repeating variant
today -- `ElementGroup` only renders a static parent/child tree once.

## 2. Design

### Schema (additive to `synoptic_element`)

- `repeatable boolean not null default false` -- marks an element as the
  root of a repeating instance group. A repeatable root is a pure grouping
  header (not itself independently answerable) -- its children repeat as a
  unit; nested non-repeatable children under a repeatable root behave
  exactly as issue #663's precedent already established.
- `identity_element_key text` nullable -- the `key` of a direct child that
  serves as the group's human-identifying field (mirrors CAP's own "Tumor
  Identifier" pattern). Referenced by key string, not FK, matching
  `visibilityCondition`'s existing field-name-based targeting convention
  (validated in application code, same "shape validated in code, not SQL"
  precedent `synopticElementResponseOption`'s own header comment
  documents). `CHECK (identity_element_key IS NULL OR repeatable = true)`.

### Response addressing: composite element keys, not a new storage column

The grid Observation's `valueJson.results` array and the discrete
per-element Observations already treat `elementKey` as an opaque string
(`SynopticResponseResultEntry.elementKey`) -- the amendment-linkage map
(#662), the audit event, and the read path (#659) never parse it, they just
carry it through. This is reused directly: a response for a descendant of a
repeatable group is addressed as `"<elementKey>@<instanceKey>"` (new domain
helpers `makeInstanceResponseKey`/`parseInstanceResponseKey` in
`packages/domain`), where `instanceKey` is a client-generated opaque string
(one per rendered instance row, stable for the lifetime of that instance in
the form). No `observation` table column changes -- multiple concurrently-
current discrete Observations for the same `analyteId`/`orderedTestId` are
already mechanically fine, since supersession is driven entirely by each
row's own `amendmentOf` pointer, never by a per-analyte uniqueness
assumption (confirmed by reading `synoptic-response-recorder.ts` and
`fn_observation_supersede`).

Accepted MVP limitation, stated explicitly rather than silently: a
re-recording continues the same instance's amendment chain only if the
*same* client-generated `instanceKey` is resubmitted (i.e. the user didn't
remove and re-add that row in the UI between recordings) -- continuity is by
structural instance identity, not by matching the identity-field's own
*value*. Re-identifying instances by content equality is real added
complexity with no concrete requirement behind it yet; flagged here rather
than solved speculatively.

### Recorder (`synoptic-response-recorder.ts`)

- Parse each response entry's `elementKey` into `{ baseKey, instanceKey }`.
  Element lookup (`elementByKey`), value-shape validation, and the discrete-
  Observation insert loop all key off `baseKey` -- the insert loop is
  otherwise unchanged, since it already just writes one Observation per
  response entry using whatever string was supplied as `elementKey`.
- Required/visibility validation changes from one flat pass to: (a) a
  top-level pass over every element that is not a descendant of any
  repeatable root, exactly as today; (b) for each repeatable-root element
  present among `elements`, one pass per distinct `instanceKey` seen in the
  payload for its descendants, evaluating that instance's own required/
  visibility rules against a merged context (top-level answers + that
  instance's own descendant answers, keyed by plain `baseKey` so a
  descendant's `visibilityCondition` can reference a sibling within the same
  instance exactly like a non-repeating field references a top-level
  sibling today). A repeatable root itself is `required` semantics: zero
  instances is only an error if the root element's own `requirement` is
  `required`/`conditional`, i.e. group presence is optional by default
  (multifocal-tumor protocols legitimately have single-focus cases).

### Frontend (`protocol-form.tsx`)

- `ElementGroup`, on encountering `element.repeatable`, renders an
  "Add <label>" control plus one bordered instance block per entry in local
  `instances[element.key]: string[]` (instanceKeys, generated via
  `crypto.randomUUID()` on add), each recursing into `ElementGroup` for that
  element's children with an `instanceKey` prop threaded through so
  `FieldControl`/`onChange`/`onToggleMulti` read/write `values` under the
  composite key. Each instance block gets a "Remove" control.
- `handleSubmit` builds response entries the same way for both plain and
  composite keys -- `values` is already flat, keyed by whatever string
  `onChange` was called with, so no separate code path is needed there.

## 3. Architecture consulted

- `synoptic-response-recorder.ts` (#659/#662/#664) -- confirmed the
  composite-key reuse is sound (see above).
- `protocol-form.tsx` (#663/#664) -- confirmed `ElementGroup`'s existing
  recursion is the right base to extend, not replace.
- `frontend-design` Skill -- read; no entry beyond general review (no new
  route, no new Server Action).

## 4. Acceptance test

Per the issue's own guidance, uses a real CAP field shape (Breast's
multifocal Tumor Characteristics: identity field "Tumor Identifier" +
"Tumor Size", both real ICCR/CAP concepts) inserted as test-only
`synoptic_element` rows directly via `db.insert`, matching #664's own
established precedent -- not a seed-content change, proportional to this
issue's acceptance criteria rather than importing a full second protocol.

## 5. Assumptions & autonomous decisions

- Repeatable roots are pure grouping headers (not independently
  answerable) -- avoids a real edge case (disambiguating the root's own
  value across instances) that has no concrete requirement behind it; CAP's
  own repeating sections are headers in every case reviewed during the
  architecture pass.
- Instance continuity across re-recordings is structural (by
  `instanceKey`), not content-based (by identity-field value) -- documented
  MVP limitation above.
- No UI reordering of instances -- add/remove only, matching the issue's
  acceptance criteria (record multiple instances, retrieve them correctly)
  with no ordering requirement stated.

## 6. Risks

Additive schema change (new nullable/defaulted columns, no backfill).
Recorder validation logic is genuinely new code, not a schema tweak --
mitigated with direct e2e coverage of both the flat and instanced paths in
one request.

## 7. Acceptance criteria (from issue, restated)

- A protocol version can declare a repeatable element group with an
  identity key. -- `repeatable` + `identityElementKey` columns.
- Multiple recorded instances of a group are correctly stored, retrievable
  via #659's read path, matching composite `elementKey`s in `results`.
- Non-repeating elements/groups are unaffected -- confirmed by keeping the
  existing flat-key code paths untouched for non-instanced entries.

## 8. Out of scope

- The reusable concept-block library (#667) and the biomarker-panel type
  (#668) -- separate issues, real consumers of this work.
- Case-level PDF renderer repeating-structure awareness (#669) -- separate
  issue.

## 9. Questions requiring human approval

None -- the issue's own "Design considerations" section explicitly grants
this level of design latitude ("needs a concrete design -- likely an
instance identifier alongside the existing orderedTestId scoping").
