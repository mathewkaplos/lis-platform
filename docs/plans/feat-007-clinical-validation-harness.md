# Implementation Proposal: FEAT-007 Clinical validation harness
Status: APPROVED
ADR: none — no new load-bearing architectural decision found; see §5 for scope reasoning and §10 for resolved decisions    Date: 2026-07-30
Backlog ID: FEAT-007 (#16) / TASK-026 (#85), TASK-027 (#86)

## 1. Goal

FEAT-007's own issue lists **Dependencies: `FEAT-005` — Observation store** only. It
does **not** list FEAT-006, confirmed directly from the issue body (`gh issue view 16`)
rather than assumed. FEAT-006 closed this session-chain, but that is incidental
timing, not a prerequisite — FEAT-007 was always parallel-eligible with FEAT-006, both
sitting on FEAT-005 as their real dependency. This proposal's own text below states
that explicitly rather than implying sequential causation that never existed.

Per FEAT-007's issue: "Prove clinical correctness from day one, not as an afterthought."
Two tasks, covered together in this one proposal per the FEAT-004/005/006 precedent —
TASK-026 (`#85`, golden-dataset test runner in CI) and TASK-027 (`#86`, first golden
dataset: chemistry ranges + criticals).

**This is the first test runner of any kind this repo builds**, and the first time CI
migrates or seeds a database at all. Worth stating plainly because TASK-026's issue
text ("scripts/run-golden-datasets + CI step") reads as a small addition to existing
test infrastructure — there is no existing test infrastructure. `AGENTS.md` declares
"Tests: Vitest (unit)" but no `vitest.config.*` and no `*.test.ts` file exist anywhere
in the repo, and no `package.json` in any workspace package defines a `test` script
(the root `pnpm test` → `pnpm -r test` currently no-ops against every package). CI's
`pr.yml` already provisions a real Postgres service (`lis_test`) but has no migration
or seed step — `packages/db/src/rls-isolation-check.ts`'s own header comment already
flags this as "FEAT-007/TASK-026's explicit job," confirming this scope belongs here,
not assumed. So TASK-026's real deliverable is two things, not one: (a) a CI database
bootstrap sequence (migrate + seed) that doesn't exist yet at all, and (b) the golden-
dataset runner itself, layered on top of it.

**What "golden dataset" can mean at M1, concretely.** KB-46 describes golden datasets
as validating clinical *logic* (range resolution, flagging, delta checks) against
known-correct results. None of that logic exists yet — range resolution (TASK-049) and
the flagging service (TASK-050) are both M3, not built. What does exist and is real,
seeded data today is the `reference_range` table (TASK-018/019, closed) holding the
design partner's CMP panel — 12 analytes, both `normal` and `critical` `range_type`
rows. So this proposal scopes TASK-026/027's harness as a **data-correctness golden
dataset**: for each (analyte, sex, condition, range_type) tuple the seed populates, the
golden JSON states the expected low/high, and the runner asserts the live
`reference_range` table matches it exactly, failing loudly on any drift. This is
squarely what TASK-027's expected output (`db/golden/chemistry-ranges-criticals.json`)
already implies, not a KB-46-mandated flagging-pipeline test that no code exists to
run yet. Flagged here as a real scope boundary, same "backlog reality overrides KB's
abstract completeness" precedent FEAT-005/006 used — not silently narrowed.

## 2. Affected files

- `db/golden/chemistry-ranges-criticals.json` (new, TASK-027) — one entry per row the
  chemistry-catalog seed (`db/seed/chemistry-catalog.sql`) inserts into
  `reference_range`: `{ analyte, sex, condition, rangeType, low, high }`, mirroring the
  seed's own `VALUES` tuples 1:1. This file is the reviewable "expected values"
  artifact TASK-027's AC calls for signing off, distinct from the SQL that loads it —
  see §6 for why this distinction matters and §10 for the one open question it raises.
- `packages/db/src/golden-dataset-check.ts` (new, TASK-026) — reads the JSON above,
  connects as `lis_app` (never `postgres`, same TASK-017/rls-isolation-check.ts lesson),
  sets `app.tenant_id` to the chemistry-catalog seed's fixed tenant
  (`00000000-0000-0000-0000-000000000001`, reused from `rls-isolation-check.ts` rather
  than duplicated), looks up each entry's `analyte_id` by display name, queries
  `reference_range` for the matching `(analyte_id, sex, condition, range_type)` tuple,
  and asserts `low`/`high` match exactly. Exits non-zero and prints every mismatch by
  name on failure — mirrors `rls-isolation-check.ts`'s own pass/fail reporting
  convention (structural section headers, `PASS`/`FAIL` lines, non-zero exit) rather
  than introducing a new reporting style.
- `packages/db/package.json` — add a `golden-check` script (`tsx src/golden-dataset-
  check.ts`), matching the existing `rls-check` script's exact pattern.
- `scripts/run-golden-datasets.sh` (new) — thin wrapper invoking `pnpm --filter @lis/db
  golden-check`, matching `scripts/db-reset.sh`'s existing wrapper-script convention
  (root `package.json`'s `db:reset` calls a root-level shell script that delegates to
  the real logic in a package). Satisfies TASK-026's literal expected-output path
  (`scripts/run-golden-datasets`) while keeping the actual logic in the same
  tsx-script convention `rls-isolation-check.ts` already established, rather than a
  second, inconsistent one-off pattern.
- `.github/workflows/pr.yml` — add, after `pnpm install` and before `pnpm test`:
  1. Run `0000`–`0011` migrations against the CI `postgres` service (new — CI has never
     done this).
  2. Run `0002_app_role.sql`'s role/grant setup so a `lis_app`-equivalent CI role and
     `APP_DATABASE_URL` exist (CI currently only has the `postgres` superuser
     connection string).
  3. Load `db/seed/chemistry-catalog.sql`.
  4. `pnpm run-golden-datasets` (root script delegating to the wrapper above), as a
     distinct step — **not** folded into the existing `pnpm test` step, since the
     runner is a raw Postgres integration script (same class as `rls-isolation-check.ts`),
     not a Vitest suite, and `pnpm test` currently no-ops with nothing to fold into.
- `~/work/lis-engineering/skills/engineering/testing/SKILL.md` (new) — FEAT-007's own
  issue lists `engineering/testing` as a **Required Skill** that does not exist yet,
  same gap class FEAT-004/005/006 each hit and resolved by authoring the missing Skill
  in the task that first needs it (FEAT-006 → `rls-multi-tenancy`). TASK-026 is that
  task here — first test-runner infrastructure this repo builds — so this proposal
  authors it rather than deferring the gap again.
- `docs/scope/current.md` — breadcrumb update once the feature closes.

## 3. Architecture consulted

- **KB-46 Testing Strategy** (FEAT-007's own cited document) — "golden datasets per
  discipline verified against known-correct results," "expert-signed... clinical
  validity ≠ code correctness," and the explicit acknowledgment that CI enforcement of
  these gates doesn't yet exist everywhere ("Continuous clinical-validation as
  disciplines/packs are added" is listed under *Future considerations*, not *done*).
  This proposal is the first concrete instance of that gate, scoped to what's buildable
  today (§1).
- **KB-15 Reference Ranges** — the multi-dimensional model (`sex`/`age`/`condition`/
  `method`/`population`, `range_type` including `critical`) that `reference_range`
  (TASK-018) already implements exactly; the golden dataset validates against these
  same dimensions, not a simplified subset.
- **KB-20 Clinical Chemistry** — the CMP panel analyte list, cross-checked against
  `db/seed/chemistry-catalog.sql`'s actual 12 seeded analytes (Glucose, BUN,
  Creatinine, Sodium, Potassium, Chloride, CO2, Calcium, Total Protein, Albumin, Total
  Bilirubin, Alkaline Phosphatase, AST, ALT) to confirm the golden dataset's scope
  matches what's really in the DB, not KB-20's full future chemistry menu.
- **KB-27 Quality Control** — read for context on how golden-dataset governance
  typically works alongside QC materials; no QC-material table exists yet at M1
  (FEAT-018 is M5), so this proposal's dataset is reference-range/critical-threshold
  data only, not a QC-rule dataset.
- **Constitution** — Law #3 (critical values never auto-verify) is the one invariant
  this harness is positioned to protect earliest: getting a critical threshold wrong in
  the golden dataset (or missing it entirely) is exactly the class of error Law #3
  exists to prevent from reaching a patient silently. Law #4/#5 are not engaged by this
  proposal — no new tenant-scoped table, no new clinically-significant write path.
- **`packages/db/src/rls-isolation-check.ts`** (TASK-024) — read in full as the
  established precedent for "a real Postgres integration script, not a Vitest suite,
  run via `tsx`, connected as `lis_app`, with `PASS`/`FAIL` console reporting and a
  non-zero exit on failure." This proposal's runner follows the same shape rather than
  inventing a new one, and is the second consumer of its `TENANT_A` fixture-tenant
  convention.
- **`db/seed/chemistry-catalog.sql`** — read in full; every seeded `reference_range`
  row's `source` column literally reads `"...placeholder, not partner-validated"`. This
  directly conflicts with TASK-027's stated AC ("reviewed and signed off by the
  design-partner lab") — see §6 and §10, not silently resolved.

## 4. Skills loaded

- `workflow/plan` (this proposal), `workflow/develop` (for implementation once
  approved), `engineering/database-design` (schema/migration conventions — no new
  migration in this proposal, but the golden-dataset query logic must match
  `reference_range`'s actual column semantics exactly).
- `engineering/rls-multi-tenancy` — the golden-dataset runner queries a tenant-scoped
  table (`reference_range`) and must connect as `lis_app` under the correct
  `app.tenant_id`, exactly the pattern this Skill documents.
- `engineering/testing` — **required by FEAT-007's own issue and does not exist yet**,
  same gap class noted in §2/§4 of FEAT-006's own proposal for `rls-multi-tenancy`.
  Authored as part of TASK-026 (see §2), not deferred again.

## 5. Assumptions & autonomous decisions

- **The golden dataset validates catalog data (`reference_range` contents), not
  flagging/range-resolution logic.** No code implementing either exists yet (TASK-049/
  050, M3). Validating the *data* the future logic will read from is genuine,
  real value now (a wrong or drifted threshold is a real patient-safety risk with or
  without the resolution service built on top of it) and is exactly what TASK-027's
  literal expected output (a JSON file of ranges+criticals, not a flagging-test suite)
  already implies. Full KB-46-scope logic testing (age-band ALP resolution, etc.) is
  correctly deferred to M3 alongside the code it tests.
- **The runner is a `tsx` Postgres integration script, not a Vitest suite.** No test
  framework exists in this repo yet (§1). Introducing Vitest now, only to run a single
  Postgres-integration check that doesn't fit its usual unit-test shape anyway, would
  be new tooling adopted for one call site while `rls-isolation-check.ts` already
  proves the simpler pattern works and is CI-ready with zero new dependencies. Vitest
  adoption is left for whichever future task first needs true unit tests (e.g.
  TASK-049/050's range-resolution/flagging logic, M3) — not decided here, not blocked
  by this proposal either.
- **CI gets a real migrate+seed step for the first time, added by this proposal, not
  assumed to already exist.** Confirmed by reading `pr.yml` directly (no such step
  today) and by `rls-isolation-check.ts`'s own comment naming this task as where it
  gets built. The new CI steps use the same `0002_app_role.sql` role-creation SQL and
  `db/seed/chemistry-catalog.sql` seed already used locally via `pnpm db:reset` —
  no new SQL, just wiring existing, already-verified artifacts into CI for the first
  time.
- **Golden JSON mirrors the seed's rows 1:1, not an independent hand-authored set.**
  This makes the runner also a regression check that the seed and the "reviewed"
  values haven't silently diverged — a real, useful side effect — but means the
  golden file's current content inherits the seed's own "placeholder, not
  partner-validated" status (§6/§10) rather than representing a genuinely independent,
  already-clinically-reviewed source.
- **`engineering/testing` Skill covers**: the `tsx`-script-over-Vitest convention
  reasoning above, the `lis_app`/tenant-context connection pattern (shared with
  `rls-multi-tenancy`), and the CI wiring pattern (migrate → seed → run), so the next
  task that needs to add a CI-run check has a documented precedent rather than
  reverse-engineering it from `rls-isolation-check.ts`/this runner by inspection.

## 6. Risks

- **TASK-027's literal AC — "reviewed and signed off by the design-partner lab" —
  cannot honestly be marked done with today's data.** Every row in
  `db/seed/chemistry-catalog.sql` carries a `source` comment stating it is a generic
  clinical-chemistry-literature placeholder, explicitly "not partner-validated." This
  is a real, external, human-process gap that no amount of code changes here can close
  — routed to §10 rather than silently treated as satisfied or silently skipped.
- **A JSON file and a SQL seed file that are supposed to always agree is a real drift
  risk going forward.** The runner catches drift *as of today* (JSON built directly
  from the current seed), but nothing stops a future migration/seed change from
  editing one file and not the other. Not fixed in this proposal (no third file
  generating both from one source exists, and building one is disproportionate to
  a 12-row, single-panel dataset at this milestone) — flagged as a known follow-up
  risk rather than solved prematurely.
- **CI's first-ever migrate+seed step is new, untested-in-CI surface.** Local
  `pnpm db:reset` (Docker Compose Postgres) and CI's `postgres:16` service container
  are not guaranteed identical in every respect (extensions, default privileges,
  connection parameters) even though both are Postgres 16 — this proposal's testing
  plan (§8) includes actually running the new CI steps on a real PR, not just
  asserting they should work by analogy to the local path.
- **The `engineering/testing` Skill being authored here will necessarily be scoped
  narrowly** (this one runner's conventions) since it's the repo's first test-runner
  Skill entry — it will likely need real expansion once Vitest/unit tests eventually
  land (M3+). Flagged so it isn't mistaken for a comprehensive testing Skill already.

## 7. Acceptance criteria

FEAT-007's feature-level AC, plus how each will be judged:
- [ ] Golden-dataset runner executes in CI and fails loudly on any mismatch — TASK-026.
      Judged by: (a) a PR that deliberately edits one `reference_range` seed value
      without updating the golden JSON, confirming the CI step fails with a named
      mismatch; (b) reverting that edit, confirming CI passes.
- [ ] First golden dataset (chemistry ranges + criticals) is reviewed and signed off by
      the design-partner lab — TASK-027. **Cannot be judged as literally satisfied by
      this proposal alone** — see §6/§10. What *can* be judged and delivered now: the
      JSON file exists, is structurally complete (12 analytes, both `normal` and
      `critical` rows where the seed has them), and is mechanically correct
      (matches the live `reference_range` table exactly, per the TASK-026 runner).

TASK-level AC:
- [ ] TASK-026 (#85): as above.
- [ ] TASK-027 (#86): mechanical/structural AC as above; design-partner sign-off
      tracked as an explicitly open item, not closed by this PR (§10).

## 8. Testing plan

1. `pnpm db:reset` locally — confirm clean migrate + seed, as an established baseline.
2. Run `pnpm --filter @lis/db golden-check` against the freshly seeded local DB —
   confirm it passes (every golden entry matches the live table).
3. Deliberately edit one seeded `reference_range` row's `high` value directly via
   `psql` (simulating drift), re-run the check, confirm it fails and names the exact
   analyte/dimension/expected-vs-actual mismatch.
4. Deliberately remove one golden JSON entry, re-run, confirm it's reported as
   "in DB but not in golden dataset" (or the converse, "in golden dataset but not in
   DB," for a removed seed row) — both directions of drift must be caught, not just
   value mismatches.
5. Confirm the runner connects as `lis_app` (`APP_DATABASE_URL`), not `postgres` —
   attempt running it with only `DATABASE_URL` set (no `APP_DATABASE_URL`) and confirm
   it fails fast with a clear error, matching `rls-isolation-check.ts`'s existing
   guard.
6. Push a real PR exercising the new CI steps end-to-end: migrate → role setup → seed
   → golden-check, on the actual GitHub Actions `postgres:16` service container, not
   assumed-equivalent-to-local — confirm green, then repeat step 3's drift scenario
   *in CI* to confirm the gate actually fails loudly there too, not just locally.
7. `docker compose down -v` for a clean teardown after local runs.

## 9. Rollback plan

Purely additive — one new JSON file, one new TypeScript check script, one new package
script entry, one new shell wrapper, and new (additive-only) CI steps in `pr.yml`. No
schema change, no migration, no existing table touched. Rollback is a straight
`git revert` of this feature's PR(s); CI reverts to its current lint/typecheck/test/
build sequence with no lingering state. No production data or deployed environment
exposure at this milestone.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-30 — land TASK-026 and TASK-027's mechanical deliverable now;
   track sign-off as an open follow-up.** Human decision, verbatim: "Land TASK-026
   now, track sign-off as an open follow-up." Implemented as: the runner + CI wiring
   (TASK-026) and the golden JSON file (TASK-027) are built and merged in this PR: the
   JSON is structurally complete and numerically matches the live `reference_range`
   table exactly. The "reviewed and signed off by the design-partner lab" AC checkbox
   is explicitly left unchecked, and standalone GitHub issue #171 tracks it as an open
   follow-up outside engineering's control (same pattern as #74/#145 in the current
   breadcrumb — flagged, not silently absorbed), rather than blocking this PR on an
   external dependency engineering cannot itself resolve.
2. **RESOLVED 2026-07-30 — accepted by default (not separately raised by the human;
   proceeding on the recommended option since it wasn't flagged as a concern).** The
   new CI migrate+seed+golden-check sequence runs unconditionally on every PR, not
   path-filtered — the same fixed sequence any future CI-run check will also need
   (per the new `engineering/testing` Skill), avoiding a second, inconsistent
   path-filtered CI variant.

**Approved 2026-07-30** — TASK-026 and TASK-027's mechanical deliverable may proceed
under this resolution.
