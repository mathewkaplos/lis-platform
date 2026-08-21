# Implementation Proposal: Coded/table clinical result rendering (organism ID, antibiogram)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #694 (tracking #529, #530)

## 1. Goal

Manual verification of #529/#530 (2026-08-21, real API-recorded antibiogram
against a local dev DB, findings posted on both issues) confirmed three
related gaps:

1. `apps/web`'s results screen (`orders/[id]/results/page.tsx:90`) filters
   analyte rows to `dataType === 'quantity' | 'ordinal'` only -- Organism
   Identification (`coded`) and the antibiogram (`table`) never render on
   the interactive results screen at all, for any discipline, not just
   culture.
2. The PDF report shows a coded result's raw value (`112283007`) instead of
   its display label (`Escherichia coli`) -- `formatObservationValue()`
   (`apps/api/src/report/report-assembly.ts:120-121`) returns `valueCode`
   verbatim for every `coded` observation, across every discipline.
3. Neither surface gives a Resistant (R) interpretation any visual
   distinction from Susceptible/Intermediate.

This proposal scopes a fix for all three, read-only (see §5 for what's
explicitly deferred).

## 2. Affected files

- `apps/web/app/(app)/orders/[id]/results/page.tsx` -- widen the dataType
  filter to include `coded`/`table`; fetch each row's resolved display
  label (see §5 Q1) instead of a raw code.
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` -- render a
  read-only row for `coded`/`table` (no editable input control -- see §5
  Q3), reusing the existing `verifyResult()` action unchanged (confirmed
  dataType-agnostic already: manually verified both a `coded` and a
  `table` observation through the real `.../results/:analyteId/verify`
  endpoint during this session's own verification pass).
- `packages/ui/src/components/` -- a new small presentational component
  for an S/I/R interpretation badge (not `StatusPill`/`FLAG_META` --
  `'R'` is already reserved there for a future *reflex* flag per
  `observation.flags`'s own schema comment; a different semantic, real
  collision risk if conflated). Follows `frontend-design` Skill entry #1's
  rule (never color-alone) without reusing its specific flag alphabet.
- `apps/api/src/report/report-assembly.ts` -- `formatObservationValue()`'s
  `coded` branch resolves a display label instead of returning `valueCode`
  raw (see §5 Q1 for how).
- `packages/domain/src/observation.ts` (or wherever the results-list
  response schema lives) -- additive fields on the existing
  `GET /v1/ordered-tests/:id/results` response: a resolved display label
  for `coded` rows, and the antibiogram's own structured `{organismDisplay,
  results}` shape for `table` rows (today only available via
  `valueJson`, not exposed on this endpoint at all).
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` -- regenerated
  after the schema change.

## 3. Architecture consulted

- `apps/api/src/antibiogram/antibiogram-assembly.ts:140-146` -- the real,
  already-working precedent for resolving a coded value's display label:
  joins a specific catalog table (`organism`) to `code_system_value` by
  matching `code_system_value.code = observation.valueCode`. This is
  catalog-specific, not a generic "look up any code in `code_system_value`"
  join -- `code_system_value` holds many unrelated coding systems
  (`ICCR-SYNOPTIC`, `CAP-SYNOPTIC`, `UCUM`, `LOINC`, SNOMED via `organism`,
  etc.), and a bare `code` match with no `system` scoping risks a
  cross-system collision. See §5 Q1.
- `report-assembly.ts:96-109`'s own header comment (FEAT-054) already
  flags "a genuinely bigger, separate rendering-architecture change" as
  out of scope for the antibiogram's own table-to-report path -- this
  proposal does not revisit that call (see §5 Q2).
- `frontend-design` Skill entry #1 (clinical flags never color-only,
  `StatusPill`/`FLAG_META`) and entry #7 (`observation.flags` can hold
  multiple values, must map every element) -- read in full; informs §2's
  "new component, not a `StatusPill` extension" decision.

## 4. Skills loaded

`frontend-design` (new `packages/ui` component + `apps/web` page changes,
required per the `plan` Skill's own checklist regardless of whether #694
names it) and `api-design` (existing route's response shape widens,
required per its own frontmatter for "any new resource route" -- this
proposal doesn't add a new route, but the same discipline applies to
widening an existing one: checked entry #14 for the DTO-shape pitfall
before deciding this is a plain additive-field widening, not a shape
change that would hit that pitfall).

## 5. Assumptions & autonomous decisions

