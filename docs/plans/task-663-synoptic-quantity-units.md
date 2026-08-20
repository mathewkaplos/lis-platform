# Implementation Proposal: Units + precision qualifier on synoptic quantity elements (issue #663)
Status: APPROVED
ADR: adr-0050 (synoptic protocols)    Date: 2026-08-20    Backlog ID: issue #663

## 1. Goal

`synoptic_element`'s `quantity` dataType has no unit anywhere (schema, wire
payload, or response storage) and no way to express CAP's own recurring
"Exact number / At least / Cannot be determined" precision-qualifier
pattern. Confirmed via the 2026-08-20 AP architecture review's direct
corpus reading (106 real CAP protocols) that this is a real, recurring gap,
not a hypothetical — every measurement field in the sampled corpus pairs a
number with a unit and, in most cases, a precision choice.

## 2. Affected files

- **New migration:** add nullable `unit_id uuid REFERENCES unit(id)` to
  `synoptic_element` (`packages/db/src/schema/synoptic-protocol.ts` +
  matching `db/migrations/00XX_*.sql`). Plain `ADD COLUMN`, no CHECK
  constraint touched (unlike task-645's `coded_multi` widening, which
  wideed an existing CHECK — this is a genuinely new, nullable column).
- **Modify:** `packages/domain/src/synoptic-protocol.ts` —
  `synopticElementSchema` gains `unitId: z.uuid().nullable()` and
  `unitDisplay: z.string().nullable()` (the resolved display string, e.g.
  `"mm"` — resolved server-side, same pattern `responseOptions` already
  uses, so the frontend never needs its own unit-resolution logic).
- **Modify:** `apps/api/src/synoptic-protocol/synoptic-protocol.controller.ts`
  — `GET .../versions/:versionId` batch-resolves `unitId → unitDisplay` via
  `unit`/`codeSystemValue`, matching the existing `responseOptions`
  batch-fetch-by-element-ids pattern exactly.
- **Modify:** `apps/web/.../synoptic/[partId]/protocol-form.tsx` — the
  `quantity` branch renders `element.unitDisplay` as a small suffix label
  next to the number input when set; unchanged when `null`.
- **Modify (seed data, real content, not synthetic):** `db/seed/synoptic-protocol-colorectal.sql`
  — (a) seed a UCUM `mm` `code_system_value`/`unit` row (same pattern
  `chemistry-catalog.sql` already uses for `mg/dL`/`mmol/L`/etc.); (b) `UPDATE`
  the three already-seeded, already-real `_mm`-suffixed quantity elements
  (`tumor_max_dimension_mm`, `margin_distance_mm`,
  `invasion_beyond_muscularis_propria_mm`) to set `unit_id` — these already
  encode "mm" informally in their own label text, so this is completing
  something already true about them, not inventing new content; (c) add one
  new sibling `coded` element, `margin_distance_mm_precision` (`parentElementId`
  = `margin_distance_mm`'s id, so it renders nested/paired via the existing
  `ElementGroup` recursion), with three response options —
  `exact`/`at_least`/`cannot_be_determined` — matching CAP's own real,
  recurring wording for exactly this pattern (the concrete real-field test
  case the issue's own AC asks for).
- **New (test):** e2e coverage in `synoptic-protocol.e2e-spec.ts` — the
  version-tree route resolves `unitDisplay` correctly for `margin_distance_mm`;
  the new sibling precision element exists with the right options and
  correctly nests under its parent; a full recording including the
  precision-qualifier answer succeeds unchanged through the existing
  recorder (no recorder code change needed — see §5).

## 3. Architecture consulted

- `unit`/`analyte.defaultUnitId`/`code_system_value` (`packages/db/src/schema/catalog.ts`,
  read in full) — the real, already-proven unit mechanism this reuses
  directly, matching the issue's own explicit "don't invent a second
  terminology mechanism" instruction.
- `chemistry-catalog.sql`'s own UCUM seeding pattern (read in full) — the
  exact `code_system_value` → `unit` two-insert shape this proposal's new
  seed content follows verbatim.
- `synoptic-protocol.controller.ts`'s existing `responseOptions`
  batch-fetch-by-element-ids query (read in full) — the direct precedent for
  how `unitDisplay` gets resolved the same way, one query, not N+1.
- `protocol-form.tsx`'s `ElementGroup` recursion (read in full, already
  proven generic across 5 real protocols per the architecture review) — the
  precision-qualifier sibling element needs zero renderer change to nest
  correctly; only the unit-suffix-label addition to the `quantity` branch is
  a real UI change.
- Task-645's `coded_multi` migration (`db/migrations/0053_synoptic_multi_select.sql`,
  read in full) — the direct precedent for widening this schema again,
  though this proposal's own change (a new nullable column, not a CHECK
  widening) is structurally simpler.

## 4. Skills loaded

- `anatomic-pathology-synoptic-engine` — entry #2 (the exact primitive gap
  this issue closes) and entry #3 (CAP/ICCR divergence — not directly
  relevant here since units are a CAP-heavy pattern specifically, confirmed
  by the corpus research already cited in the issue).
- `engineering/database-design` — required: this proposal adds a new
  migration. Consulted for the FK/nullable-column convention and this
  repo's "never edit a past migration" rule (a fresh migration file, not a
  hand-edit of 0053).
