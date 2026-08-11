# Implementation Proposal: FEAT-047 Visual report designer v1
Status: APPROVED
ADR: adr-0042 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-047 (#56)

**Approved 2026-08-11** via the native options-prompt (all three §10 questions accepted as
drafted: ADR-0042's five scope cuts, schema relocation to packages/domain, reuse of the existing
qa-gated manage_report_templates capability).

## 1. Goal
"Let a lab admin design report layouts visually rather than via config file" (issue #56's own
purpose line). FEAT-032 (Template engine) already shipped the full runtime and data model this
feature authors against — `report_template`/`report_template_version`, versioned lifecycle,
analyte-binding publish-time guardrail, five field types — deliberately API/JSON-only, with its own
proposal explicitly naming "a future feature" as KB-13's visual canvas's natural owner. This is
that feature.

**Central finding, surfaced before any design choice (ADR-0042):** KB-13 (this issue's own named
architecture doc) describes a materially larger system than the literal AC requires — a full
node catalog, a visual logic builder, live dual-mode preview, version diff. ADR-0042 scopes v1 to
a structured section/field canvas over the *existing* API, deferring the rest as real, tracked
future work, the same narrowing discipline FEAT-032's own proposal already applied to KB-12.

## 2. Affected files
- `~/work/lis-engineering/adr/adr-0042-visual-report-designer-v1-is-a-structured-canvas-over-the-existing-template-engine-api-not-kb-13s-full-authoring-suite.md` (new, drafted, Status: proposed).
- `packages/domain/src/report-template.ts` (new) — `reportTemplateDefinitionSchema`/
  `templateFieldSchema`/`templateSectionSchema` moved here from `apps/api/src/report-template/
  report-template-schemas.ts` (currently apps/api-local, per FEAT-032's own "no `apps/web` screen"
  scope) so the designer's client-side validation reuses the exact same schema the server enforces
  — the "one schema, three consumers" discipline every other cross-app form in this repo already
  follows. Response DTOs (`ReportTemplateDto`/`ReportTemplateVersionDto`) added alongside.
- `apps/api/src/report-template/report-template.controller.ts` — no new routes; `list()`/`create()`/
  `createVersion()`/`publish()` gain `@ZodResponse` against the new domain response schemas
  (currently undocumented in the generated OpenAPI schema — `content?: never`, the same gap
  FEAT-046 found and fixed for its own routes).
- `apps/web/app/(app)/admin/report-templates/` (new):
  - `page.tsx` — list of existing templates (one row per test with a template, per-test
    draft/published version badges), mirroring `admin/tests/page.tsx`'s own `hasQaRole`-gated,
    server-fetched-list shape.
  - `[testDefinitionId]/page.tsx` — the designer itself: section/field canvas, analyte-binding
    picker (scoped to that test's own `test_analyte` set), JSON-mode `visibilityCondition` editor,
    client-side mock preview, "Save as new version" and "Publish" actions.
  - `[testDefinitionId]/designer.tsx` (client component) — the canvas's own local-state tree
    (sections/fields), built up entirely client-side; nothing is persisted until "Save," which
    calls `POST /v1/report-templates` (first template for this test) or `POST .../versions`
    (subsequent), then optionally `POST .../versions/:versionId/publish`.
  - `[testDefinitionId]/preview.tsx` — the client-side mock renderer (ADR-0042 §4): walks the same
    section/field tree, rendering one sample value per field type, no server call.
  - `[testDefinitionId]/actions.ts` — the three Server Actions (create template, create version,
    publish), each a thin `createLisApiClient` call, mirroring `admin/tests/actions.ts`'s own
    shape.
- `apps/api/test/report-template-designer.e2e-spec.ts` (new) — real Postgres: create a template via
  the designer's own request shapes, publish it, confirm the guardrail still rejects an unbound
  field/an out-of-set analyte binding through this same path (proves the client-side picker's
  constraint isn't the *only* thing preventing an invalid template — the server remains
  authoritative, KB-13's own explicit design decision).

## 3. Architecture consulted
- KB-13 (Report Designer) — the destination this v1 deliberately doesn't fully build yet; ADR-0042
  documents exactly which parts.
- KB-12 (Template Engine) — the already-shipped runtime this feature authors against; not
  re-litigated.
- FEAT-032's own Implementation Proposal — the direct precedent for narrowing a KB-vision-sized
  issue to its own literal AC, and the exact five-field-type/guardrail/lifecycle shape this
  proposal builds a UI over, unchanged.
- `report-template-guardrails.ts` — the server-authoritative validation (KB-13's own "server
  decides" design decision) this proposal's own e2e test proves is not bypassable via the designer.
- `admin/tests/page.tsx`/`create-test-form.tsx` (FEAT-035) — the direct UI-shape precedent: a
  `hasQaRole`-gated admin screen, `useActionState` + `FormField`, analyte options derived
  client-side from `GET /v1/catalog`'s existing per-test analyte list.
- `engineering/frontend-design` (required by the feature's own issue) — entries #6 (function-valued
  props into Client Components — the canvas's own drag/reorder handlers must live in a `'use
  client'` component), #8 (`'use server'` files may only export async functions — the three
  designer actions get their own `types.ts`), #9 (route-group URL prefixes — `(app)` already
  established, no new group needed here).
- `engineering/api-design` (required — this feature adds `@ZodResponse` to existing routes; loaded
  from the start, not missed the way FEAT-049's own proposal missed it).

## 4. Skills loaded
- `engineering/frontend-design` (required by the feature's own issue).
- `engineering/api-design` — entry #8 (`ZodValidationPipe` schema-passing, already correctly done
  in the existing controller) and the response-schema/OpenAPI-documentation lesson `engineering/
  billing` entry #2 just added (a bare inline type/undocumented response silently produces no SDK
  typing).
- `engineering/workflow-engine` — `ConditionNode`/`evaluateCondition`'s own shape, reused verbatim
  for the JSON-mode logic editor's client-side validation.
- `engineering/testing` — entry #1 (real-Postgres e2e for the guardrail-still-enforced proof).

## 5. Assumptions & autonomous decisions
- **ADR-0042's own five scope cuts** (structured canvas not free node catalog; scoped analyte
  picker not global search; JSON-mode conditions not a visual builder; client-side mock preview not
  live PDF/form preview; no diff/`in_review` UI) — flagged together as §10 question 1, since they're
  one coherent scope decision, not five independent ones.
- **No update-draft endpoint.** The canvas builds the full definition in local component state;
  nothing is persisted until "Save," which always calls `createVersion` (or `create` for a test's
  first template) — never a partial/incremental server write. Matches the existing API's own
  create-then-publish shape exactly; no new backend mutation route needed.
- **`reportTemplateDefinitionSchema` moves to `packages/domain`.** A real, small backend change
  (import-path only, no behavior change) — necessary so the designer's client-side validation is
  the same schema instance the server enforces, not a hand-copied risk of drift.
- **No new capability/role.** Reuses `manage_report_templates` (`qa` only) unchanged — "lab admin"
  in the issue's own purpose line maps directly to the existing `qa` persona already gating this
  exact resource.

## 6. Risks
- **The client-side mock preview can visually diverge from the real PDF output** (ADR-0042's own
  stated consequence) — acceptable for v1, tracked as a real gap, not silently presented as
  "what your report will actually look like."
- **A field's `analyteBinding` picker is scoped per-test at fetch time** — if a test's own
  `test_analyte` set changes after the designer loads (a concurrent admin action), a stale option
  could be submitted; the server's own guardrail (unchanged) still rejects it at publish time, so
  this is a UX rough edge (a late error message), not a correctness gap.
- **No visual feedback for an invalid JSON-mode condition until save** — client-side validation
  against `conditionNodeSchema` runs on blur/save, not fully live-as-you-type; acceptable for a
  power-user-facing advanced-mode field, not a general-audience form control.

## 7. Acceptance criteria
- [ ] A lab admin (existing `qa` role) can, using only the designer UI: pick a test with no
      existing template, add sections and fields of all five supported types, bind a numeric/coded/
      referenceRangeDisplay field to one of that test's own analytes, save a new version, and
      publish it.
- [ ] The analyte-binding picker never lists an analyte outside the target test's own bound set.
- [ ] Submitting a template with an unbound clinical field or an out-of-set analyte binding via the
      designer's own save action surfaces the server's real guardrail error, not a generic failure
      — proven by both a client-side check (fast feedback) and a real e2e test hitting the
      guardrail directly (the client-side check is not the only thing preventing an invalid
      template).
- [ ] The preview renders without any server call and without requiring any real order/observation
      data.
- [ ] Every existing `report-template.e2e-spec.ts` assertion (FEAT-032's own suite) passes
      unmodified — the designer is additive, not a behavior change to the underlying API.

## 8. Testing plan
- Unit: none new beyond what's already covered (`report-template-guardrails.spec.ts`, unchanged) —
  the designer's own client-side logic (tree add/reorder/remove, mock-preview rendering) is UI
  state manipulation, proven via the manual browser pass, not a new unit-test surface (matching
  this repo's own precedent of not unit-testing plain component state transitions elsewhere).
- Integration (real Postgres, `engineering/testing` entry #1): `report-template-designer.e2e-spec
  .ts` — the full create → version → publish round trip via the designer's own request shapes, plus
  the guardrail-still-enforced proof.
- Manual: the designer driven through a real headless browser (`web-verify`) — light/dark,
  keyboard-only section/field add-and-reorder, all four UI states, a full create-to-publish run.

## 9. Rollback plan
One new `apps/web` route tree, one schema-file relocation (no behavior change), `@ZodResponse`
additions to already-shipped routes (additive — response shape is a superset of what already
returns, not a breaking change to any existing caller). A plain revert removes the UI with zero
data or contract implications — every underlying table/route FEAT-032 already shipped is untouched.

## 10. Questions requiring human approval
1. **Approve ADR-0042's five scope cuts as one coherent v1 boundary** — structured canvas (no new
   field types), analyte picker scoped to the test's own set, JSON-mode `visibilityCondition` (no
   visual logic builder), client-side mock preview (no live PDF/form preview), no version diff/
   `in_review` UI — with each deferred piece tracked as real future work, not silently dropped?
2. **Approve moving `reportTemplateDefinitionSchema` (and friends) into `packages/domain`** so the
   designer's client-side validation reuses the server's own schema instance?
3. **Approve reusing the existing `manage_report_templates` (`qa`-only) capability** with no new
   role, matching the issue's own "lab admin" framing to the persona already gating this resource?