- Scoped to **display only** -- no new data-entry UI for arbitrary coded
  values in the generic results grid. Organism ID and antibiogram both
  already have real, working entry mechanisms (`PUT .../results/:analyteId`
  for organism ID's `coded` value; the dedicated
  `POST .../antibiogram` endpoint) -- this proposal makes already-recorded
  values visible and legible, it doesn't change how they're recorded.
- The results-list API response widens additively (new optional fields on
  the existing shape) rather than a new endpoint -- matches every other
  incremental widening this endpoint has already had (TASK-055/057, per
  the page's own existing comments).
- The new S/I/R badge component is `packages/ui`-level (not page-local),
  since both the results screen and (potentially, per §5 Q2) a future
  report-rendering surface could want it -- but only actually wired into
  the results screen in this pass.

## 6. Risks

- Resolving a coded value's display label generically (§5 Q1, if the
  broader option is chosen) touches a shared function
  (`formatObservationValue`) used by every discipline's report rendering
  -- a wrong resolution for an existing chemistry/hematology coded analyte
  would be a real regression on an already-shipped, presumably-reviewed
  report, not just a new capability. Mitigation: whichever scope is
  approved, re-run the full existing report e2e suite unmodified (matching
  `api-design` entry #2's own "before applying a filter globally" check)
  before merging.
- Widening the results-list response shape needs the OpenAPI/SDK
  regeneration step (established discipline this session, `api-design`
  entry #14) -- easy to forget, checked explicitly in §8.

## 7. Acceptance criteria

- A `coded` or `table` observation (organism ID, antibiogram) renders on
  the interactive results screen for its ordered test, with a legible
  display value (not a raw code), and remains verifiable through the
  existing `Verify` action.
- A Resistant (R) antibiogram result renders with a distinct,
  non-color-only treatment (letter/label, not color alone) on the results
  screen.
- The PDF report resolves Organism Identified's display name instead of
  its raw SNOMED code, scoped per whichever option §5 Q1 resolves to.
- No regression to any existing quantity/ordinal row's rendering or to any
  other discipline's existing report output.

## 8. Testing plan

- New `apps/api` e2e coverage: `GET /v1/ordered-tests/:id/results` returns
  the widened shape for a `coded` and a `table` observation with the
  expected resolved display label/structured antibiogram data.
- Re-run `apps/api/test/report-assembly` / culture-report e2e specs
  unmodified after the `formatObservationValue()` change (risk mitigation
  from §6).
- `web-verify` Skill pass (real dev server, not just typecheck/build):
  confirm the results screen actually renders a coded/table row and its
  Verify action end-to-end, and confirm the new badge component's
  contrast passes the existing Storybook a11y CI check (per
  `frontend-design` entry #2's own "check actual rendered contrast, don't
  eyeball the token" rule) before considering this done.
- Regenerate `apps/api/openapi.json` + `packages/sdk/src/schema.ts` and
  diff the changed route's shape (per `api-design` entry #14's own
  "don't just trust runtime validation, look at the generated contract"
  discipline).

## 9. Rollback plan

Purely additive (new response fields, new UI rows, new component) -- no
migration, no destructive schema change. Revert is a plain code revert;
no data cleanup needed.

## 10. Questions requiring human approval

Resolved 2026-08-21 -- user approved the proposal's own default lean on
all three:

**Q1 (resolved: narrow).** Fix only Organism Identified's display-label
resolution, reusing the exact existing `organism` <-> `code_system_value`
join `antibiogram-assembly.ts` already proves works. No other discipline's
coded analyte is touched by this pass -- their existing raw-code report
behavior is unchanged, not regressed and not improved.

**Q2 (resolved: keep the compact string).** The antibiogram continues to
render as the same compact summary string `formatObservationValue()`
already produces for the PDF (`"Escherichia coli — Ampicillin: R (MIC 16);
..."`), reused verbatim in the results screen's own `table` row. A real
per-antimicrobial mini-table/grid stays deferred, matching FEAT-054's own
prior "genuinely bigger, separate rendering-architecture change" call --
not revisited here.

**Q3 (resolved: display-only).** No data-entry control for Organism
Identified is added in this pass. It remains enterable only via the
existing generic `PUT .../results/:analyteId` API call; a UI entry path
for it (autocomplete against the `organism` catalog, or however it's
actually meant to be entered in practice) is explicit follow-up scope, not
part of #694.