- `engineering/api-design` — required: the version-tree route's response
  shape changes (two new fields). Entry #6 (only mutations audited — this
  route is already unaudited, unchanged) confirmed still applicable, nothing
  else in that Skill triggered by an additive response-field change.
- `engineering/frontend-design` — required: `protocol-form.tsx` changes.
  Read in full for any of its 11 entries that might apply — none are
  directly triggered (no new dynamic route, no new Server Action, no
  client-only library, no function-prop-into-Client-Component pattern); a
  real `web-verify` browser pass is still the actual proof per this Skill's
  own entry #4 precedent (Storybook/typecheck passing is not a substitute).

## 5. Assumptions & autonomous decisions

- **Unit lives on the element definition (`synoptic_element.unit_id`), not
  on the response/Observation.** Matches `analyte.defaultUnitId`'s own
  precedent exactly — a unit is inherent to what's being measured, not
  chosen per-answer. No `observation` schema change, no recorder change for
  units at all.
- **The precision qualifier is modeled as an ordinary sibling `coded`
  element** (grouped under its quantity element via the existing
  `parentElementId` mechanism), **not a new `synoptic_element.dataType`
  variant or a new response-payload shape.** This is the real "concrete
  decision on shape" the issue asks for: reuses 100% already-proven,
  already-generic machinery (nested grouping, coded response options,
  conditional visibility if ever needed) instead of adding new engine
  surface for what is structurally just another coded question. The
  recorder (`assembleAndPersistSynopticResponse`) needs **zero code
  changes** — a precision-qualifier answer is just another `elementKey` in
  the same `responses` array.
- **Only `margin_distance_mm` gets the precision-qualifier sibling**, not
  all three `_mm` elements — one real, concrete demonstration matching the
  issue's own AC ("pick one real field"), not a speculative rollout to
  every quantity field. The other two (`tumor_max_dimension_mm`,
  `invasion_beyond_muscularis_propria_mm`) get only the unit, per the
  issue's own "existing seeded protocols continue to work unchanged" bar —
  adding the qualifier to fields that don't need it yet is scope creep this
  proposal avoids.
- **No retroactive unit-seeding for Breast/Prostate/Lung/Cytology's own
  quantity elements** — matches the issue's own explicit out-of-scope line.

## 6. Risks

- Low risk: additive-only schema change (nullable column, no CHECK), no
  change to the recorder or the response wire shape for `quantity` itself,
  no change to any other protocol's seeded content.
- The one real UI risk is the same class `frontend-design` Skill entry #4
  already names generically — Storybook/typecheck passing doesn't prove the
  unit suffix renders correctly in a real browser; mitigated by a real
  `web-verify` pass before considering this done, not just CI green.

## 7. Acceptance criteria

- `GET /v1/synoptic-protocols/:id/versions/:versionId` for the colorectal
  protocol returns `unitDisplay: "mm"` for `margin_distance_mm`,
  `tumor_max_dimension_mm`, and `invasion_beyond_muscularis_propria_mm`, and
  `unitId: null`/`unitDisplay: null` for every element that doesn't declare
  one (proving the additive/nullable bar).
- The same response includes `margin_distance_mm_precision` as a `coded`
  element with exactly the three real response options, nested under
  `margin_distance_mm` via `parentElementId`.
- A full recording that includes both `margin_distance_mm` (a number) and
  `margin_distance_mm_precision` (one of the three coded options) succeeds
  through the existing, unmodified recorder.
- The case-detail synoptic recording page renders the unit suffix next to
  the number input for a unit-bearing element, and renders the precision
  qualifier as an ordinary nested coded field — verified in a real browser,
  not just via the API response shape.
- Every other currently-seeded quantity element (Breast, Prostate, Lung,
  Cytology; the two other colorectal `_mm` fields already covered above)
  continues to record and render exactly as before.

## 8. Testing plan

- New e2e coverage in `synoptic-protocol.e2e-spec.ts`: version-tree
  `unitDisplay` resolution (present and absent cases), the precision-qualifier
  sibling element's shape, and a full recording exercising both together.
- Full existing `apps/api` e2e suite re-run clean against a freshly reset
  local DB.
- Real browser `web-verify` pass: navigate to the colorectal recording page,
  confirm the unit suffix renders next to `margin_distance_mm`'s input and
  the precision-qualifier field renders nested beneath it, submit a real
  response including both, confirm success.

## 9. Rollback plan

Additive schema change (new nullable column, new seed rows/updates, no
CHECK/trigger change) — a plain revert restores prior behavior. The one
non-trivial rollback consideration: the seed `UPDATE` statements setting
`unit_id` on the three existing elements are themselves idempotent
(re-running `db-reset.sh` reapplies cleanly), so no special down-migration
handling is needed beyond dropping the new column.

## 10. Questions requiring human approval

1. **Precision qualifier modeled as an ordinary sibling coded element**
   (recommended, reasoned in §5) rather than a new `dataType`/response-shape
   — confirm this is the right shape, not a lighter-weight alternative (e.g.
   a fixed enum baked directly into the frontend with no backend
   representation at all, which would fail the issue's own "matching a real
   CAP field" AC since it wouldn't be recordable/queryable data).
2. **Only `margin_distance_mm` demonstrates the precision qualifier**, the
   other two `_mm` fields get only the unit — confirm this narrower scope
   is acceptable per the issue's own "pick one real field" AC, rather than
   applying the qualifier to all three.

If both are acceptable, approving this proposal as-is is sufficient to
proceed.
