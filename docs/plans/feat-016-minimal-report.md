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
