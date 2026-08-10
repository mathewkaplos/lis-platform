# Implementation Proposal: FEAT-033 Cumulative & clinical reports
Status: **IMPLEMENTED** — merged PR #451 (`e6500f6`), closing #42. §10's open questions resolved by
the human via the native options-prompt (2026-08-10), all three decided as the recommended option
(purpose-built renderer, unaudited/unpersisted, generous ceiling only). Full apps/api e2e suite (31
files / 318 tests) green against a freshly reset DB; repo-wide typecheck/lint/build clean;
golden-dataset check PASS. A real 400-vs-404 gotcha was found and fixed during this task's own
e2e-test writing: Zod's `z.uuid()` rejects `99999999-...`-shaped placeholders (invalid RFC4122
version nibble) before a route handler ever runs, producing 400 instead of the 404 a
not-found-by-id test actually means to prove -- fixed by using a syntactically valid v4-shaped
placeholder instead.
ADR: none — both Q1 (purpose-built renderer vs. extending FEAT-032) and Q2 (unaudited, matching
`prior()`'s own precedent) resolved by applying an already-established pattern, not by creating a
new one; no load-bearing decision actually arose during implementation that ADR-0032's/ADR-0029's
own reasoning didn't already cover.
Date: 2026-08-10    Backlog ID: FEAT-033 (#42)

**§10 resolved 2026-08-10, all three questions decided as the recommended option:** Q1 (rendering
mechanism): a new, purpose-built renderer, not an extension of FEAT-032's `report_template_version`.
Q2 (audit/persistence): unaudited, not persisted. Q3 (result ceiling): a generous defensive ceiling
only, no pagination. Every §5 assumption already matched these — no changes needed to the design
itself, only this record of confirmation.

## 1. Goal

M7 now has two features shipped this session (FEAT-032 #41, FEAT-035 #44). FEAT-033's own one
dependency, `FEAT-032` (Template engine), is closed. FEAT-033's own literal AC: **"A cumulative
report correctly assembles multiple historical results for one patient/analyte."**

Its own "Architecture documents to reference" names **KB-13 (Report Designer)** — but KB-13 is
about the visual template-authoring canvas (FEAT-032's own already-deferred scope, proposal §10
Q2), not cumulative-report assembly logic. **The actually-relevant document is KB-43 (Operational
Reporting)**, which explicitly covers "cumulative patient reports" and is not named on the issue at
all. Read together with the issue's own real dependency (FEAT-032, not FEAT-034/"Operational
reports [TAT, workload]" — a separate feature with a separate dependency, FEAT-022), this confirms
FEAT-033's own real scope is KB-43's **cumulative/clinical** half only, not its operational half
(TAT, workload, rejection rates, QC pass rates — that is FEAT-034's own literal job, a different
issue, not touched here).

**Real, load-bearing finding #1 — this repo already has a proven, working precedent for exactly
this query shape, built eleven days before this feature's own kickoff and never generalized past a
3-row cap.** `GET /v1/ordered-tests/:id/results/:analyteId/prior` (TASK-057, FEAT-015) already
queries `observation` for "every prior, non-superseded result for this `(patientId, analyteId)`
pair, most recent first" — using `ix_obs_trend`, a composite index on exactly
`(tenant_id, patient_id, analyte_id, produced_at)` that `observation.ts`'s own header comment says
was "built for precisely this... read" before TASK-057 even needed it. It is capped at
`PRIOR_OBSERVATION_LIMIT = 3` and excludes the *current* ordered test's own result — both
deliberate, stated choices for its own narrow purpose (a verifier's quick recent-trend glance, not
a report). FEAT-033 does not invent a new query; it removes the 3-row cap and the current-test
exclusion for a real, unbounded (or generously bounded) patient/analyte history, reusing the same
index and the same snapshot-range discipline this route already established.

**Real, load-bearing finding #2 — KB-43 says cumulative reports should read from "replicas and the
warehouse, never loading the OLTP primary," but no replica or warehouse exists anywhere in this
repo.** Confirmed by grep: zero hits for `replica`, `warehouse`, `cdc` (case-insensitive) across
`apps/`, `packages/`, `infra/`, outside this KB doc itself. KB-44 (Analytics/warehouse) is
explicitly named as future scope ("Deep data science and the warehouse are 44-analytics.md"), and
that milestone (M9/M10) hasn't started. **This proposal reads directly against the OLTP primary**,
the same deliberate deviation from a KB's own target-state text every prior M6/M7 feature this
session has made when the described infrastructure doesn't exist yet (FEAT-016 vs. no PDF
pipeline; FEAT-026 vs. no queue) — a query against `ix_obs_trend` for one `(tenant, patient,
analyte)` tuple is a narrow, indexed read, not the kind of unbounded/scanning load KB-43's own
"never burden the transactional store" concern is actually protecting against. Revisit once a real
replica/warehouse exists and this report's own real traffic justifies moving it off the primary —
not before.

**Real, load-bearing finding #3 — reusing FEAT-032's own `report_template_version` mechanism for
this report is a poor structural fit, not a natural extension.** KB-43 says to "reuse the
template/PDF pipeline where a formatted document is needed" — true for the *rendering discipline*
(pdfkit conventions, `PDFDocument` info pinned at construction, canonical-input-hash determinism,
all from `engineering/pdf-generation` Skill), but `report_template`/`report_template_version`
(FEAT-032, ADR-0032) is bound 1:1 to a **`test_definition`** (one panel's own analyte set, one
snapshot in time). A cumulative report is bound to **one `(patient, analyte)` pair across many
different orders/dates** — a structurally different axis (rows = dates, not rows = analytes in one
panel). None of FEAT-032's own 5 field types (numeric/coded/richText/table/referenceRangeDisplay,
proposal finding #4) model a date-series row; `table`'s own `analyteBindings: string[]` names
*which analytes*, not *which historical observations of the same analyte*. Building a sixth field
type to force-fit this would be the same "the KB names something bigger than this feature's own
literal need" pattern this session has repeatedly declined (flagged at §10 Q1, not silently
decided, since it's a real, arguable design choice, not an obvious one).

**Real, load-bearing finding #4 — this is the first read in this repo scoped to a whole patient
across every one of their orders, not one `ordered_test`/`order`, and it needs its own route
shape.** Every existing report-adjacent route (`GET .../prior`, `POST .../report`) is scoped under
`/v1/ordered-tests/:id/...`. A cumulative report has no single `ordered_test_id` to hang off of by
definition — it spans many. The natural resource path is patient-centric:
`GET /v1/patients/:patientId/cumulative-report/:analyteId`, the first route in this repo shaped
this way.

## 2. Affected files

- `apps/api/src/report/report-assembly.ts` — `formatReferenceRangeText`/`formatDateTime`/
  `formatObservationValue` (currently private, TASK-058/059) exported for reuse here, rather than
  writing a third copy of the same formatting logic.
- `apps/api/src/report/cumulative-report-assembly.ts` (new) — `assembleCumulativeReport(tx,
  {tenantId, patientId, analyteId})`: queries every non-superseded `observation` row for that
  `(patientId, analyteId)` pair (no `ordered_test_id` exclusion, no 3-row cap — finding #1), joined
  against `analyte`/`unit`/`codeSystemValue` for display (mirroring `reference-range.controller.ts`'s
  own separate-queries-plus-maps shape) and `patient` for the header. Each row's own snapshotted
  `refLow`/`refHigh`/`refCondition` is used as-is (TASK-059's finding #1, unchanged), never
  re-resolved — the literal reason a 2-year-old value in this report still shows the range that was
  true when it was written.
- `apps/api/src/report/cumulative-report-render.ts` (new) — a purpose-built, fixed pdfkit layout (a
  date-ordered trend table: Date | Value | Unit | Flags | Reference range | Verified by), reusing
  `engineering/pdf-generation` Skill's determinism discipline verbatim (canonical-input hash via
  `stableStringify`, `PDFDocument`'s `info` pinned at construction) — **not** routed through
  FEAT-032's `renderTemplateReport`/`report_template_version` (finding #3).
- `apps/api/src/report/cumulative-report.controller.ts` (new) —
  `GET /v1/patients/:patientId/cumulative-report/:analyteId`, returns a `StreamableFile` PDF
  (mirroring `report.controller.ts`'s own `StreamableFile`-not-`@Res()` precedent — TASK-060's own
  real transaction-commit-ordering bug, not repeated here).
- `apps/api/src/report/cumulative-report.module.ts` (new) or folded into the existing
  `ReportModule` (implementation-time choice, not prescribed here — no new dependency either way).

**Not affected:**
- No migration — `ix_obs_trend`, `observation.patientId`, and every snapshot column already exist
  (TASK-038/049/050/057).
- `packages/db/src/schema/report.ts`/`report_template*` — untouched; this report's own provenance
  (if any, §10 Q2) does not reuse the `report` table, since that table's `orderedTestId` column is
  `NOT NULL` and structurally cannot represent a cross-order cumulative report.
- No new `apps/web` screen — "Google Stitch prompts required: Not applicable... or composed
  entirely from existing `packages/ui` primitives," read the same way this session already read
  identical wording for FEAT-032 (§10 Q2 there): API/PDF-only for this proposal's own scope.
- `apps/api/src/observation/observation.controller.ts`'s own `prior()` route — reused as a direct
  precedent, not modified; its own 3-row cap and current-test exclusion stay exactly as they are for
  its own real purpose (a verifier's inline glance), which this feature does not touch.

## 3. Architecture consulted

- **KB-43 Operational Reporting** — the actually-relevant document (finding #1's own framing);
  "cumulative/clinical reports are... a direct benefit of structured-first," "reuse the template/PDF
  pipeline" (read as rendering discipline, not the `report_template_version` data model — finding
  #3), and the replica/warehouse boundary (finding #2, deliberately deviated from for now).
- **KB-13 Report Designer** — read to confirm it is *not* actually the relevant document (finding
  #1's opening); its own visual-designer concern has no bearing on cumulative-report assembly.
- `apps/api/src/observation/observation.controller.ts`'s `prior()` (TASK-057) — the direct query
  precedent this proposal generalizes (finding #1).
- `docs/plans/feat-016-minimal-report.md`'s TASK-059 revision — the snapshot-range discipline
  (finding #1's own "never re-resolve" rule) reused verbatim; TASK-060's own `StreamableFile`
  transaction-ordering finding, reused for this proposal's own download route.
- `docs/plans/feat-032-template-engine-config-driven-versioned.md` — read in full to confirm
  finding #3's own structural-mismatch reasoning is real, not assumed; ADR-0032's own "snapshot by
  id, not by value" reasoning does not transfer here since this report has no single template
  version to snapshot in the first place.
- `engineering/pdf-generation` Skill — the determinism discipline reused for the new, purpose-built
  renderer (finding #3).
- `engineering/api-design` Skill — entry #6 (reads aren't audited by default — the default this
  proposal's own §10 Q2 weighs against `report.controller.ts`'s own audited-mutation precedent),
  entry #7 (RLS makes cross-tenant rows 404, not 403).

## 4. Skills loaded

- `engineering/pdf-generation` — the feature's own named Required Skill; determinism discipline
  reused for the new renderer.
- `engineering/api-design` — read-route conventions (entry #6), RLS-invisibility convention (entry
  #7), for the new patient-scoped route.
- `domain/reference-ranges` — the snapshot-vs-live-resolution discipline this report's entire
  correctness rests on (same as TASK-059's own reliance on it).
- `engineering/database-design` — checked for whether any new column/table/migration is needed;
  confirmed none is (finding #1's own "index already exists" framing) — the check itself is the
  point, not assumed.

## 5. Assumptions & autonomous decisions

- **Scope is one patient, one analyte per request** (the literal AC's own wording) — a
  multi-analyte cumulative panel (e.g. "this patient's full chemistry history across all analytes
  in one document") is a natural, real follow-on, not built here, matching FEAT-035's own "add,
  not edit" narrowing discipline applied to scope-breadth instead.
- **No result count cap** on the assembled history, beyond a generous defensive ceiling (matching
  `CATALOG_RESULT_LIMIT`'s own precedent, exact number an implementation-time detail, not elevated
  to §10) — unlike `/prior`'s own deliberate 3-row cap, this report's entire purpose is the full
  history, not a glance.
- **Rendering does not go through FEAT-032's `report_template_version`** (finding #3) — a
  purpose-built layout, reusing only the *discipline* (determinism, pdfkit conventions), not the
  data model. Flagged explicitly at §10 Q1 since it's a real, arguable choice, not a foreclosed one.
- **Reads directly against the OLTP primary** (finding #2) — a deliberate, stated deviation from
  KB-43's own replica/warehouse text, matching this session's own repeated "build against what
  exists, not the target-state doc" discipline, revisited once real infrastructure and real traffic
  justify it.

## 6. Risks

- **Finding #3's own "own renderer, not FEAT-032's template engine" choice is the central risk of
  this proposal** — a reviewer could reasonably prefer extending FEAT-032's own field-type catalog
  with a sixth "trend table" type instead, for one-mechanism consistency across every report this
  repo generates. This proposal's own reasoning (structural axis mismatch: dates vs. analytes) is
  stated plainly at finding #3/§10 Q1 for exactly this reason — not a hedge, a real fork worth a
  second opinion before implementation begins.
- **An unbounded (or generously bounded) history query against `ix_obs_trend` is this repo's first
  read with no natural small cap** (contrast `/prior`'s own deliberate 3, `PRIOR_OBSERVATION_LIMIT`)
  — a patient with years of frequent testing for one analyte could return a genuinely large row set.
  The index keeps the query itself cheap, but the PDF-rendering step (one table row per result) has
  no tested upper bound yet; worth an explicit large-N test (§8), not just a small fixture.
- **Whether this report's generation is audited/persisted (§10 Q2) is a real compliance-adjacent
  question, not a purely technical one** — `report.controller.ts`'s own official patient report
  audits every generation (Constitution Law #5); `/prior` (this proposal's own closest precedent)
  audits nothing, since it's read-only convenience context. A cumulative report sits genuinely
  between those two precedents — it's a real, downloadable, potentially-PHI-exporting document, but
  it isn't *the* official verified report. Decided at §10 Q2, not silently defaulted.

## 7. Acceptance criteria

The issue's own literal AC, narrowed/proven per findings #1–#4:
- [ ] A cumulative report assembled for a real `(patient, analyte)` pair with N historical,
  verified results across N different orders includes all N, in chronological order, each with its
  own snapshotted reference range (not the current live range) — proven by editing the underlying
  `reference_range` row after the fact and confirming the report is unaffected (the same literal
  proof TASK-059's own e2e test already established for the single-order case, extended here to a
  real multi-order history).
- [ ] A patient/analyte pair with zero historical results returns a real, distinguishable empty
  state (not a 500, not a report with a blank table pretending data exists).
- [ ] Rendering the same assembled history twice produces byte-identical PDF output (the same
  determinism proof every prior PDF-rendering feature in this repo has required).
- [ ] RLS: a cross-tenant request for another tenant's patient returns 404 (not 403 — `engineering/
  api-design` entry #7), proven by a real e2e request, not just asserted from RLS being present.
- [ ] Superseded/corrected observations are excluded — only the current, non-superseded version of
  each historical result appears (matching every other read in this schema's own "current only"
  filter).

## 8. Testing plan

1. New unit tests for the renderer: same input rendered twice → identical hash/bytes (determinism);
   different input → different hash (differential proof); a large synthetic N (e.g. 50+ rows) still
   renders correctly, addressing §6's own unbounded-history risk directly, not just a 2-3-row
   fixture.
2. New e2e tests: the snapshot-range-survives-a-later-edit proof (§7, extended to multi-order);
   empty-history real-empty-state proof; superseded-observation exclusion; RLS 404 for a
   cross-tenant patient id.
3. Repo-wide `pnpm typecheck`/`pnpm lint`/`pnpm build`, including `nest build`.
4. `openapi.json`/`packages/sdk/src/schema.ts` regeneration is a deliberate no-op for the PDF route
   (matching `report.controller.ts`'s own precedent, `engineering/api-design`-adjacent finding #2 in
   FEAT-016's own proposal) — a normal check only if the shape changes for any other route
   incidentally (not expected).

## 9. Rollback plan

Fully additive: three new backend files (assembly service, renderer, controller), zero migration,
zero modification to any existing route/table/screen except exporting three already-private helper
functions from `report-assembly.ts` (a pure visibility change, no behavior change — the existing
`renderChemistryReport`/`assembleAndPersistReport` callers are unaffected). Reverting the PR removes
the entire feature cleanly.

## 10. Open questions — resolved 2026-08-10 via the native options-prompt

1. **Rendering mechanism.** **Resolved: Option A.**
   - **Option A (recommended): a new, purpose-built renderer**, reusing only the PDF-generation
     *discipline* (determinism, pdfkit conventions) from `engineering/pdf-generation` Skill, not
     FEAT-032's `report_template_version` data model (finding #3) — the structurally cleaner fit for
     a date-series axis FEAT-032's own field-type catalog doesn't model.
   - **Option B: extend FEAT-032's field-type catalog with a sixth "trend table" type**, so every
     report this repo generates goes through one mechanism — more consistent long-term, at the cost
     of reopening FEAT-032's own recently-approved, recently-shipped field-type scope for a shape
     (a cross-order date series) it was never designed around, and a real risk of forcing an
     awkward fit rather than a clean one.

2. **Audit/persistence.** **Resolved: Option A.**
   - **Option A (recommended): unaudited, not persisted** — matches `GET .../prior`'s own closest
     precedent (read-only convenience/clinical context, not the official verified report); no new
     `report`-shaped row, no `@Audit()`.
   - **Option B: audited and persisted**, mirroring `report.controller.ts`'s own official-report
     precedent (Constitution Law #5's own "every clinically significant action") — treats generating
     a cumulative report as significant enough to leave a compliance trail, at the cost of a new
     table shape (this report has no single `ordered_test_id` to key a `report`-table-style row on,
     per finding #4 — a real, undesigned schema question if this option is chosen).

3. **Result count ceiling.** **Resolved: Option A.**
   - **Option A (recommended): a generous defensive ceiling only** (e.g. 500, matching
     `CATALOG_RESULT_LIMIT`'s own precedent) — the report's entire purpose is the full history, a
     small UI-glance-shaped cap like `/prior`'s own 3 would defeat it.
   - **Option B: a smaller, explicit cap with pagination** — safer against a pathological
     high-frequency-testing patient, at the cost of a pagination mechanism this repo's own
     `engineering/api-design` Skill entry #4 has so far deferred building anywhere ("until a real
     endpoint's failure mode needs one") — this may be that endpoint, or may not be; not assumed
     either way.
