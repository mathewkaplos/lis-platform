# Implementation Proposal: FEAT-016 Minimal report

Status: **APPROVED** (2026-08-06) — §10's open questions resolved by the human as follows:
Q1: **pure-JS PDF construction**, not headless-Chromium — avoids a new native/Chromium
production-dependency class this repo has zero prior experience operating, matching the `bwip-js`
"avoid native dependencies" precedent (TASK-046). Specifically `pdfkit` (not
`@react-pdf/renderer`) — `apps/api` is a NestJS/Fastify backend with no React rendering
infrastructure; introducing React into the backend solely for PDF layout would be a new,
unjustified dependency class of its own. Q2: **hash the canonical HTML/intermediate
representation**, not final PDF bytes — deterministic by construction, reuses the existing
`stableStringify`-then-SHA-256 convention from the FEAT-009 audit hash chain
(`packages/db/src/audit.ts`). Q3: **defer persistence to TASK-059** — TASK-058 returns the hash
from its rendering function/response only, no new table; stays additive-only with zero schema
footprint, matching FEAT-015's own no-migration precedent. Q4: **confirmed — mechanism-only
against placeholder/sample data**, real `observation`/`patient` data wiring is explicitly TASK-059's
own scope.
Date: 2026-08-06    Backlog ID: FEAT-016 (#25) / TASK-058 (#117)

## 1. Goal

FEAT-015 (Verification & criticals, #24) is fully merged — all four tasks closed, its proposal
archived `FULLY IMPLEMENTED`. FEAT-016 (Minimal report, #25, M4, EPIC-004) is next, its stated
dependency (FEAT-015) satisfied. FEAT-016 names three tasks (TASK-058 rendering pipeline, TASK-059
report data assembly, TASK-060 report viewer). **This proposal's approvable scope is TASK-058
only** — the same scope-narrowing precedent every prior feature in this repo has used (FEAT-011's
four revisions, FEAT-012's three, FEAT-013's four, FEAT-014's five, FEAT-015's four). TASK-059/060
will be specified as revisions to this same file once TASK-058's real output exists.

TASK-058's own issue text (#117): "Config template → HTML → PDF (hash-stamped)." Its one
dependency, TASK-055 (verification action + append-only versioning), is merged. Its one AC:
"Output is deterministic and the content hash is recorded with the report." Its "Expected output":
"PDF rendering pipeline."

**Real, load-bearing finding #1 — TASK-058 is scoped to the rendering *mechanism* only; it is
explicitly not responsible for querying or assembling real clinical data.** TASK-059's own issue
text (#118) states its "Expected output" as "Report assembly service" with AC "A 2-year-old result
renders using its originally snapshotted range, not the current one" — the *data-assembly* concern,
depending on TASK-058 rather than the reverse. Read side by side, the division is clean and
explicit, not inferred: TASK-058 = "PDF rendering pipeline," TASK-059 = "Report assembly service."
This proposal therefore treats TASK-058 as building the template → HTML → PDF mechanism and its
hash-stamping, exercised against a reasonable placeholder/sample chemistry-report data shape (a
patient/specimen header, a per-analyte result table with flags and reference ranges, a
verifier/status block — the same shape `12-template-engine.md`'s CBC example and this repo's own
already-shipped `ObservationResult`/`PriorObservation` DTOs describe), not against real
`observation`/`patient` queries. TASK-059 is the explicit, later owner of wiring that mechanism to
real data and to snapshotted ranges. This is checked as a real finding, not assumed: no boundary
case was found where TASK-058's own AC ("output is deterministic and the content hash is recorded")
requires real data to prove — determinism and hash-recording are properties of the rendering
pipeline itself, provable with any fixed input, real or placeholder.

**Real, load-bearing finding #2 — "config template" is not FEAT-032's own general-purpose template
engine, and building that engine now would be materially out of scope.** FEAT-016's own "Architecture
documents to reference" names KB-12 (Template Engine) and KB-13 (Report Designer). KB-12 itself
describes a full metadata-driven engine — a versioned tree of typed field definitions, a
sandboxed logic DSL, a visual designer, draft/review/publish/archive lifecycle, arbitrary
analyte-bound fields for any discipline — and explicitly says "the alternative — engineers writing
each template — is exactly the bottleneck we are eliminating." That full engine is
`github/issues/features/FEAT-032-*.md` ("Template engine (config-driven, versioned)"), M7,
`status: Not Started`, depending on FEAT-016 (not the reverse) — a separate, much later feature no
task in this milestone is scoped to build. Grepping `packages/`, `apps/api/`, `db/` for "template"
confirms this repo has zero existing config-driven template mechanism today. This means TASK-058's
own "config template" is read the same narrower way TASK-053 read "calculated fields" against
KB-20's full metadata-formula engine (docs/plans/feat-014-result-entry-engine.md's TASK-053
revision): a small, hard-coded-but-parameterized HTML template for a chemistry result report
specifically (one template, real Handlebars-/template-literal-style value interpolation into a
fixed HTML layout), not a stored, versioned, tenant-authorable template *definition* row, a designer
UI, or a DSL. No ADR or KB entry authorizes building FEAT-032's own engine inside this task, and
FEAT-032's own dependency direction (depends on FEAT-016, not vice versa) confirms this repo's own
plan already expects FEAT-016 to ship first, with something narrower.

**Real, load-bearing finding #3 — no PDF-generation code, dependency, or precedent exists anywhere
in this repo; this is a first-of-its-kind pipeline.** Confirmed by grep: zero hits for `pdf`,
`puppeteer`, `playwright`, `pdfkit`, `wkhtmltopdf`, or `@react-pdf` anywhere under `packages/`,
`apps/api/`, `apps/web/` source, or `pnpm-lock.yaml`, outside of unrelated dev/test tooling
(`packages/ui`'s Storybook test runner, `apps/web`'s label print button, which uses the browser's
own `window.print()`, not a PDF library — see `barcode-printing` Skill entry #4). `apps/api`'s only
production dependencies today are NestJS/Fastify/Drizzle/Zod/`bwip-js`/`jose` — no HTML-rendering or
document-generation library of any kind. The new `engineering/pdf-generation` Skill (drafted this
session, committed to `lis-engineering`) captures the real tradeoffs found researching this gap
(§10 Q1 below).

**Real, load-bearing finding #4 — hashing an artifact has one existing precedent in this repo
(the FEAT-009 audit hash chain), but it does not resolve the harder PDF-specific problem.**
`packages/db/src/audit.ts`'s `writeAuditEvent`/`verifyAuditChain` already establish a real, working
convention: `stableStringify()` (recursive key-sorted canonical JSON, chosen specifically because
Postgres jsonb doesn't preserve key order) fed into `crypto.createHash('sha256')`, chained via
`sha256(canonical || prevHash)`. That convention answers "how does this repo canonicalize-then-hash
a structured record" cleanly, and is directly reusable for hashing a report's canonical
input/intermediate representation. It does **not**, on its own, resolve whether TASK-058 should
hash the canonical HTML (or another intermediate representation) or the final PDF bytes — a
question specific to PDF generation's own non-determinism, which the audit chain (which hashes
JSON, not a rendered binary artifact) has never had to face. This is investigated directly in the
new `engineering/pdf-generation` Skill (entry #3) and left as an open question (§10 Q2), not
resolved by analogy alone.

**Real, load-bearing finding #5 — no `report`-shaped table exists anywhere in this schema, but one
has already been anticipated.** `packages/db/src/schema/` currently has `audit.ts`, `catalog.ts`,
`observation.ts`, `order.ts`, `patient.ts`, `patient-alert.ts`, `reference-range.ts`,
`result-history.ts`, `specimen.ts`, `test-catalog.ts` — no `report` table. Notably,
`packages/db/src/schema/audit.ts`'s own header comment, written during FEAT-009 (long before
FEAT-016 existed), already names "report" as an anticipated future `resourceType`/table: "the
audited resource can be any of many tables (observation, **report**, specimen, ...)." Whether
TASK-058 is the task that actually creates that table — versus TASK-058 recording the hash
somewhere else (e.g. returning it in an API response with no persistence yet) and TASK-059
(explicitly "Report data assembly," the more natural owner of a `report` row's real content) adding
the table — is a genuine, undecided question (§10 Q3), not assumed either way.

## 2. Affected files

Scoped to TASK-058 only, per finding #1's mechanism-only boundary. Exact files depend on §10's
resolutions (PDF library choice, hash target, persistence location) and are not fully prescribable
before those are answered — the list below states what is affected under any resolution, and what
depends on which option is chosen.

**Affected under any resolution:**
- `engineering/pdf-generation` Skill (new, already drafted and pushed this session, per §4) —
  loaded by whoever implements TASK-058.
- A new report-template rendering module in `apps/api` (exact location TBD at implementation —
  likely `apps/api/src/report/` mirroring this repo's existing per-domain module layout, e.g.
  `apps/api/src/observation/`), containing: the fixed chemistry-report HTML template (finding #2),
  the render-to-PDF call, and the content-hashing step.
- A new API route rendering a PDF from placeholder/sample input (finding #1) — exact shape (a
  synchronous `POST`/`GET` returning bytes, vs. an internal service method with no route yet) is an
  implementation-time decision, not prescribed here, since TASK-060 (report viewer) is the task
  that actually needs a public download route; TASK-058 may only need an internal, testable
  function.
- `apps/api/package.json` — a new production dependency for whichever PDF-generation approach §10
  Q1 resolves to.

**Affected only if a headless-Chromium approach (Puppeteer/Playwright) is chosen (§10 Q1):**
- `apps/api/Dockerfile` — currently a bare `node:22-slim` image with zero `apt-get` steps; would
  need new `apt-get install` steps for Chromium's runtime shared libraries (at minimum the class
  this session's own `web-verify` Skill already had to work around in the dev sandbox —
  `libnss3`/`libnspr4`/`libasound2t64`, though the exact list can drift with the pinned Chromium
  revision), a genuinely new class of OS-level dependency for this repo's production image
  (`engineering/pdf-generation` Skill entry #2).

**Affected only if a new `report` table is created in this task (§10 Q3, Option A):**
- A new migration under `db/migrations/` and a new `packages/db/src/schema/report.ts` (tenant-scoped,
  RLS-enabled, following the exact pattern every existing table in this schema already uses).

**Not affected under any reading:**
- `apps/api/src/observation/observation.controller.ts` — TASK-058 does not query real observations
  (finding #1); its `list()`/`prior()` routes are read-only reference points for what TASK-059 will
  later assemble from, not something TASK-058 itself calls.
- Anything implementing FEAT-032's own template-definition storage, designer UI, or logic DSL
  (finding #2) — explicitly out of scope.
- `apps/web` — FEAT-016's "Google Stitch prompts required" names §18.1 Report Viewer, which is
  TASK-060's own scope, not TASK-058's; TASK-058 is a backend-only rendering mechanism.

## 3. Architecture consulted

- KB-12 Template Engine — confirms the full config-driven engine (versioned metadata tree, DSL,
  designer) is a much larger scope than TASK-058's own AC asks for (finding #2); also states the
  target-state rendering model directly relevant to TASK-058: "the same template + resolved
  Observations render to HTML → PDF (server-side)... Rendering is deterministic and reproducible
  from `(templateVersionId, observationSet)`" — the literal source of TASK-058's "deterministic"
  AC language, read here as "deterministic given fixed input," not yet requiring the
  `templateVersionId` snapshotting machinery itself (that's FEAT-032's job).
- KB-13 Report Designer — out of scope by KB-12's own explicit statement ("the visual drag-and-drop
  designer UX... see 13-report-designer.md"); confirms the designer UI is a separate, later concern
  from the rendering mechanism this task builds.
- KB-11 Audit Logging (via `packages/db/src/audit.ts`) — this repo's one existing precedent for
  canonicalize-then-SHA-256 content hashing (finding #4); directly informs, but does not fully
  resolve, §10 Q2.
- `43-reporting.md` (Operational Reporting) — explicitly separates the patient-facing result report
  (this feature) from operational/warehouse reporting, and states operational reporting should
  "reuse the template/PDF pipeline where a formatted document is needed" — confirming this task's
  pipeline is intended as reusable infrastructure beyond just FEAT-016, a reason to keep its
  interface (input shape in, PDF+hash out) clean even though only one caller exists yet.
- `barcode-printing` Skill (TASK-046) — the closest existing precedent for "render a deterministic
  artifact server-side," and the direct source of the "avoid native/build-step dependencies"
  precedent (`bwip-js`) weighed, but not assumed to transfer unmodified, against this task's own
  larger HTML/CSS layout needs (`engineering/pdf-generation` Skill entry #1).
- `.claude/skills/web-verify/SKILL.md` — this sandbox's own real, already-hit Chromium
  `libnss3.so` failure and root-free workaround; directly informs the production-Dockerfile risk
  named in finding #3/§2.
- Puppeteer's `PDFOptions` docs and PDFKit's document-metadata docs (Context7, queried live
  2026-08-06, not assumed from training data) — confirm neither library documents a
  guaranteed-deterministic PDF-byte output path by default (`engineering/pdf-generation` Skill
  entry #3).

## 4. Skills loaded

- `engineering/pdf-generation` (new, drafted and pushed this session as part of this proposal) —
  the primary Skill for TASK-058; entries #1–#4 are the direct source of findings #2–#5 above.
- `barcode-printing` (existing) — entry #1 (native-dependency avoidance precedent), entry #4 (no
  PDF/printer-SDK built for the label pipeline, by design, at that task's own scope) — read as
  context for how this repo has handled the closest prior "deterministic artifact" problem, not as
  a foreclosing precedent for this task's different tradeoff.
- `engineering/testing` — entry #1 (real-Postgres integration checks are `tsx` scripts, not
  Vitest) is not directly load-bearing here (TASK-058's own tests need no real Postgres data per
  finding #1), but is checked to confirm this task's own testing plan (§8) doesn't need to invent a
  new test-runner convention.
- `engineering/api-design` — entry #6 (unmutating reads aren't audited), entry #7 (RLS makes
  cross-tenant rows invisible), entry #8 (explicit `ZodValidationPipe` instantiation) — checked for
  whether TASK-058 needs a public route at all (finding #1's "may only need an internal function"
  framing) and, if so, to build it consistently with every other route in this repo.

## 5. Assumptions & autonomous decisions

- **TASK-058 renders against a placeholder/sample chemistry-report data shape, not real
  `observation`/`patient` queries** (finding #1). The exact placeholder shape is not prescribed
  here beyond "a patient/specimen header, a per-analyte result table with flags and reference
  ranges, a verifier/status block" (matching `12-template-engine.md`'s CBC example and this repo's
  own already-shipped `ObservationResult` DTO fields) — the concrete TypeScript shape is an
  implementation-time decision, since it is disposable scaffolding TASK-059 will replace with real
  assembled data, not a contract TASK-059 must conform to exactly.
- **"Config template" means one fixed, parameterized HTML template for a chemistry result report,
  not a stored/versioned/tenant-authorable template definition** (finding #2). No template
  designer UI, DSL, or `TemplateVersion` table is proposed.
- **No new capability or authorization check is proposed for TASK-058 itself.** If a route is added
  at all (§2), it renders from data already reachable under existing capabilities; TASK-058
  introduces no new class of actor or HTTP surface beyond what's needed to exercise the rendering
  mechanism.
- **The PDF-library choice, the hash target (canonical HTML vs. final PDF bytes), the hash
  algorithm/convention, and where the hash is persisted are all explicitly left undecided in this
  document** (§10) — this task's own framing is proposal-drafting, not implementation; no default
  or "recommended-and-silently-chosen" option is picked here for any of them, matching this
  repo's own established §10 convention (FEAT-014/015's own unresolved-until-human-decides
  questions).

## 6. Risks

- **The central risk is the same shape as FEAT-015/TASK-054's own: a title that names something
  bigger than this task's own AC and dependency actually support.** "Config template" and "Template
  Engine" (KB-12) read, on a shallow pass, as calling for FEAT-032's own general-purpose engine
  (finding #2) — implementing that now would be real, unapproved, speculative architecture months
  ahead of its own scoped milestone (M7). This proposal deliberately narrows to a fixed template,
  the same discipline TASK-053 already applied to "calculated fields" against KB-20's full engine.
- **A headless-Chromium approach, if chosen, introduces a genuinely new production-environment
  risk class this repo has zero prior experience operating** — not a reason to reject it outright
  (§1/§2 name the fidelity benefit), but a real cost that has already bitten this exact class of
  tooling once in this project's own sandbox (`web-verify` Skill's `libnss3.so` failure). Worth a
  reviewer's explicit attention if this is the path chosen, including verifying the *actual*
  production Docker image (not just a local run) the same way `docker-pnpm-monorepo-deploy` Skill's
  own entries #23–#24 and AGENTS.md finding (5)/(6) already learned the hard way for this repo's
  other native-dependency and Docker-build gaps.
- **PDF non-determinism is a real, not hypothetical, risk to the literal AC** — "the same input
  produces the same PDF bytes" is not guaranteed by either candidate library's own documented
  behavior (finding #4, `engineering/pdf-generation` Skill entry #3). If the final-PDF-bytes hash
  option is chosen without independently verifying two-runs-same-input byte-identity first, the
  AC could quietly fail in a way no amount of code review alone would catch — this specifically
  needs a same-input-twice test (§8), not just a single-run smoke test.
- **A new tenant-scoped table, if added in this task (§10 Q3, Option A), is the first schema change
  in this feature area since FEAT-015's own no-migration precedent** — worth flagging since every
  FEAT-015 task explicitly needed none; a real migration reintroduces the RLS/append-only review
  burden §7/Definition-of-Done already names for "any new tenant-scoped table."

## 7. Acceptance criteria

TASK-058's literal AC, narrowed per findings #1–#5:
- [ ] A fixed chemistry-report HTML template renders from a placeholder/sample data shape (finding
  #1) — not real `observation`/`patient` queries — via whichever PDF-generation approach §10 Q1
  resolves to.
- [ ] Rendering the same input twice produces byte-identical output for whatever artifact is
  actually hashed (§10 Q2's resolution) — proven by a real same-input-twice test, not assumed from
  library documentation (risk in §6).
- [ ] Rendering two different inputs produces different hashes — proven by a real
  differential test, mirroring `barcode-printing` Skill entry #2's own "assert outputs differ for
  different inputs, identical for the same input" pattern, adapted from SVG to PDF/HTML.
- [ ] The content hash is computed using this repo's existing SHA-256 canonicalize-then-hash
  convention (`packages/db/src/audit.ts`'s `stableStringify` shape) unless §10 Q2 resolves to a
  different, explicitly justified algorithm.
- [ ] The hash is recorded somewhere real per §10 Q3's resolution (a new table/column, or returned
  from the rendering function for TASK-059 to persist) — not silently dropped.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build — only if §10 Q3 resolves to a new table/migration in
   this task; otherwise a no-op regression check.
2. New unit/e2e test(s) for the rendering module: same input rendered twice produces an
   identical hash (determinism); two different inputs produce different hashes (differential
   proof) — the two concrete, literal-AC-proving cases named in §7.
3. If a headless-Chromium approach is chosen: an explicit test verifying the *actual* rendering
   path runs inside this repo's real target environment shape, not just a local dev machine that
   may have leftover cached Chromium/host libraries the production image won't have — mirroring
   AGENTS.md's own repeated finding (5)/(6) that a local build/run can false-pass while the real
   Docker image fails. A `docker build`/`docker run` of the real `apps/api` image (not just
   `pnpm test`) is the only way to actually prove this.
4. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive-only under every resolution of §10: a new rendering module/dependency, and (only if Q3
resolves to Option A) one new tenant-scoped table with its own migration. No existing route,
table, or UI screen is modified by this task, and no other feature or shipped screen depends on
this task's output yet (TASK-059/060 are FEAT-016's own next tasks, not yet started). Rollback is
reverting the PR and, if a migration was added, running its down migration on seeded data before
merge is verified as part of §8's testing plan regardless.

## 10. Open questions — resolved 2026-08-06 via the native options-prompt

1. **PDF generation approach/library.** **Resolved: pure-JS PDF construction, specifically
   `pdfkit`** (not `@react-pdf/renderer` — `apps/api` has no React rendering infrastructure and
   introducing one solely for this would be its own new, unjustified dependency class). Avoids the
   new native/Chromium production-dependency class headless-Chromium would introduce, matching the
   `bwip-js` "avoid native dependencies" precedent. Accepted tradeoff: no real HTML/CSS rendering —
   `pdfkit`'s imperative drawing API is used directly for the report's layout.
2. **The determinism strategy and hash convention.** **Resolved: hash the canonical HTML/
   intermediate representation**, not final PDF bytes — deterministic by construction, reuses this
   repo's existing `stableStringify`-then-SHA-256 convention (`packages/db/src/audit.ts`, FEAT-009)
   rather than inventing a new one.
3. **Where the hash gets recorded/persisted.** **Resolved: Option B** — TASK-058 returns the hash
   from its rendering function/API response only; no new table. Persistence is TASK-059's own scope
   ("Report data assembly," the more natural owner of a real `report` row).
4. **TASK-058's own scope boundary.** **Confirmed: mechanism-only against placeholder/sample data.**
   Real `observation`/`patient` data wiring remains explicitly TASK-059's job.

---

# Revision: TASK-059 — Report data assembly with snapshotted ranges

Status: **IMPLEMENTED** — merged PR #334 (`ccc83d7`), closing #118. §10's open questions resolved
by the human as follows:
Q1: **Option A** — new `report` table storing hash + provenance metadata only (no PDF bytes).
Q2: **Option A** — no new HTTP route in this task; service-only, TASK-060 owns the public route.
Q3: **Option A** — 409 Conflict on assembly against a partially-verified panel.
Date: 2026-08-07    Backlog ID: FEAT-016 (#25) / TASK-059 (#118)

## 1. Goal

TASK-058 is merged (`8c339fa`, PR #333) — the rendering mechanism (`renderChemistryReport`,
`apps/api/src/report/report-render.ts`) exists and is proven deterministic against placeholder
input. TASK-059's own issue text (#118): "Expected output: Report assembly service." Its one AC:
"A 2-year-old result renders using its originally snapshotted range, not the current one." Its one
dependency, TASK-058, is satisfied.

**Real, load-bearing finding #1 — the literal AC is already provable from columns that exist
today, with zero new range-resolution logic.** `observation.refLow`/`refHigh`/`refCondition`/
`refSource` (TASK-049/050, `packages/db/src/schema/observation.ts`) are snapshotted once at
write time and never recomputed — the assembly service's entire job for range correctness is to
read these columns directly off each included `observation` row and never call
`resolveObservationRange`/query `reference_range` again. A `reference_range` row can be superseded
or edited years after the observation that used it was written; the observation's own snapshot
columns are unaffected by that, by construction. This is the same "snapshot, never recompute" rule
already enforced for TASK-051's writes — TASK-059 is the first *reader* required to prove it holds
on the read side too.

**Real, load-bearing finding #2 — the reporting unit for chemistry is already answered by KB-02's
own open question, not a fresh design decision.** `02-domain-model.md`'s "Open questions" section
asks explicitly: "Is the reporting unit best keyed per-OrderedTest or per-accession by default?
(Likely configurable per discipline; **histology = per case, chemistry = per panel**.)" A chemistry
panel *is* one `OrderedTest` (one `test_definition`, e.g. `LIPID`, `CMP`) in this schema — this
proposal reads that KB line as chemistry's own answer to its own open question, not as still
unresolved for this task. This also matches every existing precedent in this codebase: draft,
finalize, verify, and the results grid (TASK-051/052/055) are all scoped to one `ordered_test`,
never to an `order` or accession spanning multiple ordered tests. TASK-059 assembles one report
per `ordered_test`, not per `order`. Building order-level (multi-panel) bundling now would be
speculative ahead of a real multi-panel report need — a real future task if/when it arises, not
assumed here.

**Real, load-bearing finding #3 — this repo deliberately does not yet build KB-02's own `Report`
aggregate/state machine (`draft → preliminary → final → amended/corrected`), and TASK-059 should
not either.** That state machine — `ReportTemplate` versioning, narrative sections, `ReportFinalized`/
`ReportAmended` events — is FEAT-016's own issue-level "Architecture documents to reference" (KB-12,
KB-13) read the same narrower way TASK-058's own proposal already read them (finding #2 above in the
TASK-058 revision): the full engine is FEAT-032 (M7, `status: Not Started`, depends on FEAT-016, not
the reverse). "Minimal report" is the operative word in this feature's own name. TASK-059 therefore
persists a plain assembly record (hash + provenance), not a `Report` row with its own lifecycle
column — no `report.status` state machine, no amendment linkage. If a later feature needs the real
`Report` aggregate, it is layered on top of this table, not retrofitted into it.

**Real, load-bearing finding #4 — Constitution Law #3 ("block report finalization until
acknowledged") is already enforced upstream, for free, by TASK-056's existing roll-up guard.**
`FinalizationRollupInterceptor` (TASK-056, `apps/api/src/observation/finalization-rollup.interceptor.ts`)
already returns 409 on the `ordered_test.status → 'resulted'` roll-up while any critical observation
on that ordered test is unverified. Reading KB-03's own canonical `OrderedTest` state machine
(`resulted → verified → reported`), assembling a report only from ordered tests that have reached
`'resulted'` (i.e., every analyte at least finalized) inherits that guard automatically — no new
critical-acknowledgement check is needed inside the assembly service itself. This is checked
directly against the interceptor's own code, not assumed by analogy.

**Real, load-bearing finding #5 — no object/blob storage exists anywhere in this repo.** Grepped
`apps/api/`, `packages/`, `infra/` for `s3`, `bucket`, `spaces`, `blob`, `@aws-sdk`: zero hits
outside unrelated tooling. `apps/api`'s only production dependencies remain NestJS/Fastify/Drizzle/
Zod/`bwip-js`/`jose`/`pdfkit` (added by TASK-058). This directly informs §10 Q1 below — persisting
raw PDF bytes would be this repo's first blob-storage-shaped data, whereas persisting hash +
provenance and re-rendering on demand needs no new infrastructure at all, leaning on TASK-058's own
already-proven byte-for-byte determinism (same input twice → identical PDF).

## 2. Affected files

- `packages/db/src/schema/report.ts` (new) — a tenant-scoped, RLS-enabled table recording each
  assembled report (see §10 Q1 for exact columns, gated on that resolution).
- `db/migrations/0015_report.sql` (new, if §10 Q1 resolves to Option A).
- `packages/db/src/schema/index.ts` — export the new table.
- A new report-assembly module in `apps/api/src/report/` (e.g. `report-assembly.ts`), querying
  `observation`/`orderedTest`/`order`/`patient`/`specimenFulfillment`/`specimen` and mapping to
  `ChemistryReportInput`, then calling TASK-058's `renderChemistryReport`.
- `packages/db/src/audit.ts` consumer — a `report.generate` audited event (Constitution invariant
  #5), written in the same transaction as the new `report` row's insert, mirroring `finalize()`'s
  existing audit-in-transaction shape.

**Not affected:**
- No new HTTP route (§10 Q2) — TASK-060 ("Report viewer + download screen") is the task that adds
  a public route; TASK-059 stays an internal, directly-testable service, mirroring the
  `resolveObservationRange`(TASK-049)/consumer(TASK-051) and `renderChemistryReport`(TASK-058)/
  consumer(TASK-059-here-as-consumer) "service first, consumer later" precedent this repo has used
  twice already.
- No new capability (`apps/api/src/auth/capabilities.ts`) — no new route means no new authorization
  surface; TASK-060 is free to decide whether viewing/downloading a report needs a new capability
  or reuses `verify`.
- `apps/api/src/report/report-render.ts`/`report.types.ts` — TASK-058's rendering mechanism is
  reused as-is; `ChemistryReportInput` is populated with real data, not modified.

## 3. Architecture consulted

- `02-domain-model.md` — the reporting-unit open question (finding #2), the `Report` aggregate's
  own state machine (finding #3), and the Observation→Report ownership line ("Report renders,
  never owns... Report generation must resolve/assemble" — the literal source of this task's
  "assembly service" framing).
- `03-business-workflows.md` — the canonical `OrderedTest`/`Report` state machines and stage 8
  ("Report → Deliver. When required Observations are verified, the Report reaches final") —
  informs finding #4's verified-only reading, without this task building the `Report` state
  machine itself (finding #3).
- `apps/api/src/observation/finalization-rollup.interceptor.ts` (TASK-056) — the existing critical-
  acknowledgement guard this task relies on rather than re-implementing (finding #4).
- `packages/db/src/schema/observation.ts` — the snapshot columns this task's entire AC rests on
  (finding #1).
- `engineering/pdf-generation` Skill — TASK-058's own rendering entry points and determinism
  guarantees, reused unmodified.
- `engineering/database-design` Skill — checked for this repo's tenant-scoped/RLS table
  conventions before drafting the new `report` table shape (§10 Q1).

## 4. Skills loaded

- `engineering/pdf-generation` (existing, TASK-058) — `renderChemistryReport`'s determinism
  contract is this task's foundation; no changes needed to the Skill itself unless implementation
  surfaces a new finding.
- `domain/clinical-chemistry`, `domain/reference-ranges` — snapshot-vs-live-resolution discipline
  (finding #1), already-documented critical/normal range semantics for the report's per-analyte
  rows.
- `engineering/api-design` — entry #7 (RLS makes cross-tenant rows structurally invisible), entry
  #8 (explicit `ZodValidationPipe` instantiation) — checked even though this task adds no route,
  since the assembly service still queries tenant-scoped tables directly.
- `engineering/database-design` — this repo's established tenant-scoped/RLS table pattern, applied
  to the new `report` table if §10 Q1 resolves to Option A.
- `engineering/testing` — entry #1 (real-Postgres integration checks are `tsx` scripts, not
  Vitest only) — this task's core AC (2-year-old snapshot vs. current range) needs a real
  Postgres-backed test proving a `reference_range` row can change after the fact without affecting
  an already-written observation's snapshot.

## 5. Assumptions & autonomous decisions

- **Report scope is one `ordered_test`, not one `order`** (finding #2) — a genuinely resolved
  question (KB-02's own text), not left to §10.
- **No `Report` state machine, no `ReportTemplate` versioning, no amendment linkage** is built in
  this task (finding #3) — out of scope, matching "Minimal report."
- **Only `'verified'` observations are eligible for inclusion**, and assembly requires every
  analyte named by the ordered test's own `test_analyte` rows to have reached `'verified'` status
  — not just `'preliminary'`/`'resulted'` — before a report can be assembled at all; assembling
  from a partially-verified panel is rejected (409), not silently produced with gaps. This reads
  KB line 111 ("A Report cannot be final unless all required Observations are present and
  validated") plainly, and is the strictest, safest reading available given this task builds no
  partial/interim report concept (finding #3).
- **The verifier block on the rendered report reflects the most-recently-verified analyte**
  (`MAX(verifiedAt)` and its `verifierUserId`) across the included observations — a reasonable
  single-line proxy for "who signed this off," not a per-analyte verifier list, matching TASK-058's
  own single verifier block shape. Worth a reviewer's attention if a real design-partner review
  later asks for a different convention (out of this task's own scope to anticipate).
- **`ChemistryReportInput`'s shape is reused as-is** — the assembly service maps real
  `observation`/`patient`/`order`/`specimen` rows into exactly the shape TASK-058 already defined,
  rather than introducing a second, parallel data shape.

## 6. Risks

- **The new `report` table (if §10 Q1 resolves to Option A) is the first schema change in this
  feature area** — matching the same risk TASK-058's own proposal already flagged for itself;
  needs the standard RLS/migration review this Definition-of-Done already requires for any new
  tenant-scoped table.
- **The all-analytes-verified precondition (§5) is a real, load-bearing clinical-safety choice, not
  a formality** — get it wrong (e.g. allow assembly from a partially-verified panel) and a report
  could omit or silently misrepresent a not-yet-reviewed result. Needs an explicit test proving the
  409/rejection path, not just the happy path.
- **Regenerating the PDF on every view (if §10 Q1 resolves to Option A) trades storage cost for
  compute cost on every report view** — acceptable for "minimal report" at this milestone's real
  traffic, but worth a reviewer's attention if TASK-060 later shows this is a real latency problem
  (a caching layer would be a follow-up, not built speculatively here).

## 7. Acceptance criteria

TASK-059's literal AC, narrowed per findings #1–#5:
- [ ] A report assembled from an `ordered_test` whose observations were written using a
  `reference_range` row that has since been superseded (edited/effective-dated-out) still renders
  using each observation's own `refLow`/`refHigh`/`refCondition`/`refSource` snapshot — proven by a
  real Postgres-backed test that changes the underlying `reference_range` row *after* the
  observation was written, then asserts the assembled report reflects the original, not the
  changed, range (finding #1's literal proof, not simulated).
- [ ] Assembly succeeds only once every analyte on the ordered test's `test_analyte` set has
  reached `'verified'` status; assembly against a partially-verified panel is rejected, not
  silently partial (§5).
- [ ] The assembled report's content hash matches what TASK-058's own `computeReportContentHash`
  would produce for the equivalent input — proving the two tasks' pieces compose correctly, not
  just each in isolation.
- [ ] The hash (and, per §10 Q1, whatever else is persisted) is recorded somewhere real — not
  silently dropped, matching TASK-058's own AC language.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build/migrate — the new `report` table (if §10 Q1: Option A).
2. New e2e test(s) in `apps/api/test/`: the snapshot-vs-live-range proof (finding #1, the literal
   AC); the all-verified precondition (positive and 409-rejection cases); a differential test
   (two different underlying observation sets produce different hashes, mirroring TASK-058's own
   differential proof, now through real assembled data).
3. Repo-wide `pnpm typecheck`/`pnpm lint`/`pnpm build`, including a real `nest build`.
4. `openapi.json`/`packages/sdk/src/schema.ts` regeneration — only if §10 Q2 resolves to adding a
   route in this task; a no-op otherwise, since a service-only change has no HTTP surface to
   regenerate from.

## 9. Rollback plan

Additive-only under every resolution of §10: a new module, and (only if §10 Q1: Option A) one new
tenant-scoped table with its own migration and down-migration, verified against seeded data as part
of §8 before merge, same discipline as every prior schema change in this repo. No existing route,
table, or UI screen is modified — TASK-060 (not yet started) is the only future consumer of this
task's output.

## 10. Open questions — resolved 2026-08-07 via the native options-prompt

1. **Persistence shape for the assembled report.** **Resolved: Option A.**
   - **Option A (recommended, chosen): a new `report` table storing hash + provenance metadata
     only** —
     `tenantId`, `orderedTestId`, `contentHash`, `generatedAt`, `generatedByUserId`, and the set of
     `(observationId, observationCreatedAt)` pairs included (mirroring the existing
     `previousObservationId`/`previousObservationCreatedAt` composite-FK pattern in
     `observation.ts`, for real provenance, not just a hash). No PDF bytes stored — TASK-060
     re-renders on demand by re-assembling from the same (immutable, verified) observation rows,
     verifying the hash still matches. Avoids this repo's first blob-storage dependency (finding
     #5), leans on TASK-058's own proven determinism.
   - **Option B: persist the actual PDF bytes** (`bytea` column, matching `audit_event`'s own
     `bytea` precedent for `hash`/`prev_hash`) alongside the metadata above — avoids re-render cost
     on every view, at the cost of real storage growth and a genuinely new "the DB holds
     documents" pattern this repo has never used.
   - **Option C: no table at all** — TASK-059 is a pure function only (`assembleReport(orderedTestId)
     → ChemistryReportInput`), proven by tests, with all persistence deferred to TASK-060. Keeps
     TASK-059 minimal but pushes the audited-write (finding #5's Constitution invariant #5
     obligation) entirely into TASK-060, splitting "assemble" and "record that it happened" across
     two tasks in a way that doesn't cleanly map to either task's own issue text.

2. **Whether TASK-059 adds any HTTP route at all.** **Resolved: Option A.**
   - **Option A (recommended, chosen): no route** — service-only, consistent with the "service first,
     consumer later" precedent (§2). TASK-060 ("Report viewer + download screen") adds the actual
     public route(s).
   - **Option B: add an internal/ops-facing route now** (e.g. a `POST .../report:generate` a
     verifier can call explicitly) even though no UI consumes it yet — gets the audited-write
     wired end-to-end sooner, at the cost of building a route shape TASK-060 might want to change
     once it has real UI requirements.

3. **The all-analytes-verified precondition's failure shape (§5).** **Resolved: Option A.**
   - **Option A (recommended, chosen): 409 Conflict**, mirroring this repo's existing convention
     for "the
     resource exists but isn't in the right state" (`FinalizationRollupInterceptor`'s own 409,
     `upsertObservation`'s 409 on a verified row) — consistent, no new HTTP-status convention.
   - **Option B: a distinct 4xx/response shape** naming exactly which analytes are still
     unverified (richer, more actionable for a future caller) — more useful but introduces a new
     response shape this task's own scope doesn't otherwise need (TASK-056's own §10 Q4 explicitly
     deferred a similar "richer error shape" question until a real UI consumer needed one).

---

# Revision: TASK-060 — Report viewer + download screen

Status: **APPROVED** (2026-08-07) — §10's open questions resolved by the human as follows:
Q1: **Option A** — raw binary PDF response via `@Res()`, not base64 JSON.
Q2: **Option A** — reuse the existing `verify` capability; `apps/web` hides "Download PDF" from
non-`verifier` sessions.
Date: 2026-08-07    Backlog ID: FEAT-016 (#25) / TASK-060 (#119)

## 1. Goal

TASK-059 is merged (`ccc83d7`, PR #334) — `assembleAndPersistReport`
(`apps/api/src/report/report-assembly.ts`) exists, requires every analyte on a panel to be
verified, and has no HTTP route by design (its own §10 Q2). TASK-060's own issue text (#119):
"Expected output: Report viewer screen." Its one AC: "Preliminary vs. final status is unambiguous
in the viewer." Its one dependency, TASK-059, is satisfied.

**Real, load-bearing finding #1 — "preliminary vs. final" is provable entirely from data this repo
already exposes; no new "preliminary report" rendering path is needed.** `ordered_test.status`
only ever reaches `'resulted'` today (TASK-056) once every analyte on the panel is at least
finalized (`'preliminary'` or `'verified'`) and any critical is verified — `'resulted'` does **not**
guarantee every analyte is `'verified'`, only `assembleAndPersistReport`'s own stricter
all-`'verified'` precondition does. The already-shipped `GET /v1/ordered-tests/:id/results`
(TASK-051/052/057) already returns each analyte's own `status` — the exact count of
verified-vs-total analytes on the panel is computable from that one existing, ungated read, with
zero new backend surface. This directly answers the AC: the viewer shows a real "N of M verified"
state — **PRELIMINARY** while `N < M`, **FINAL** (with a working download) once `N === M` — read
from data, not a second rendering pipeline for partial results. Building an actual "preliminary PDF"
from partial data would reopen exactly the `Report` state-machine scope TASK-059's own finding #3
already declined (draft/preliminary/final rendering variants) — out of scope here too, for the same
reason.

**Real, load-bearing finding #2 — this repo has never returned a raw binary HTTP response; every
existing "rendered artifact" route stays JSON.** Grepped `apps/api/src` for `@Res(`/`StreamableFile`/
raw response handling: zero hits. TASK-046's own closest precedent (`GET /v1/specimens/:id/label`)
embeds `bwip-js`'s SVG output as a *string* inside an otherwise-ordinary `@ZodResponse`-typed JSON
body, because SVG is text — that pattern does not extend to a PDF (binary). This task is
necessarily the first route in this repo to return non-JSON bytes, a real, deliberate exception to
the `@ZodResponse`/OpenAPI-typed convention every other route follows (§10 Q1).

**Real, load-bearing finding #3 — the download route cannot itself carry `@Audit()`/
`AuditInterceptor`, but is still fully audited.** `assembleAndPersistReport` already writes its own
`report.generate` audit event directly (`writeAuditEvent`, inside the same transaction as the
`report` row insert) — not through the `@Audit()` decorator/`AuditInterceptor` mechanism every other
audited route uses, because that interceptor's contract (`AuditedMutationResult`: `resourceId` +
JSON `before`/`after`) has no sensible shape for a raw-PDF-bytes response, and finding #2 already
established this route returns raw bytes. Applying `@Audit()` on top would either not compile
against the interceptor's contract or double-audit the same action. The controller route below
therefore applies `TenantContextInterceptor` only (for `tx`/RLS binding), not `AuditInterceptor` —
Constitution Law #5 is still satisfied because the service's own internal write already runs in the
same transaction as the `report` insert; nothing about *this* route being unaudited-at-the-
interceptor-level weakens that.

**Real, load-bearing finding #4 — a real browser file download needs a genuinely new mechanism in
`apps/web`, not an extension of the existing Server-Action/typed-SDK pattern.** Every existing
`apps/web` write (draft, finalize, verify, cancel) is a Server Action returning JSON, and every read
goes through `@lis/sdk`'s typed `client.GET(...)`. Neither can hand raw PDF bytes to the browser as
a real "Save As" download — a Server Action's return value is serialized through Next's own RSC
protocol, not a plain HTTP response the browser can save as a file. `apps/web/app/api/auth/*/route.ts`
(TASK-031, login/callback/logout) is this repo's only existing precedent for a plain Next.js Route
Handler returning a real `Response` — reused here for the same reason: a Route Handler
(`apps/web/app/(app)/orders/[id]/report/[orderedTestId]/download/route.ts`) that holds the session's
access token server-side (same `getValidAccessToken()` every Server Action already uses), calls
`apps/api`'s new route directly via `fetch` (not the typed SDK client, which assumes JSON), and
returns the PDF bytes with `Content-Type: application/pdf`/`Content-Disposition: attachment` — reached
from the browser via a plain `<a href>` full-navigation link, the same TASK-046 "force a full
navigation, not client-side routing" technique already used for "Print label."

**Real, load-bearing finding #5 — the report scope is per-`ordered_test` (a panel), not per-`order`,
matching TASK-059's own already-resolved finding #2 exactly** — but `/orders/[id]/results`
(TASK-052) is a single order-wide grid across every ordered test on the order. The natural,
lowest-risk placement is a "View report" affordance **per ordered-test row** on the existing order
detail page (`apps/web/app/(app)/orders/[id]/page.tsx`'s own "Tests" list, which already renders
each ordered test's own status Badge), visible once `status === 'resulted'` — mirroring "Enter
results"'s own identical conditional-visibility shape — landing on a new per-ordered-test page, not
a second order-wide screen.

## 2. Affected files

- `apps/api/src/report/report.controller.ts` (new) — `POST /v1/ordered-tests/:id/report`, raw PDF
  bytes on success (finding #2), calling `assembleAndPersistReport` (409 propagates unchanged when
  not all analytes are verified — the exact error `ProblemDetailsFilter` already formats).
- `apps/api/src/report/report.module.ts` (new) — registers `ReportController`, mirroring every
  other domain module's own minimal shape (`ObservationModule`).
- `apps/api/src/app.module.ts` — registers the new `ReportModule`.
- `apps/web/app/(app)/orders/[id]/page.tsx` — a "View report" link per ordered-test row, visible
  once `status === 'resulted'` (finding #5).
- `apps/web/app/(app)/orders/[id]/report/[orderedTestId]/page.tsx` (new) — the viewer: fetches the
  existing `GET /v1/ordered-tests/:id/results` (no new read route, finding #1), computes N-of-M
  verified, renders an unambiguous PRELIMINARY/FINAL state (the literal AC), and — once FINAL — a
  "Download PDF" link to the Route Handler below.
- `apps/web/app/(app)/orders/[id]/report/[orderedTestId]/download/route.ts` (new) — the Route
  Handler proxying the audited `POST` to `apps/api` and returning raw bytes to the browser (finding
  #4).

**Not affected:**
- `packages/domain`/`packages/sdk`/`openapi.json` — this route is deliberately excluded from the
  `@ZodResponse`/OpenAPI-schema convention (finding #2); `apps/web` calls it via direct `fetch`, not
  the typed SDK client, so no schema/SDK regeneration applies to it. (`GET /v1/ordered-tests/:id/results`,
  the one route the viewer *does* call through the typed client, already exists — nothing to
  regenerate there either.)
- `apps/api/src/report/report-assembly.ts`/`report-render.ts` — reused as-is; this task adds a
  caller, not a change to either.

## 3. Architecture consulted

- `docs/plans/feat-016-minimal-report.md`'s own TASK-059 revision — the all-verified precondition,
  the 409 shape, and finding #3 ("no `Report` state machine") this revision's finding #1 extends to
  the viewer's own preliminary/final reading.
- `apps/api/src/specimen/specimen.controller.ts` (TASK-046) — the closest existing "preview vs.
  audited action" split (`label()` unaudited GET, `print()` audited POST) and the "plain `<a>` forces
  full navigation" precedent, both directly reused (findings #4/#5).
- `apps/web/app/api/auth/*/route.ts` (TASK-031) — this repo's only existing Next.js Route Handler
  precedent, confirming the mechanism exists and is already trusted for a real `Response` (finding
  #4).
- `engineering/api-design` Skill — entry #6 (reads aren't audited by default) and entry #8
  (explicit `ZodValidationPipe` instantiation for params) — checked for the new controller's own
  param validation, even though its response body itself opts out of the JSON/Zod convention.
- `engineering/pdf-generation` Skill — checked for any existing guidance on serving generated PDFs;
  none yet (TASK-058/059 both stopped short of an HTTP surface) — this task's own findings are
  written up as a new entry once implementation confirms them.

## 4. Skills loaded

- `engineering/pdf-generation` — TASK-058's determinism contract, reused unmodified; this task adds
  the first real consumer of its byte output over HTTP.
- `engineering/api-design` — entries #6/#7/#8 (reads unaudited by default, RLS invisibility,
  explicit `ZodValidationPipe`) for the new controller's param handling.
- `domain/result-verification` — the `verify` capability's own existing role-asymmetric grant
  (verifier-only), relevant to §10 Q2 below.
- `engineering/frontend-design` — entry #5 (Next.js client-side nav retains a prior route's RSC
  payload in the DOM) — checked again given this task adds a second "force full navigation via a
  plain `<a>`" link, the same class of risk TASK-046 already found and fixed once.

## 5. Assumptions & autonomous decisions

- **No "preliminary PDF" is ever rendered** (finding #1) — the PRELIMINARY state is a plain status
  read, not a second artifact.
- **The download route is `POST`, not `GET`**, on `apps/api` — it side-effects (creates a `report`
  row + audit event) every call, matching `print()`'s own POST-for-audited-action precedent;
  `apps/web`'s own Route Handler is what the *browser* reaches via a plain-link `GET`, translating
  that into a server-side `POST` call to `apps/api` (finding #4) — the two layers are allowed to
  differ since only `apps/web`'s edge is browser-visible.
- **Every download call re-generates and re-audits**, exactly matching TASK-046/059's own "every
  print/generate, first or repeat, audited identically" precedent — no caching, no "already
  generated, skip" shortcut, keeping this task's own scope additive-only.
- **The viewer page itself needs no capability gate** — it only reads `GET /v1/ordered-tests/:id/results`,
  already ungated, matching every other read in this repo.

## 6. Risks

- **This is the first route in this repo to break the `@ZodResponse`/JSON convention** (finding #2)
  — a real, deliberate, documented exception, not an oversight; a future reviewer unfamiliar with
  this revision could mistake the missing `@ZodResponse`/schema entry for a bug. Worth calling out
  explicitly in the PR description, not just this doc.
- **The same RSC-payload-retention risk TASK-046 already found once** (`engineering/frontend-design`
  entry #5) could recur for this task's own new plain-`<a>` link if a caller ever converts it back to
  `next/link` client-side navigation without realizing why it was plain in the first place — the
  code comment on the link itself needs to say why, not just the plan doc.
- **A second full transaction (assemble + render + insert + audit) runs on every single download
  click**, not just the first — acceptable at this milestone's real traffic (same tradeoff TASK-059's
  own §6 already accepted for repeated *view/assembly* calls), but a real, non-hypothetical load
  cost if a future caller starts polling this route instead of a human clicking a button.

## 7. Acceptance criteria

TASK-060's literal AC, narrowed per findings #1–#5:
- [ ] The viewer unambiguously shows PRELIMINARY (with the real verified-count) while any analyte on
  the panel is unverified, and FINAL once every analyte is verified — the literal AC, proven by a
  real `web-verify` pass showing both states for the same panel at different points in its lifecycle.
- [ ] "Download PDF" is only reachable/functional once FINAL; attempting it while PRELIMINARY is
  either hidden or clearly disabled, never a dead link/opaque failure.
- [ ] Clicking "Download PDF" while FINAL produces a real PDF file save, verified via a real
  headless-browser download-triggered check, not just an HTTP-level assertion.
- [ ] Each click creates exactly one new `report`/`audit_event` row pair (finding #3's own audit
  path), proven by a before/after count delta, matching every prior audited-action task's own
  verification discipline.

## 8. Testing plan

1. New `apps/api` e2e test(s): `POST /v1/ordered-tests/:id/report` returns real PDF bytes
   (`Content-Type: application/pdf`, non-empty body) once every analyte is verified; 409 (unchanged
   `assembleAndPersistReport` behavior) when not; exactly one new `report`/`audit_event` row per
   call, proven by count deltas; §10 Q2's resolved capability enforced (403 for the wrong role, if
   Option A).
2. Repo-wide `pnpm typecheck`/`pnpm lint`/`pnpm build`, including a real `nest build`/`next build`.
3. A real headless-Chromium `web-verify` pass (this task's own literal AC's own words: "unambiguous
   in the viewer") — both PRELIMINARY and FINAL states against a real panel at each stage, a real
   triggered download, dark mode, zero console/page errors — the same discipline TASK-046/052/057
   already used for their own UI-facing ACs.
4. `openapi.json`/SDK regeneration is a deliberate no-op for the new binary route (finding #2); a
   normal check only if any *other* route's shape incidentally changed (not expected).

## 9. Rollback plan

Additive-only: two new backend files (controller + module), one new `app.module.ts` import line, two
new `apps/web` pages/routes, one new link on an existing page. No existing route, table, or screen is
modified. Reverting the PR removes the entire feature cleanly; no migration, no data written by this
task that a rollback would need to reconcile (each `report` row remains a valid, self-contained
record of a real past generation regardless of whether this task's own UI is later reverted).

## 10. Open questions — resolved 2026-08-07 via the native options-prompt

1. **Response shape for the PDF bytes.** **Resolved: Option A.**
   - **Option A (recommended, chosen): raw binary**, via NestJS's `@Res()` (`res.type('application/pdf').send(buffer)`),
     with `Content-Disposition: attachment; filename="..."` — the standard, browser-native shape for
     a real file download, works with a plain `<a href>` navigation with zero client JS, no payload
     bloat.
   - **Option B: base64-encoded JSON** (`{ pdfBase64: string }`), keeping every route's response
     JSON/`@ZodResponse`-typed uniformly — avoids finding #2's exception, at the cost of ~33% payload
     bloat and requiring client-side JS (Blob conversion + a synthetic anchor click) to actually
     trigger a save, since a JSON response can't drive a plain-link download.

2. **Capability gate on generating/downloading a report.** **Resolved: Option A.**
   - **Option A (recommended, chosen): reuse the existing `verify` capability** (verifier-only) — a
     generated report is this feature's own final, clinically-signed artifact; gating it the same
     way `verify` itself already is (TASK-055) matches this repo's own established role-asymmetry
     precedent (TASK-057 already hides the "Verify" control from `technologist` sessions) rather
     than introducing a laxer standard for the artifact that *depends on* verification. If chosen,
     `apps/web` hides "Download PDF" from non-`verifier` sessions, reusing `hasVerifierRole` as-is
     (TASK-057).
   - **Option B: no new capability** — any authenticated tenant user who can already see the order
     can generate/download its report, matching this repo's uniform "reads aren't capability-gated"
     convention (catalog, patient search, results list are all ungated) — the audit trail (finding
     #3) still records exactly who generated it either way, so this option isn't a traceability gap,
     just a laxer access default.
