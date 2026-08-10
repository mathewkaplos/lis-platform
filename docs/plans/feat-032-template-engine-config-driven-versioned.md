# Implementation Proposal: FEAT-032 Template engine (config-driven, versioned)
Status: **IMPLEMENTED** — merged PR #447 (`6989007`), closing #41. §10's open questions resolved by
the human via the native options-prompt (2026-08-10), all four decided as the recommended option.
Full apps/api e2e suite (29 files / 304 tests) green against a freshly reset DB; repo-wide
typecheck/lint/build clean; golden-dataset check PASS; the two new tables show zero RLS leaks
(pre-existing failures on unrelated tables match already-filed issue #430, unaffected by this PR).
ADR-0032 (lis-engineering) records the three load-bearing decisions (versioning/lifecycle mirrors
`workflow_definition`, `evaluateCondition` reused verbatim across subsystems, snapshot-by-id not
by-value). `engineering/pdf-generation` Skill entry #7 and `engineering/workflow-engine` Skill
entry #11 capture the two real findings from implementation (pdfkit's `compress: true` default
breaking text-substring test assertions; `findUnallowedFields` widened to take a caller-supplied
allow-list).
ADR: none yet — this proposal's central mechanism decision (generalizing FEAT-016's rendering
pipeline + reusing ADR-0029's condition evaluator across subsystems) is real and load-bearing per
this issue's own "write one if a load-bearing decision is discovered during planning" instruction,
but every M6 feature this session wrote its ADR alongside implementation, once the decision was
actually proven, not at proposal-draft time — followed here too.
Date: 2026-08-10    Backlog ID: FEAT-032 (#41)

**§10 resolved 2026-08-10, all four questions decided as the recommended option:** Q1 (field-type
scope): 5 types only. Q2 (authoring interface): API/JSON only, no new `apps/web` screen. Q3
(versioning): plain incrementing integer. Q4 (legacy `report.templateVersionId`): left `NULL`. Every
§5 assumption already matched these — no changes needed to the design itself, only this record of
confirmation.

## 1. Goal

M6 ("Automate") has no independently-startable work left this session: FEAT-027 (#36) is blocked
on the design partner naming their instrument; FEAT-029 (#38) is deliberately left open only for
AC #2 (migrating existing hard-coded workflows onto the engine), a future feature's job, not
blocking. M7's own FEAT-032 (#41, EPIC-006) depends only on `FEAT-016` (Minimal report), fully
closed (M4, 18/18). No ADR blocks it either — its own "ADRs to reference" is explicitly empty.

FEAT-032's own two literal ACs:
- "A new test with its own report layout can be added via configuration without a software release"
- "Template versions are immutably snapshotted onto historical reports"

Its own "Architecture documents to reference" names only **KB-12 (Template Engine)** — not KB-13
(Report Designer). This is the single most load-bearing framing decision in this proposal.

**Real, load-bearing finding #1 — KB-12 describes a system materially larger than this issue's own
two ACs and its own referenced-docs list support; KB-13's visual designer is explicitly a separate
document this issue does not cite.** KB-12 itself scopes the designer UX out of its own document
("the visual drag-and-drop designer UX... see 13-report-designer.md"), and FEAT-032's issue body
cites only KB-12. Read plainly, alongside "Google Stitch prompts required: Not applicable — no new
UI, or composed entirely from existing `packages/ui` primitives" (a phrasing that *permits* reusing
existing primitives if some UI turns out to be needed, but does not itself call for a new
drag-and-drop canvas), this proposal reads FEAT-032 as building **the engine's runtime and data
model** — the versioned metadata tree, its lifecycle, publish-time validation, and rendering — not
KB-13's own authoring canvas. This is the same scope-narrowing discipline FEAT-016 already applied
to this exact same KB-12 document (its own finding #2, "config template" ≠ the full engine) and
FEAT-029 applied to KB-25 (engine mechanism only, zero real command handlers at first). A future
feature (unscheduled; not FEAT-035 "Admin catalog UI" by name, which is about catalog data, not
template authoring) is the natural owner of KB-13's own visual canvas once real usage pressure
exists for one.

**Real, load-bearing finding #2 — KB-13 states outright that the Logic DSL is "the same sandboxed
expression DSL used by the workflow and result engines," and this repo already built exactly that,
one week ago, for ADR-0029.** `apps/api/src/workflow/workflow-condition-evaluator.ts`'s
`evaluateCondition(node: ConditionNode, context: Record<string, unknown>): boolean` is a pure,
total function over a JSON tree (`{and|or|not}` over `{field, op, value}` leaves, `op` restricted
to `eq/neq/gt/gte/lt/lte/in/includes`) — no `eval`/`Function`, safe by construction, already proven
in production-shaped e2e tests for FEAT-029/030/031. KB-13's own text is not a coincidental
resemblance; it is this repo's own stated intent that these two subsystems share one expression
language. **This proposal reuses `evaluateCondition`/`ConditionNode` directly for any template
field's `visibilityCondition`, not a second evaluator** — only a new field allow-list is needed
(template-context fields, e.g. resolved analyte values/flags on the report being rendered, differ
from `ObservationVerified`'s own event-payload fields), mirroring `findUnallowedFields`'s own
publish-time-check shape, not its exact allow-list contents.

**Real, load-bearing finding #3 — FEAT-016's own already-shipped report pipeline is a single fixed,
hard-coded pdfkit layout with zero template metadata and zero versioning; AC #2 is not satisfiable
without changing already-shipped code.** `apps/api/src/report/report-render.ts`'s
`drawChemistryReport()` draws one literal layout via pdfkit's imperative API; `report.ts`'s `report`
table (TASK-059) has no `templateVersionId`-shaped column at all — there is nothing today for a
report to snapshot a template version *of*. FEAT-032 is therefore not purely additive: it must
generalize `report-render.ts` into a metadata-driven interpreter and add a new column to the
already-shipped `report` table, while preserving TASK-058's own hard-won determinism findings
(`PDFDocument`'s `info` must be pinned at construction, never after; hash the canonical input, not
PDF bytes — `engineering/pdf-generation` Skill entries #3/#6) and TASK-059's own snapshot-range
discipline (every analyte's range/flags come from the observation's own snapshotted columns, never
re-resolved — unaffected by this change, reused as-is).

**Real, load-bearing finding #4 — the five field types FEAT-016's own already-shipped chemistry
report actually needs generalized are a small, provable subset of KB-12's twelve; the other seven
have no consumer anywhere in this milestone's own scope.** KB-12 lists Rich text, Numeric, Coded/
select, Boolean, Calculated, Table, Image/attachment, Checklist, Drawing/annotation, Barcode/QR,
Reference-range display, Signature. `ChemistryReportInput`'s own already-shipped shape (patient/
specimen header, a per-analyte result table with flags and reference ranges, a verifier/status
block) exercises exactly five of these: **Numeric** (analyte-bound), **Coded/select**, **Rich
text**, **Table**, **Reference-range display**. Boolean and Calculated have no chemistry-report
consumer yet (chemistry results are typed `quantity`/`coded`, not `boolean`, and TASK-053's
calculated-field engine lives in the result-entry pipeline, not report rendering). Image/
attachment, Drawing/annotation, Checklist, and Signature are named by KB-12's own histology/
cytology examples (KB-17/18) — a different, later discipline, not this milestone's chemistry-
focused rollout. Barcode/QR has an existing, separate, already-shipped mechanism
(`bwip-js`, TASK-046) this proposal does not touch. Building any of the seven now would be the
same speculative-ahead-of-need risk FEAT-016's own §6 already flagged for itself.

**Real, load-bearing finding #5 — `workflow_definition`'s versioned `draft → in_review → published
→ archived` lifecycle (ADR-0029, migrated one week ago) is a proven, working precedent in this
exact codebase for "a tenant-scoped, versioned metadata row with a publish-time guardrail," and
generalizes cleanly to one more scoping column.** `workflow_definition` enforces "at most one
published row per tenant" via a partial unique index
(`ux_workflow_definition_tenant_published ... WHERE status = 'published'`) plus a `CHECK` on the
status vocabulary; a guardrail validator runs before any row may reach `published`, the only code
path that sets that status. This proposal reuses that exact shape for `report_template_version`,
scoped to "at most one published version per `(tenant, test_definition)`" — the same structural
pattern, one more index column, not a new design.

**Real, load-bearing finding #6 — KB-12 says versioning is semver; this repo's own only existing
versioned-metadata precedent (`workflow_definition.version`, ADR-0029) uses a plain incrementing
integer, with no breaking/non-breaking distinction enforced anywhere.** Matching KB-12's literal
"semver" text would introduce a new versioning convention this codebase has never used, for a
distinction (breaking vs. non-breaking template edits) nothing in FEAT-032's own two ACs actually
requires — AC #2 only needs "which exact version rendered this report," which an integer answers
identically to a semver string. Flagged in §10 rather than silently decided either way, since it's
a genuine deviation from KB-12's own text (`database-design` Skill entry #1's own rule: state
explicitly *why* an existing convention still applies here, don't just default to it).

## 2. Affected files

- `packages/db/src/schema/report-template.ts` (new) — `report_template` (one row per
  `(tenant, test_definition)` template *slot*) and `report_template_version` (the versioned
  metadata tree: `sections`/`fields` jsonb, `status`, `version`), both tenant-scoped, RLS-enabled,
  mirroring `workflow-definition.ts`'s exact structure (finding #5).
- `db/migrations/0031_report_template.sql` (new) — the two new tables.
- `db/migrations/0032_report_template_version_id.sql` (new) — `ALTER TABLE report ADD COLUMN
  template_version_id uuid REFERENCES report_template_version(id)`, nullable (§9).
- `packages/db/src/schema/report.ts` — add the new column + its FK.
- `packages/db/src/schema/index.ts` — export the two new tables.
- `apps/api/src/report-template/` (new module) — `report-template.controller.ts`
  (`POST/GET /v1/report-templates`, `POST /v1/report-templates/:id/versions`,
  `POST /v1/report-templates/:id/versions/:versionId/publish`, mirroring
  `workflow-definition.controller.ts`'s own route shape), `report-template.service.ts` (the
  publish-time analyte-binding guardrail, mirroring `workflow-definition.service.ts`'s own
  guardrail-before-publish shape), `report-template-types.ts` (the field/section JSON shape +
  `TEMPLATE_ALLOWED_FIELDS` for `visibilityCondition`, mirroring `workflow-types.ts`).
- `apps/api/src/report/report-render.ts` — `drawChemistryReport()` replaced by a generic
  interpreter (`renderTemplateReport(templateVersion, resolvedFields)`) walking the published
  version's `sections`/`fields` tree; `computeReportContentHash`'s canonicalize-then-SHA-256
  convention reused unmodified, now hashing `{templateVersionId, resolvedFields}` instead of the
  old fixed `ChemistryReportInput` shape.
- `apps/api/src/report/report-assembly.ts` — looks up the published `report_template_version` for
  the ordered test's own `testDefinitionId` before rendering (404/409 if none published), resolves
  each template field against the already-assembled analyte data (reusing this file's own existing
  analyte-resolution logic, now data-driven by the template's field list instead of a fixed
  hardcoded list), passes `templateVersionId` into the new `report` column.
- `db/seed/default-chemistry-report-template.sql` (new) — a published `report_template_version`
  reproducing `drawChemistryReport()`'s exact current layout, for every seeded chemistry
  `test_definition`, so FEAT-016's existing behavior/tests continue to pass with zero manual
  reconfiguration (§5 assumption).
- `scripts/db-reset.sh` **and** `.github/workflows/pr.yml` — both wired to the new seed file
  separately (`database-design` Skill entry #12's own "two files, same PR" rule).
- `apps/api/src/app.module.ts` — registers the new `ReportTemplateModule`.
- `openapi.json` / `packages/sdk/src/schema.ts` — regenerated for the new routes.

**Not affected:**
- `apps/web` — no new screen in this proposal's scope (finding #1; §10 Q2).
- `packages/db/src/audit.ts`'s `stableStringify` — reused as-is, no changes needed.
- `apps/api/src/workflow/workflow-condition-evaluator.ts` — reused unmodified (finding #2); this
  proposal adds a caller and a new allow-list, not a change to the evaluator itself.
- `apps/api/src/observation/`, `apps/api/src/reflex/`, `apps/api/src/auto-verify/` — no interaction;
  this proposal is entirely within the report-rendering path.

## 3. Architecture consulted

- **KB-12 Template Engine** — the field-type catalog (finding #4), the lifecycle
  (draft→in_review→published→archived, finding #5), the binding guardrail ("any field
  representing a measurable/codeable clinical datum must declare an analyte binding... the
  designer warns/blocks on unbound clinical fields" — read here as a *server-side, publish-time*
  guardrail since no designer UI exists in this proposal's scope), and the "one renderer... same
  metadata drives form + PDF" principle (this proposal builds only the PDF/report half; the
  entry-form half has no consumer yet since result entry is already built and out of scope here).
- **KB-13 Report Designer** — read specifically to confirm it is *not* cited by FEAT-032's own
  issue (finding #1), and for its own explicit DSL-reuse statement (finding #2).
- **KB-02 Domain Model** — "chemistry = per panel" (already-resolved reporting-unit question,
  reused unmodified from TASK-059's own reading); confirms `report_template` binds to
  `test_definition`, not `order` or `panel`.
- `docs/plans/feat-016-minimal-report.md` — TASK-058's determinism findings (reused, finding #3),
  TASK-059's snapshot-range discipline (reused unmodified), TASK-059's own finding #3 ("this repo
  deliberately does not yet build KB-02's own `Report` state machine") — still true here; this
  proposal adds template versioning, not a `report.status` lifecycle.
- `packages/db/src/schema/workflow-definition.ts` + ADR-0029 — the versioned-lifecycle/guardrail
  pattern reused directly (finding #5).
- `apps/api/src/workflow/workflow-condition-evaluator.ts` + `workflow-types.ts` — the DSL reused
  directly (finding #2).
- `engineering/pdf-generation` Skill — entries #3/#6 (canonical-input hashing, `PDFDocument` info
  pinned at construction) must both survive the fixed→generic rendering-path generalization.
- `engineering/database-design` Skill — entry #1 (state explicitly why an existing convention
  applies, applied to the integer-vs-semver deviation, finding #6), entry #5 (hand-written
  migration/snapshot reconciliation — not triggered here, both new migrations are plain
  `drizzle-kit generate` output), entry #12 (seed file wired into both `db-reset.sh` and
  `pr.yml`).
- `engineering/api-design` Skill — the existing route/capability/`ZodValidationPipe` conventions,
  applied to the new `report-template` controller.

## 4. Skills loaded

- `engineering/pdf-generation` — the determinism contract this task's generalized renderer must
  preserve exactly.
- `engineering/workflow-engine` — entry #1 (condition/action model lives in one jsonb column, not
  split across rule and catalog — the same shape reused for `report_template_version.sections`),
  entry #2 (fixed JSON tree, never a string DSL — reused verbatim), entry #7 (two different
  registries at two different layers — read for contrast, confirming this proposal introduces
  neither a new outbox-event consumer nor a new command handler, just a third consumer of the
  shared condition evaluator).
- `engineering/database-design` — entries #1, #5, #12 as cited in §3.
- `engineering/api-design` — route/param/capability conventions for the new controller.
- `engineering/testing` — real-Postgres integration discipline for the RLS/versioning/regression
  proofs this proposal's own §7/§8 require.

## 5. Assumptions & autonomous decisions

- **Scope narrowed to 5 field types**: Numeric (analyte-bound), Coded/select, Rich text, Table,
  Reference-range display (finding #4). Boolean, Calculated, Image/attachment, Checklist, Drawing/
  annotation, Barcode/QR, Signature are explicitly deferred, not built.
- **No visual designer/authoring UI** — templates are authored via `POST /v1/report-templates`
  JSON bodies, mirroring `workflow-definition.controller.ts`'s own route shape (finding #1; open
  for override at §10 Q2).
- **Conditional visibility only** from KB-12's "Logic" list — calculated fields and cross-field
  validation rules are out of scope (already implied by finding #4's field-type narrowing, since a
  calculated field is itself a deferred field type).
- **Integer `version`, not semver** (finding #6) — flagged at §10 Q1 for explicit override, not
  silently decided.
- **One published version per `(tenant, test_definition)`** — the natural generalization of
  `workflow_definition`'s own "per tenant" constraint (finding #5), matching KB-02's own
  chemistry-per-panel reporting unit (one test = one report = one template slot).
- **`report.templateVersionId` stores only the FK id, not a duplicated JSON snapshot** — because a
  published `report_template_version` row is itself architecturally immutable (never edited after
  publish, identical guarantee to `workflow_definition`), unlike `reference_range`, which genuinely
  *can* be edited in place after an observation was written (the actual reason `observation`
  snapshots range *values*, not just an id). Referencing by id already satisfies AC #2's literal
  "immutably snapshotted" without duplicating data that cannot drift.
- **A seeded default chemistry template reproduces `drawChemistryReport()`'s current output
  exactly**, published for every existing chemistry `test_definition` at migration time — this
  proposal replaces the rendering *mechanism*, not FEAT-016's already-verified output, so its own
  e2e suite continues to pass unmodified (§7).
- **`report.templateVersionId` is nullable** (§9) — any `report` row that predates this migration
  (a real possibility on a long-lived local/staging Postgres container per `database-design` Skill
  entry #11) has no template version to backfill honestly; fabricating one would misrepresent
  history. Every report generated *after* this feature ships always populates it. Flagged at §10 Q4
  for explicit override (backfill to the seeded default's version id instead).

## 6. Risks

- **Same over-scoping risk shape every prior feature this session named for itself**: "Template
  Engine" reads as calling for KB-12's entire described system. This proposal deliberately narrows
  to the two literal ACs plus what FEAT-016 already needs preserved — a reviewer should treat the
  KB-13 designer UI, semver, and the seven deferred field types as a deliberate, stated exclusion,
  not an oversight (findings #1/#4/#6).
- **Generalizing `report-render.ts`'s fixed layout into a metadata-driven interpreter is the single
  highest-risk piece of this task for silently reintroducing non-determinism** — a naive
  interpreter iterating a JS object's own keys (template JSON, or a resolved-fields map) in a
  different order across two renders of the *same logical input* could produce different bytes
  even with `stableStringify` reused correctly for hashing, if the *rendering* path (not just the
  *hashing* path) isn't equally order-independent. Needs an explicit same-input-twice byte-identity
  test against a real template-driven render (not just a rehash of the existing fixed-path test),
  per `engineering/pdf-generation` Skill entry #6's own empirical-verification discipline.
- **The publish-time analyte-binding guardrail is a real, load-bearing clinical-safety validation**
  (KB-12: "the guardrail that prevents the engine from recreating the incumbent's problem" of
  free-text results) — needs its own explicit rejection-path test, not just a happy-path publish
  test, mirroring ADR-0029's own guardrail-validator testing discipline.
- **Removing `drawChemistryReport()` requires confirming every existing caller is re-pointed, not
  assumed unaffected** — `database-design` Skill entry #4's "grep every caller before changing a
  shared function's contract" discipline, applied here to a function removal/signature change
  instead of an FK backfill; `report-render.spec.ts`'s own existing unit tests are the most likely
  place this bites first.
- **A second real transaction path (template lookup) added to `report-assembly.ts`'s already-large
  single-transaction assembly function** — worth a reviewer's attention for whether the template
  lookup belongs inside the same transaction as the rest of assembly (reading a `published`
  template version mid-assembly) or can safely be read outside it (published rows are immutable
  once set, so a stale read is not a correctness risk the way an uncommitted read would be) —
  this proposal defaults to reading it inside the same transaction, for simplicity and consistency
  with every other read in that function, not because a race was found requiring it.

## 7. Acceptance criteria

The issue's own two literal ACs, narrowed/proven per findings #1–#6:
- [ ] A new `report_template`/`report_template_version` can be authored and published for a
  `test_definition` via the API alone, with a genuinely different layout than the seeded default
  (e.g. a different field order, an added rich-text section), and a real report renders from it —
  zero code change or deploy required (AC #1, literal).
- [ ] Publishing a numeric/coded field with no `analyteBinding`, or one bound to an analyte not in
  the target `test_definition`'s own `test_analyte` set, is rejected at publish time (409/400),
  never silently accepted (finding #1's guardrail).
- [ ] A `report` row records the exact `report_template_version.id` used to render it; publishing a
  new version of the same template afterward does not change what an already-generated report
  references (AC #2, literal) — proven by generating a report, publishing a second version of the
  same template, then confirming the original report's own recorded `templateVersionId` is
  unchanged.
- [ ] Rendering the same `(templateVersionId, resolvedFields)` input twice produces byte-identical
  PDF output — the determinism discipline TASK-058 already proved for the fixed layout, now proven
  again through the generic interpreter (§6's own top risk).
- [ ] FEAT-016's own pre-existing e2e suite (report-render/report-assembly/report download) passes
  unmodified against the seeded default template — zero regression.
- [ ] At most one `published` `report_template_version` exists per `(tenant, test_definition)` at
  any time, enforced by a partial unique index, not just application logic.
- [ ] RLS isolation test for both `report_template` and `report_template_version`.

## 8. Testing plan

1. New unit tests for the generic interpreter: same template+data twice → identical hash/bytes;
   different data → different hash; a template exercising all 5 in-scope field types renders
   correctly; a `visibilityCondition` correctly hides/shows a field via `evaluateCondition` reuse
   (no new evaluator logic to test — only the new allow-list and the field-resolution wiring).
2. New e2e tests: publish-time binding guardrail (positive + rejection, per §6); one-published-
   version-per-`(tenant, test_definition)` constraint (rejection on a second concurrent publish
   attempt); a report generated against test_definition X after publishing a second, different-
   layout template on test_definition Y shows X's report unaffected; the immutable-snapshot proof
   named in §7; RLS isolation on both new tables.
3. Full pre-existing FEAT-016 e2e suite run unmodified against the seeded default template —
   regression proof (§7).
4. `pnpm --filter @lis/db typecheck`/migrate — both new migrations, against a freshly reset
   container per `database-design` Skill entry #11's own caution about a long-lived one.
5. Repo-wide `pnpm typecheck`/`pnpm lint`/`pnpm build`, including a real `nest build`.
6. `openapi.json`/`packages/sdk/src/schema.ts` regeneration for the new `report-template` routes.
7. Confirm the new seed file runs in **both** `scripts/db-reset.sh` and
   `.github/workflows/pr.yml` (`database-design` Skill entry #12) — check both files changed in the
   same PR, not just the one exercised by local verification.

## 9. Rollback plan

Additive under every resolution of §10: two new tenant-scoped tables with their own migration and
down-migration (verified against seeded data before merge, per this repo's standing Definition of
Done), one new nullable column on the already-shipped `report` table (§5), and a generalized
`report-render.ts` that — per the seeded-default-template assumption (§5) — produces byte-identical
output to the current fixed layout for every existing chemistry test. Reverting the PR restores the
prior fixed-layout file exactly; no data migration is needed on rollback since `report_template*`
rows are net-new and existing `report` rows' new column is nullable/simply unused by the reverted
code path.

## 10. Open questions — resolved 2026-08-10 via the native options-prompt

1. **Field-type scope for this first version.** **Resolved: Option A.**
   - **Option A (recommended): the 5 types named in finding #4** (Numeric, Coded/select, Rich text,
     Table, Reference-range display) — exactly what FEAT-016's own shipped report needs
     generalized, nothing speculative ahead of a real discipline's need.
   - **Option B: also include Boolean and Calculated now** — no chemistry-report consumer exists
     yet for either, but they're the two cheapest of the seven deferred types to add (no new
     rendering primitive, no object-storage/annotation-canvas work like the other five) if a near-
     term need is already anticipated.

2. **Authoring interface.** **Resolved: Option A.**
   - **Option A (recommended): API/JSON only** — `POST /v1/report-templates` + `.../versions` +
     `.../publish`, no new `apps/web` screen, mirroring FEAT-029's own "engine mechanism only, zero
     UI" precedent and KB-13's own designer being a separate, uncited document (finding #1).
   - **Option B: also build a minimal admin JSON-editor screen** in `apps/web`, composed from
     existing `packages/ui` primitives (permitted, not mandated, by the issue's own Google Stitch
     line) — not a KB-13 drag-and-drop canvas, just a raw-JSON textarea + publish button, enough
     for a real human to actually use this without `curl`.

3. **Versioning scheme.** **Resolved: Option A.**
   - **Option A (recommended): plain incrementing integer**, matching `workflow_definition.version`
     (finding #6) — no new versioning convention introduced, no breaking/non-breaking distinction
     this proposal's own ACs don't require.
   - **Option B: semver**, matching KB-12's own literal text — more expressive if a future need for
     breaking-vs-non-breaking template changes emerges, at the cost of a new convention this
     codebase has never used anywhere else.

4. **`report.templateVersionId` for reports generated before this feature ships.** **Resolved:
   Option A.**
   - **Option A (recommended): nullable, left `NULL`** — honest about what's actually known; no
     fabricated history (§5).
   - **Option B: backfill every existing `report` row to the seeded default template's version id**
     — every `report` row gets a real value, at the cost of asserting a specific template version
     "produced" reports that were actually rendered by the old fixed code path before that version
     row existed.
