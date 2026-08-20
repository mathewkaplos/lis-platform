# Implementation Proposal: Three-tier requirement model for synoptic elements (issue #664)
Status: APPROVED
ADR: adr-0050 (synoptic protocols)    Date: 2026-08-21    Backlog ID: issue #664

## 1. Goal

`synoptic_element.requirement` is `required|recommended` today. Direct
corpus reading confirms neither real standard maps cleanly onto two tiers:
CAP uses Core/Conditional/Optional (a field's tier is itself versioned,
confirmed via a real changelog entry); ICCR uses Core/Non-core, defined by
evidentiary support tier. Neither has a way to express "this is only
required when a condition holds" today — `conditional` doesn't exist as a
concept, even though the mechanism that would enforce it
(`visibilityCondition`/`evaluateCondition`) already does.

## 2. Affected files

- **New migration:** widen `synoptic_element`'s `ck_synoptic_element_requirement`
  CHECK constraint from `('required','recommended')` to
  `('required','recommended','conditional')` — pure `DROP`/`ADD CONSTRAINT`,
  the identical pattern task-645's `coded_multi` widening already used. **No
  rename of the two existing values** (see §5 for why).
- **Modify:** `packages/domain/src/synoptic-protocol.ts` —
  `SYNOPTIC_ELEMENT_REQUIREMENTS` gains `'conditional'`; add a small,
  exported pure function `requirementLabel(sourceStandard, requirement):
  string` resolving the source-standard-aware display label (§5).
- **Modify:** `apps/api/src/synoptic-protocol/synoptic-response-recorder.ts`
  — the missing-required check widens from `element.requirement !==
  'required'` to `element.requirement === 'recommended'` (skip only
  `recommended`; enforce both `required` and the new `conditional` the same
  way, when visible — see §5).
- **Modify:** `apps/web/.../synoptic/[partId]/page.tsx` — passes
  `sourceStandard` through to `ProtocolForm` (already fetched and already
  rendered elsewhere on this same page — no new query).
- **Modify:** `apps/web/.../synoptic/[partId]/protocol-form.tsx` — accepts
  `sourceStandard`; a `conditional` element's `FormField` shows both the
  existing required-asterisk (still enforced when visible) and a small
  "(Conditional)" hint text, using `requirementLabel` for the tier word
  itself.
- **New (test):** e2e coverage in `synoptic-protocol.e2e-spec.ts` — a
  `conditional` element behaves exactly like `required` when visible
  (rejected if omitted) and is skipped when hidden by its own
  `visibilityCondition` (reusing the exact mechanism, not a new one); a
  `recommended` element remains genuinely optional; `requirementLabel`
  resolves correctly for both `sourceStandard` values via a small unit test.

No seed-file content changes — see §5 for why this is deliberately additive,
not a rename.

## 3. Architecture consulted

- The 2026-08-20 architecture review (§9, §10, §12, §21) and the CAP/ICCR
  corpus findings it cites — the real evidentiary basis for why two tiers
  don't fit either standard.
- `db/migrations/0053_synoptic_multi_select.sql` (task-645, read in full) —
  the direct, already-proven precedent for widening this exact table's own
  CHECK constraints via `DROP`/`ADD CONSTRAINT`, reused verbatim here.
- `synoptic-response-recorder.ts`'s missing-required check (read in full) —
  confirmed the *only* place requirement tier drives real validation
  behavior; `visibilityCondition`/`evaluateCondition` (already read in full
  for #663) is the *existing* mechanism a `conditional` tier needs, not a
  new one.
- `protocol-form.tsx` (read in full, already refactored for #663's
  `FieldControl` extraction) — the exact insertion point for a tier label,
  and confirmation that `sourceStandard` is already fetched and rendered one
  level up (`synoptic/[partId]/page.tsx:111`) and just needs threading
  through one more prop, not a new fetch.
- Direct grep across `apps/api/src`, `apps/web/app`, `packages/domain/src`
  confirmed the *entire* blast radius of the literal strings `'required'`/
  `'recommended'` is exactly these three production files (plus the schema/
  migration) — no other consumer, no test fixture asserts on the literal
  value, no seed file needs its own content touched (see §5).

## 4. Skills loaded

- `anatomic-pathology-synoptic-engine` — entry #2 (this exact primitive gap,
  including the explicit corpus evidence already gathered) and entry #3
  (CAP/ICCR real divergence — directly informs why the label mapping must be
  source-standard-aware, not a single shared vocabulary).
- `engineering/database-design` — required (new migration). Consulted for
  this repo's CHECK-widening convention, confirmed identical to task-645's.
- `engineering/api-design` — required (recorder validation logic changes,
  though no route signature changes). Entry #6 (only mutations audited)
  confirmed unaffected — this is a validation-rule change, not a new route.
- `engineering/frontend-design` — required (`protocol-form.tsx` changes).
  Read in full for all 12 entries; none directly triggered (no new dynamic
  route, no new Server Action, no client-only library) — the real proof is
  still a `web-verify` browser pass before considering this done, matching
  #663's own precedent where that exact discipline caught a real bug.

## 5. Assumptions & autonomous decisions

- **The enum stays `required`/`recommended`/`conditional` — not renamed to
  `core`/`optional`/`conditional`.** This is the real design call the issue
  asks for, reasoned through rather than defaulted: renaming would require
  editing the literal `VALUES` content of five careful, citation-heavy seed
  files (110 real rows across Breast/Colorectal/Lung/Prostate/Cytology,
  transcribed from real cited sources) purely for cosmetic naming, a real
  and unnecessary risk of introducing a transcription error into content
  that took real research effort to get right. The *display* label is where
  CAP/ICCR-native vocabulary belongs (via `requirementLabel`), not the
  stored value — matching this table's own existing precedent of
  `synoptic_element_response_option`'s `value` column being an internal key
  distinct from its own `display` text.
- **`requirementLabel(sourceStandard, requirement)` mapping:**
  | `requirement` | CAP label | ICCR label |
  |---|---|---|
  | `required` | "Core" | "Core" |
  | `conditional` | "Conditional" | "Conditional" |
  | `recommended` | "Optional" | "Non-core" |

  ICCR's own two-tier system has no real "Conditional" concept distinct from
  Non-core — a future ICCR-sourced element using `conditional` would still
  render "Conditional" (the mechanism is standard-agnostic; only the
  `recommended` tier's *label* genuinely differs by source, matching the
  real divergence the corpus research found).
- **Validation semantics: `required` and `conditional` are enforced
  identically** (must-answer when not hidden by `visibilityCondition`);
  `recommended` alone is skipped. This is the core simplification the issue
  itself points at: "conditional" isn't a new *validation* concept, it's a
  new *label* for exactly the required-when-visible behavior
  `visibilityCondition` already implements — no new logic branch needed
  beyond widening which values count as "enforced."
- **No existing seeded element is changed to `conditional`** in this
  proposal — this issue is about making the tier *representable*, not about
  re-classifying existing content (a real editorial decision about individual
  fields is out of scope, matching the issue's own "no seed-file content
  changes" framing above).

## 6. Risks

- Low risk: purely additive CHECK widening (proven pattern), no data
  migration, no existing seeded element's behavior changes (every current
  `required`/`recommended` element keeps its exact current tier and exact
  current validation behavior).
- The one real risk class is the same `frontend-design` Skill precedent
  #663 already surfaced: a UI change needs a real browser check, not just
  typecheck/CI green, before being trusted.

## 7. Acceptance criteria

- A `synoptic_element` row can be inserted with `requirement = 'conditional'`
  (CHECK constraint no longer rejects it).
- A `conditional` element that's visible (per its own `visibilityCondition`,
  or unconditionally visible) and omitted from a recording is rejected the
  same way a `required` element already is.
- A `conditional` element hidden by its own `visibilityCondition` is
  correctly skipped, matching `required`'s own existing hidden-element
  behavior.
- `requirementLabel` resolves the correct label for both `sourceStandard`
  values, for all three tiers.
- Every currently-seeded protocol continues to record and validate exactly
  as before — proven by the full existing e2e suite passing unchanged.

## 8. Testing plan

- New unit test for `requirementLabel` (packages/domain), all
  tier×sourceStandard combinations.
- New e2e coverage in `synoptic-protocol.e2e-spec.ts`: a `conditional` test
  element (added to one seeded protocol as part of this task, reusing an
  existing element's `visibilityCondition` shape) proves both the
  visible-and-omitted-rejected and hidden-and-skipped cases.
- Full existing `apps/api` e2e suite re-run clean against a freshly reset
  local DB.
- Real browser `web-verify` pass on the recording page confirming the
  `(Conditional)` hint renders correctly and the required-asterisk still
  shows for both `required` and `conditional` fields.

## 9. Rollback plan

Purely additive (new CHECK value, no data migration, no rename) — a plain
revert restores prior behavior exactly; any row that happened to be
inserted with `requirement = 'conditional'` during this feature's lifetime
would need a one-time cleanup only if reverting after real `conditional`
content was seeded, which this proposal doesn't do.

## 10. Questions requiring human approval

1. **Keep the stored enum values `required`/`recommended`/`conditional`**
   (no rename to `core`/`optional`) — reasoned in §5 as the lower-risk
   choice given the seed-content blast radius; confirm this over a full
   rename.
2. **`required` and `conditional` share identical validation semantics**
   (enforced-when-visible), differing only in display label — confirm this
   matches the issue's own intent rather than wanting `conditional` to have
   some distinct validation behavior.

If both are acceptable, approving this proposal as-is is sufficient to
proceed.
