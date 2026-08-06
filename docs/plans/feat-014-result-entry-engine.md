# Implementation Proposal: FEAT-014 Result entry engine
Status: TASK-049 **IMPLEMENTED** — merged PR #309 (`93ed635`), closing #108. TASK-050
**IMPLEMENTED** — merged PR #311 (`5a24d83`), closing #109. TASK-051 **IMPLEMENTED** — merged PR
#313 (`8739c7f`), closing #110. TASK-052 (result entry UI) is FEAT-014's next task, to be specified
as a revision to this same file.
ADR: none — the resolution algorithm itself is a direct implementation of KB-15's already-canonical
design, not a new cross-cutting architectural decision; §10's two open questions are implementation
choices within that design, written up as new `domain/reference-ranges` Skill entries once resolved,
matching TASK-045's own precedent for a documented-technique-choice-not-ADR-weight decision.
Date: 2026-08-05    Backlog ID: FEAT-014 (#23) / TASK-049 (#108)

## 1. Goal

FEAT-013 (Accessioning, labels & reception) is fully closed — all four tasks merged, EPIC-003
itself still open only pending a design-partner demo (a non-code blocker, tracked separately, not
this proposal's concern). FEAT-013 was FEAT-014's own stated dependency, so M4 ("Chemistry Result
Loop," the thesis milestone) is now unblocked. FEAT-014 (#23) names five tasks; **this proposal's
approvable scope is TASK-049 only** — the same scope-narrowing precedent every prior proposal in
this repo has used (FEAT-011's four revisions, FEAT-012's three, FEAT-013's four). TASK-050–053
will be specified as revisions to this same file once TASK-049's real output (the resolver's exact
return shape) exists.

TASK-049's own issue text: "Range-resolution service + snapshot onto observation." Its one AC:
"Golden dataset passes for all sex/age/method dimensions tested." Its one dependency, TASK-018
(the `reference_range` migration), is closed.

**Real, load-bearing finding from this proposal's own research, not present in TASK-049's issue
text:** `packages/db/src/schema/reference-range.ts` (TASK-018, M1) already implements KB-15's full
multi-dimensional model end-to-end — `sex`, age pre-canonicalized to `ageLowDays`/`ageHighDays`,
`condition`, `method`, `specimenType`, `population`, `rangeType`, `low`/`high`, `textualRange`,
`priority`, `source`, `effectiveFrom`/`effectiveTo` — and `observation.ts` (TASK-020) already has
the exact snapshot fields KB-15 calls for (`refLow`, `refHigh`, `refCondition`, `refSource`, plus
`unit`, snapshotted separately). **No schema change is needed for this task.** No code anywhere in
this repo has ever queried `reference_range` for resolution, or written a value into any of
`observation`'s snapshot fields — TASK-026/027 (golden-dataset check) only proves the *table's own
contents* match a JSON fixture, never resolves a range for a patient. This is the same "table
exists, unused" pattern already found three times before (`specimen` before TASK-045/047, the
catalog tables before TASK-043, `order`/`ordered_test` before TASK-042) — TASK-049 is the first
task to give this table's resolution logic real behavior.

**Real, load-bearing finding #2:** the golden dataset TASK-049's own AC references
(`db/golden/chemistry-ranges-criticals.json`, TASK-027) exercises only 2 of KB-15's 9 dimensions —
`sex` (Creatinine M/F) and `condition` (Glucose fasting). Every row's `method`, `specimenType`,
`population`, and both age fields are absent. The literal AC text ("passes for all sex/age/method
dimensions tested") cannot be proven against real, partner-adjacent data for age or method, because
no age-banded or method-specific reference range exists anywhere in this repo's seed or golden
file — see §10 Q2 for how this proposal resolves that gap. `domain/reference-ranges` Skill entry #4
has the full detail.

**Real, load-bearing finding #3:** criticals are modeled as separate `reference_range` rows
(`rangeType = 'critical'`), not columns on the `normal` row — resolution must run independently
once per `rangeType`, matching KB-15's "separate rangeType + workflow" design decision. TASK-049's
own scope covers `normal` and `critical` only (the two `rangeType`s the current golden dataset
actually contains); `therapeutic` and `reportable_absurd` have zero data anywhere in this repo and
are real, deliberate future work, not an oversight.

**Real, load-bearing finding #4:** `patient.sex` (TASK-038) is `'M' | 'F' | 'U'` (`'U'` an explicit,
required "unknown" value per KB-02's invariant), not nullable the way `reference_range.sex`'s own
`null` = "any" is. `patient.birthDate` is nullable, also meaning "unknown." Neither case is
discussed in KB-15, which assumes sex and age are always known. `domain/reference-ranges` entries
#6–7 resolve both: a patient with `sex = 'U'` or a null `birthDate` must match only the
corresponding wildcard rows, never a specific-sex or age-bounded row — the same "never fake normal"
discipline KB-15 states for the no-candidate-range case, applied here to an unknown *input*. Decided
directly in this proposal (§5), not raised as an open question — there is only one answer consistent
with the Constitution's own patient-safety framing.

## 2. Affected files

- `packages/db/src/reference-range.ts` (new) — two exports, co-located with the schema they read,
  matching `accession.ts`/`audit.ts`'s own precedent (a shared, cross-cutting helper with no
  controller of its own at introduction):
  - `resolveReferenceRange(candidates: ReferenceRangeRow[], ctx: ResolutionContext): ResolvedRange | NoRangeResult`
    — the pure specificity-scoring/tie-break function (§5 Q1), no DB access, directly unit-testable.
  - `resolveObservationRange(db: DbOrTx, params: { tenantId, analyteId, unitId, patientSex,
    patientBirthDate, method?, specimenType?, population?, condition?, at }): Promise<{ normal:
    ResolvedRange | NoRangeResult; critical: ResolvedRange | NoRangeResult }>` — fetches candidate
    `reference_range` rows for the analyte/tenant/effective-window, computes patient age-in-days
    from `patientBirthDate` relative to `at` (or leaves it unresolvable if `patientBirthDate` is
    null, per §1 finding #4), and calls `resolveReferenceRange` once for `rangeType = 'normal'` and
    once for `rangeType = 'critical'`.
- `packages/db/src/index.ts` — export both.
- `apps/api/test/reference-range-resolution.e2e-spec.ts` (new) — real-Postgres test, same pattern
  as `accession.e2e-spec.ts` (TASK-045): no HTTP endpoint exists yet to test through (TASK-051
  hasn't shipped), so this imports `resolveObservationRange`/`resolveReferenceRange` directly from
  `@lis/db`, placed under `apps/api/test/` so it runs automatically under CI's existing
  `pnpm --filter api test:e2e` step (`packages/db` still has no test runner of its own — confirmed
  by its `package.json` scripts having no `test` entry, same state TASK-026's own header comment
  described). Covers: real golden-dataset rows (sex/condition dimensions, proving the literal AC
  for the dimensions real data actually has) plus new synthetic fixtures this spec inserts itself
  (age-banded, method-differentiated, tie-breaking, `no_range`, unit-mismatch, `sex='U'`,
  null-`birthDate` — see §10 Q2) — synthetic rows are inserted and cleaned up inside the spec, never
  added to the shared seed or the golden JSON, so they're never mistaken for partner-reviewed data.
- No migration, no controller, no domain Zod schema, no new capability — same "no HTTP surface by
  design" shape as TASK-045 (§5).

## 3. Architecture consulted

- KB-15 Reference Ranges (resolution algorithm, snapshotting, criticals vs. limits) — primary.
- KB-14 Result Engine (Observation lifecycle, snapshot philosophy, validation pipeline ordering) —
  context for where this service sits (step 2 of the five-step pipeline, before flagging/TASK-050).
- KB-20 Clinical Chemistry (method-aware ranges as chemistry's defining trait) — confirms this is
  real, not gold-plating, even though no chemistry method-differentiated data exists yet.
- KB-02 Domain Model (`patient.sex`/`birthDate` invariants) — for §1 finding #4.
- `docs/plans/feat-013-accessioning-labels-reception.md` (TASK-045 revision) — direct structural
  precedent for a pure-service task with no HTTP surface, tested via `apps/api/test/` against real
  Postgres.

## 4. Skills loaded

- `domain/reference-ranges` (new, drafted this session — see §9 of this proposal's own Definition
  of Done once implemented) — the primary Skill for this task.
- `domain/clinical-chemistry` (new, drafted this session) — context for why chemistry's own data
  doesn't yet exercise method-aware resolution despite KB-20 naming it as central.
- `engineering/database-design` — hand-written-migration precedent (not needed this task, no
  migration; confirmed by checking, not assumed).
- `engineering/testing` — golden-dataset/real-Postgres e2e testing precedent.
- `engineering/api-design` — not directly applicable (no HTTP surface this task), loaded to confirm
  that absence is correct rather than an oversight.

## 5. Assumptions & autonomous decisions

- **`patient.sex = 'U'` matches only `sex IS NULL` rows; a null `birthDate` matches only
  age-unbounded rows.** Per §1 finding #4 — the only answer consistent with KB-15's "never fake
  normal" principle and the Constitution's patient-safety framing. Not raised as an open question:
  there's no plausible alternative that isn't a safety regression.
- **Age is computed relative to an explicit `at` parameter (defaulting to call time), not always
  `now()`.** `resolveObservationRange` takes `at: Date` so its future caller (TASK-051, when it
  actually creates Observations) can resolve against the moment the result was produced, matching
  KB-15's snapshot philosophy (a range resolved for a result stays correct even if the patient's
  age-band would differ by the time someone later re-reads the Observation). Age-in-days is
  computed once, inside `resolveObservationRange`, from `patientBirthDate` and `at` — never
  recomputed by a caller.
- **`rangeType` scope is `normal` and `critical` only.** `therapeutic` and `reportable_absurd` have
  no data anywhere in this repo (§1 finding #3) — building resolution logic for them now would be
  speculative. `resolveObservationRange`'s return shape (`{ normal, critical }`) is deliberately not
  a generic `Record<rangeType, ...>` so adding a third `rangeType` later is a visible, reviewed
  change to the function's signature, not a silent new branch.
- **Unit compatibility is exact `unitId` equality, not real UCUM conversion.** `domain/
  reference-ranges` entry #5 — no conversion engine exists anywhere in this repo, and every seeded
  chemistry analyte has exactly one unit today, so equality is sufficient for real, current data.
  A `unitId` mismatch resolves to `no_range` (never silently ignored), matching KB-15's rejection
  behavior in spirit even though this is a coarser check than full UCUM conversion.
- **No caller exists yet.** Same "no HTTP surface by design" shape as TASK-045 (§5) — this task
  delivers the service only, consumed later by TASK-051 (which will actually create Observation
  rows and write these fields).

## 6. Risks

- **The specificity-scoring weights are a real, patient-safety-adjacent decision with no numeric
  precedent anywhere** — KB-15 gives only a qualitative ordering example ("method-specific > sex+age
  > age only > default"), not weights. A wrong weighting could resolve a less-specific range as more
  specific in an edge case (e.g. a row matching on `population` alone outranking one matching on
  `sex`), silently misflagging a result. Raised as §10 Q1 rather than decided silently, per Rule #0
  and because it's exactly the class of decision `database-design` entry #1 says to state explicitly.
- **No real data anywhere exercises the age or method dimensions** (§1 finding #2, `domain/
  clinical-chemistry` entry #2) — this task's correctness for those dimensions rests on synthetic
  test fixtures, not partner-reviewed or even literature-sourced data the way the golden dataset's
  sex/condition rows are. Raised as §10 Q2.
- **This is genuinely greenfield** — `domain/reference-ranges` entry #8: no prior resolver, partial
  resolver, or stub exists anywhere to extend or contradict. Lower risk of breaking existing
  behavior, but no existing test suite to lean on for confidence either; §8's testing plan is the
  only proof this task gets before TASK-050/051 build on top of it.
- **`resolveObservationRange`'s age computation is a new, untested date-arithmetic surface** —
  off-by-one errors at exact age-band boundaries (e.g. a patient turning from "child" to "adult" on
  the exact day of the result) are a realistic, easy-to-miss bug class. §8 explicitly includes
  boundary-value fixtures for this, not just interior-of-range cases.

## 7. Acceptance criteria

TASK-049's literal AC, narrowed per §10 Q2's resolution:
- [ ] Golden dataset (`db/golden/chemistry-ranges-criticals.json`) passes for every sex/condition
  combination it actually contains — proven against real, TASK-027-reviewed-pending data.
- [ ] Age-band and method-specific resolution are proven correct via new synthetic e2e fixtures
  (boundary values included), explicitly labeled non-clinical/synthetic — not the golden dataset,
  since no real age- or method-differentiated reference range exists anywhere in this repo yet.
- [ ] Criticals (`rangeType = 'critical'`) resolve independently of `normal` and are proven against
  the golden dataset's own critical-threshold entries (e.g. Glucose, Sodium, Potassium, Calcium).
- [ ] `patient.sex = 'U'` and null `patient.birthDate` each resolve only wildcard-compatible rows,
  proven via dedicated fixtures, never inferred from the general-case tests passing.
- [ ] No matching candidate row → explicit `no_range` result, never a silent "treat as normal."
- [ ] Unit (`unitId`) mismatch between the Observation's canonical unit and a candidate range →
  excluded from candidates, not silently applied.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `reference-range.ts` module.
2. `apps/api/test/reference-range-resolution.e2e-spec.ts`, real Postgres, connected as `lis_app`:
   - Real golden-dataset rows: every sex/condition combination in
     `chemistry-ranges-criticals.json` resolves to the exact `low`/`high` the file specifies, for
     both `normal` and `critical` rows.
   - Synthetic fixtures (inserted and cleaned up by the spec itself, never touching the shared seed
     or golden file): an age-banded pair (e.g. neonate vs. adult ranges for the same analyte,
     boundary values at exactly the band edge on both sides), a method-differentiated pair (two
     ranges for the same analyte/sex/age, different `method`, asserting the specificity scorer picks
     the method-matching row over the method-`null` row per §10 Q1's resolution), a specificity
     tie-break case (two equally-specific candidates differing only in `priority`, then only in
     `effectiveFrom` recency), a `sex='U'` patient (resolves only `sex IS NULL` rows), a null-
     `birthDate` patient (resolves only age-unbounded rows), a `unitId` mismatch (→ `no_range`), and
     a no-candidate case (→ `no_range`, not a thrown error).
   - `effectiveFrom`/`effectiveTo` windowing: a row outside the effective window at the given `at`
     is excluded even if every other dimension matches.
3. The full existing `apps/api` e2e suite re-run and confirmed still green — no regression (this
   task adds new code and reads existing tables; it writes nothing to any existing table).
4. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive throughout: one new `packages/db` module (no schema change, no migration), one new e2e
spec, two new exports. Rollback is reverting the PR — `packages/db/src/reference-range.ts` deleted,
its exports removed from `packages/db/src/index.ts`, the new spec file deleted. No existing table,
migration, or shipped feature depends on this yet (no caller exists until TASK-051).

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-05 — weighted-sum specificity scoring, `method: 100, sex: 10, age: 10,
   condition: 5, specimenType: 3, population: 1`** (wildcards score 0), ties broken by `priority`
   (descending), then tenant-local-over-shipped-default (not yet meaningful in this repo's
   single-source seed, kept in the chain for when it is), then most recent `effectiveFrom`. Method
   alone always outranks any combination of the lower-tier dimensions, matching KB-15's qualitative
   example exactly.
2. **RESOLVED 2026-08-05 — narrow the literal AC, prove the gap with synthetic fixtures.** Sex/
   condition dimensions and criticals proven against the real golden dataset; age/method dimensions,
   tie-breaking, `no_range`, and the `sex='U'`/null-`birthDate` edge cases proven against new
   synthetic e2e fixtures, clearly labeled non-clinical, never added to the golden JSON or shared
   seed. Same "state the gap plainly, don't fabricate clinical data to paper over it" precedent
   TASK-027 itself already established for this exact dataset.

**Both questions resolved — see Status header. Implementation begins now.**

## 11. Real findings during implementation

**Real, load-bearing finding, not anticipated when this proposal was drafted:**
`db/golden/chemistry-ranges-criticals.json`'s critical-threshold rows are not one two-sided row per
analyte — they're a *pair* of one-sided rows with **identical dimensional keys** (e.g. Glucose:
`{low: null, high: 40}` and `{low: 500, high: null}`, both `sex: null, condition: null`). A resolver
that picks a single "best match" row per `rangeType` (as originally designed in §2) can only return
one of the two, silently dropping the other threshold. KB-15's own schema comment explicitly
sanctions one-sided rows (`"low?, high? # interval, either bound optional -> one-sided"`), so this
is a real, KB-consistent data shape to handle, not a data-quality bug in the already-merged TASK-027
golden file to work around. Noticed while re-reading the golden file closely during implementation,
ahead of running any test, so `resolveReferenceRange` was designed from the start to merge tied rows
rather than pick one: when multiple compatible rows tie for the top specificity score, their non-null
`low`/`high` are merged (a genuine
conflict — two tied rows disagreeing on the *same* non-null bound — falls back to the existing
priority/`effectiveFrom` tie-break instead of guessing). `ResolvedRange.rangeRowIds` is a `string[]`
rather than a single id to reflect this honestly. Proven directly by the new
`'critical resolution: two one-sided rows (critical-low, critical-high) merge into one combined
result'` e2e case, and by the golden-dataset test's own group-then-merge logic (grouping golden
entries by dimensional key before comparing, since a single key can legitimately have more than one
golden-file entry). Written up as `domain/reference-ranges` Skill entry #9.

**Second real finding, caught only by CI, not local testing:** the golden-dataset test's first draft
hardcoded `at: new Date('2026-08-05T12:00:00Z')`. `db/golden/chemistry-ranges-criticals.json`'s
underlying `reference_range` rows default `effectiveFrom` to whenever `db/seed/chemistry-catalog.sql`
actually ran (real insert time), which varies by environment — the local dev Postgres had been seeded
earlier in the day, so its rows' `effectiveFrom` fell before the hardcoded cutoff by coincidence, but
CI seeds fresh at CI run time (~20:06 UTC), landing *after* the hardcoded noon cutoff and excluding
every row via the effective-window check — 14 of 14 analytes failed in CI with `no_range` while all
85 tests passed locally. This is exactly the class of environment-dependent gap only a real CI run
(not local-only testing) catches — fixed by using call-time `new Date()` instead of a hardcoded date,
since seeding always precedes the test run regardless of environment.

Verified end-to-end against real Postgres: the new `reference-range-resolution.e2e-spec.ts` (23
tests: golden-dataset sex/condition/critical coverage for all 14 seeded chemistry analytes, plus
synthetic-fixture coverage for age boundaries, method specificity, priority/effectiveFrom tie-break,
`sex='U'`, null `birthDate`, unit mismatch, no-candidate, effective-window exclusion, and the
critical one-sided-merge case above) passes; the full existing 62-test `apps/api` e2e suite re-run
and confirmed still green (85/85 total, zero regression — this task reads existing tables and writes
none); repo-wide `typecheck`/`lint`/`build` (all `packages/*` and both `apps/*`, including a real
`next build`/`nest build`) all green.

---

# Revision: TASK-050 — Flagging service (N/H/L/HH/LL) with boundary correctness
Status: **IMPLEMENTED** — merged PR #311 (`5a24d83`), closing #109. §10 Q1 resolved 2026-08-05 via
the native options-prompt, recommended option (inclusive both ways) chosen. TASK-051 (result entry
API) is FEAT-014's next task, to be specified as a revision to this same file.
Date: 2026-08-05    Backlog ID: FEAT-014 (#23) / TASK-050 (#109)

## 1. Goal

TASK-049 (range resolution) is merged (PR #309, `93ed635`). TASK-050's own issue: "Flagging service
(N/H/L/HH/LL) with boundary correctness." Its one dependency, TASK-049, is satisfied. Its one AC:
"Exactly-at-threshold boundary cases flag correctly per the golden dataset."

**This revision's scope is TASK-050 only** — same narrowing precedent as every prior task in this
feature/repo. `A` (abnormal summary), `D` (delta check), `R` (reflex) — the other three members of
`observation.flags`'s vocabulary (KB-14) — are explicitly out of scope: `TASK-050`'s own issue title
names only N/H/L/HH/LL, `D` is KB-14's separate delta-check pipeline step (no prior-Observation
lookup exists anywhere in this repo yet), and `R` is a workflow-engine concept (FEAT-029, not
started). `A` has no stated purpose beyond what N/H/L/HH/LL already convey and no task names it.

**Real, load-bearing finding from this revision's own research, not present in TASK-050's issue
text:** `reference_range`'s `critical` rangeType rows do **not** use the same low/high convention as
`normal` rows. `db/seed/chemistry-catalog.sql`'s own header comment (lines 124-127) states this
explicitly: *"a critical-low row sets `high` (below it is critical), a critical-high row sets `low`
(above it is critical)"* — confirmed against all four critical-having analytes (Glucose 40/500,
Sodium 120/160, Potassium 2.5/6.5, Calcium 6.0/13.0 — all real, standard panic thresholds). After
TASK-049's `resolveObservationRange` merges the critical-low and critical-high rows into one
`ResolvedRange` (proposal §1 finding #3, §11), the merged result's own `low` field holds the
**critical-high threshold** (value ≥ this → `HH`) and `high` holds the **critical-low threshold**
(value ≤ this → `LL`) — inverted from `normal`'s low/high, which is genuinely easy to get backwards
if not read carefully. This is the revision's central design point (§5), not an open question — the
seed file's own comment settles it unambiguously, no plausible alternative reading survives checking
it against all four analytes' real threshold values.

## 2. Affected files

- `packages/db/src/flagging.ts` (new), co-located with `reference-range.ts` (same "shared,
  cross-cutting, no controller of its own yet" precedent as `accession.ts`/`reference-range.ts`) —
  a single pure export, `computeFlags(value: number, normal: ResolvedRange | NoRangeResult,
  critical: ResolvedRange | NoRangeResult): string[]`. Pure (no DB access) despite living in
  `packages/db` rather than `packages/domain`: `packages/domain` is exclusively Zod request/OpenAPI
  schemas in this repo today (every existing file there — `patient.ts`, `order.ts`, `specimen.ts`,
  `catalog.ts` — confirmed by inspection, zero business-logic exports), and this function's only
  real collaborator is `reference-range.ts`'s own exported types — co-locating avoids introducing a
  second, inconsistent "business logic" location for a one-function task.
- `packages/db/src/index.ts` — export `computeFlags`.
- `apps/api/test/flagging.e2e-spec.ts` (new) — real Postgres, same direct-`@lis/db` pattern as
  `reference-range-resolution.e2e-spec.ts`: resolves real ranges via `resolveObservationRange`
  against the golden dataset, then asserts `computeFlags` on values exactly at, and one unit either
  side of, every real boundary (the AC's own literal "exactly-at-threshold" wording) — a unit-test
  shape, but living under `apps/api/test/` for the same CI-wiring reason as its two predecessors.
- No migration, no controller, no domain Zod schema, no new capability — same "no HTTP surface by
  design" shape as TASK-045/049 (no caller yet; TASK-051 is the first real consumer).

## 3. Architecture consulted

- KB-15 Reference Ranges (`flagFor`: "below low → L (or LL if below critical-low); above high → H
  (or HH if above critical-high); within → N").
- KB-14 Result Engine (`flags[]` vocabulary: N,H,L,HH,LL,A,D,R; validation-pipeline step ordering).
- `db/seed/chemistry-catalog.sql` (the critical-row low/high convention, §1).
- `docs/plans/feat-014-result-entry-engine.md`'s own TASK-049 revision (`ResolvedRange`'s shape,
  the critical-row merge behavior this task's input directly depends on).

## 4. Skills loaded

- `domain/reference-ranges` (entries #3, #9 — critical rows as separate/merged rows — directly
  load-bearing for this task's central finding).
- `domain/clinical-chemistry` (confirms real critical thresholds exist only for 4 of 14 seeded
  analytes — most analytes will only ever produce N/L/H, never HH/LL, and that's expected, not a
  gap).
- `engineering/testing` (golden-dataset e2e precedent).

## 5. Assumptions & autonomous decisions

- **A single severity flag, not multiple simultaneous ones.** `computeFlags` returns exactly one of
  `N | L | LL | H | HH` (as a one-element array, since `observation.flags` is `text[]` and future
  tasks may append `A`/`D`/`R` alongside it) — never both `L` and `LL` for the same value. KB-14
  lists them as members of one severity axis, not independent booleans; a report showing both `L`
  and `LL` for the same result would be redundant and confusing. Tier precedence (most to least
  severe): `LL` (value ≤ critical-low threshold) → `L` (value < normal low) → `HH` (value ≥
  critical-high threshold) → `H` (value > normal high) → `N`.
- **No `normal` match (`no_range`) produces an empty flags array, not a fabricated `N`.** Matches
  KB-15's "no_range... never silently treated as normal" discipline directly — `computeFlags`
  returns `[]` when `normal.matched` is `false`, regardless of whether `critical` matched (a value
  can still be flagged `HH`/`LL` from critical thresholds alone even with no normal range on file,
  per real lab practice — critical alerting shouldn't be gated on having a normal range too).
- **`critical.low`/`critical.high` are read per §1's confirmed convention**, not `normal`'s
  convention — this is the one place in the codebase this inversion must be handled correctly; the
  function's own internal naming (`criticalHighThreshold = critical.low`,
  `criticalLowThreshold = critical.high`) makes the inversion explicit in code, not just in a
  comment, so a future reader can't miss it by skimming variable names.
- **String→number conversion happens once, at the top of `computeFlags`**, matching
  `reference-range-resolution.e2e-spec.ts`'s own `Number(resolved.low)` pattern — `ResolvedRange`'s
  `low`/`high` are `string | null` (drizzle's numeric-column convention, preserving precision);
  `computeFlags`'s own `value` parameter is a plain `number` (the caller's already-parsed measured
  value — TASK-051's own scope, not this task's).

## 6. Risks

- **The critical-field-inversion (§1) is the single easiest place to introduce a real patient-safety
  bug in this entire feature** — swapping which field drives HH vs LL would silently misclassify a
  genuinely critical result as merely high/low (or vice versa), directly touching Constitution
  invariant #3 ("Critical values never auto-verify... blocks report finalization until
  acknowledged" — a value that should be `HH`/`LL` but isn't correctly flagged never enters that
  workflow at all). §8's testing plan tests every real critical threshold from the golden dataset
  explicitly, both sides of the boundary, specifically to make this hard to get wrong silently.
- **Boundary inclusivity (`==` cases) has no explicit precedent anywhere in KB-15/KB-14 or this
  repo** — raised as §10 Q1 rather than assumed, given the AC's own literal emphasis on
  "exactly-at-threshold" correctness.
- **Only 4 of 14 seeded chemistry analytes have any critical rows at all** (`domain/
  clinical-chemistry` entry #2-adjacent finding) — `computeFlags`'s HH/LL paths are only provable
  against real data for Glucose/Sodium/Potassium/Calcium; the other 10 analytes' tests only exercise
  N/L/H. Not a gap in this task's own correctness, just a real limit on what "golden dataset
  coverage" can prove given the seeded catalog's own real scope.

## 7. Acceptance criteria

TASK-050's literal AC:
- [ ] Exactly-at-threshold boundary cases flag correctly per the golden dataset — proven for every
  real `normal` low/high bound (14 analytes) and every real `critical` threshold (4 analytes) in
  `db/golden/chemistry-ranges-criticals.json`, at the boundary value itself and one unit to either
  side.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `flagging.ts` module.
2. `apps/api/test/flagging.e2e-spec.ts`, real Postgres:
   - For every analyte with a `normal` row: value exactly at `low` → `N`; one unit below `low` →
     `L`; value exactly at `high` → `N`; one unit above `high` → `H`; a mid-range value → `N`.
   - For the four analytes with `critical` rows: value exactly at the critical-low threshold
     (`critical.high`, per §1) → `LL`; one unit above it (still below `normal.low`) → `L`; value
     exactly at the critical-high threshold (`critical.low`, per §1) → `HH`; one unit below it
     (still above `normal.high`) → `H`.
   - A `no_range` case (synthetic, no candidate row): `computeFlags` returns `[]`, not `['N']` or a
     thrown error.
   - A value critically low/high with no matching `normal` range at all (synthetic): still returns
     `['LL']`/`['HH']`, proving critical alerting isn't gated on a normal range existing.
3. The full existing `apps/api` e2e suite re-run and confirmed still green.
4. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive: one new `packages/db` module (pure function, no schema/migration), one new export, one
new e2e spec. Rollback is reverting the PR. No caller depends on this yet.

## 10. Questions requiring human approval

1. **Boundary inclusivity: is a value exactly at a threshold "in bounds" (the milder/no flag) or
   "past it" (the stricter flag)?** Neither KB-14 nor KB-15 states this explicitly, and TASK-050's
   own AC specifically calls out boundary correctness as something to get right rather than assume.
   **Recommended:** inclusive reference ranges (value == `low` or `high` → `N`, matching the
   universal CLSI/lab convention that a reference interval's own published bounds are themselves
   normal) and inclusive critical thresholds (value == the critical-low/critical-high threshold →
   `LL`/`HH`, matching the same "the threshold itself is already the emergency, not one unit past
   it" convention every real panic-value protocol uses — waiting for a value to exceed 500 before
   treating it as a Glucose panic, rather than treating 500 itself as the panic value, would delay a
   real clinical alert).

**RESOLVED 2026-08-05 — inclusive both ways, as recommended.** Implementation begins now.

## 11. Real findings during implementation

None beyond §1's own finding, confirmed unchanged during implementation — the critical-field
inversion was correctly handled from the start (variables named `criticalHighThreshold`/
`criticalLowThreshold` in `computeFlags` to make the inversion explicit in code, per §5).

Verified end-to-end against real Postgres: 16 new e2e tests (14 analytes' real golden-dataset
boundaries — exactly-at-`low`/`high`/critical-threshold values, plus one value strictly on each
side, inclusive-boundary semantics confirmed for every one of them; 4 of the 14 additionally proving
`LL`/`HH` since only Glucose/Sodium/Potassium/Calcium have real critical rows; 2 pure edge-case
tests needing no DB access at all — `no_range` returns `[]`, and a critical match with no matching
normal range still flags `HH`/`LL`); the full existing 85-test `apps/api` e2e suite green (101/101
total, zero regression); repo-wide `typecheck`/`lint`/`build` green (including a real `next build`/
`nest build`).

---

# Revision: TASK-051 — Result entry API (draft/submit, typed values)
Status: **IMPLEMENTED** — merged PR #313 (`8739c7f`), closing #110. Both §10 questions resolved
2026-08-06 via the native options-prompt, recommended option chosen for each. TASK-052 (result
entry UI) is FEAT-014's next task, to be specified as a revision to this same file.
Date: 2026-08-06    Backlog ID: FEAT-014 (#23) / TASK-051 (#110)

## 1. Goal

TASK-050 (flagging) is merged (PR #311, `5a24d83`). TASK-051's own issue: "Result entry API
(draft/submit, typed values)." Its one dependency, TASK-050, is satisfied. Its one AC: "Numeric,
coded, and text results all persist correctly per value_type."

**This revision's scope is TASK-051 only.** `TASK-052` (result entry UI) and `TASK-053` (calculated
fields) remain open, to be specified as revisions to this same file once this task's real output
exists. This is the first task in this feature — and the first task in this repo — that actually
writes to `observation`, the schema every prior FEAT-014 task (and much of the KB) treats as the
system's central table.

**Real, load-bearing finding #1:** an `enter_result` capability already exists
(`apps/api/src/auth/capabilities.ts`), granted to both `technologist` and `verifier`, and is already
exercised by a demo-only route in `capability-check.controller.ts` (TASK-032, proving the guard
mechanism ahead of any real feature needing it). **No new capability or ADR is needed for
authorization** — this task is that capability's first real consumer.

**Real, load-bearing finding #2:** `observation.status`'s existing two pre-verification values —
`'registered'` ("an Observation slot exists... value may be empty," KB-14) and `'preliminary'` ("a
value exists but is not released," KB-14) — map directly onto this task's own "draft"/"submit"
language with **no schema change and no new status value needed**: a draft save is `'registered'`
(a value already exists, just not yet the technologist's asserted result); a submit/finalize is
`'preliminary'` (asserted, not yet verified — TASK-055's own job). Constitution invariant #2
("Verified clinical data is append-only") scopes append-only *to verified data specifically* — a
`'registered'` or `'preliminary'` observation is real clinical data but not yet *verified* clinical
data, so in-place `UPDATE`s before verification (redrafting, or re-finalizing a `'preliminary'`
value before it's ever verified) do not violate this invariant. This reading is load-bearing for
this task's whole write model and is stated here explicitly, not assumed silently.

**Real, load-bearing finding #3:** `observation.specimenId` is `NOT NULL` with no FK yet (#260,
already-known pre-existing gap) — this task is the first to need a real value for it. It's resolved
via `specimen_fulfillment` (TASK-023: `orderedTestId → specimenId`, created by TASK-047's reception
flow) — the same join TASK-047 itself already relies on in the other direction. An `orderedTest`
with no `specimen_fulfillment` row (never received) cannot have a result entered — this is also
exactly the "specimen received" precondition KB-03's own state machine requires before result entry,
so the guard is a real workflow rule, not just a NOT NULL workaround.

**Real, load-bearing finding #4:** `test_analyte` (FEAT-004) is genuinely many-to-many, but every
seeded chemistry `test_definition` maps to exactly one `analyte` (confirmed: 14 `test_definition`
rows, 14 `test_analyte` rows, no sharing). This task's own code queries `test_analyte` generically
(never assumes 1:1) — the current data's simplicity doesn't change the schema's real shape, matching
`domain/specimen-lifecycle` entry #3's identical caution about `specimenFulfillment`.

## 2. Affected files

- `packages/domain/src/observation.ts` (new): `observationDataTypeSchema` (restricted to `'quantity'
  | 'coded' | 'text'` — §10 Q2), `resultEntrySchema` (a `z.discriminatedUnion('dataType', ...)` over
  those three, each carrying its own typed value field — `valueNum`/`valueCode`/`valueText`), and
  `observationSchema` (the response shape: id, orderedTestId, analyteId, dataType, the typed value,
  unit, `refLow`/`refHigh`/`refCondition`/`refSource`, `flags`, `status`, timestamps). Single source
  of truth for validation + OpenAPI, matching every prior domain file's own stated convention.
- `apps/api/src/observation/observation.controller.ts` (new), `@Controller('v1/ordered-tests/:id')`:
  - `PUT 'results/:analyteId'` — draft save. `@RequireCapability('enter_result')`, **no `@Audit`**
    (§10 Q1). Upserts one `observation` row (`status: 'registered'`), resolves the range and
    computes flags immediately (live-flag support for TASK-052's own AC), and — on the *first* draft
    for this `orderedTest` — advances `orderedTest.status` `'received' → 'in_process'`.
  - `POST 'results/:analyteId/finalize'` — finalize. `@RequireCapability('enter_result')`,
    **`@Audit({ action: 'observation.finalize', resourceType: 'observation' })`** (§10 Q1). Accepts
    the same typed-value body as draft (so a keyboard-only flow can type-and-finalize in one round
    trip without a separate draft call first — FEAT-014's own AC: "entered without touching the
    mouse"); upserts with `status: 'preliminary'`. After writing, checks whether every `analyteId`
    named by this `orderedTest`'s `test_analyte` rows now has a `'preliminary'`-or-later observation
    — if so, advances `orderedTest.status → 'resulted'`.
  - `GET 'results'` — lists this `orderedTest`'s current observations (draft and final), for
    TASK-052's UI to render the grid's current state. No capability required beyond `JwtAuthGuard`
    (read, matching `OrderController.search()`/`getById()`'s own unguarded-read precedent).
  - Both write routes reject (`409`) unless `orderedTest.status` is `'received'` or `'in_process'`
    (specimen received, not yet finalized) — matching KB-03's own state ordering, and reject (`400`)
    if the submitted `dataType` doesn't match the analyte's own catalog `dataType`
    (Constitution invariant #1: never let a value be stored under the wrong structural shape).
- `packages/db/src/index.ts` — no new export needed (this task is the first *caller* of
  `resolveObservationRange`/`computeFlags`, both already exported).
- `apps/api/test/observation.e2e-spec.ts` (new): real Keycloak/Postgres, full HTTP stack — this
  task's own AC needs a real order → receive → enter-result chain, matching `specimen.e2e-spec.ts`'s
  own precedent of building on `order.e2e-spec.ts`'s helpers rather than re-deriving fixtures.
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` — regenerated (`generate-openapi`), per the
  already-known "don't let this silently fall a task behind" gap (#292).

## 3. Architecture consulted

- KB-14 Result Engine (Observation lifecycle: `registered → preliminary → verified`; "one
  Observation per analyte" design decision).
- KB-15 Reference Ranges / KB-20 Clinical Chemistry (already consumed via TASK-049/050's own
  services — this task is their first caller, not new research).
- KB-03 Business Workflows (`OrderedTest` state ordering: `received → in_process → resulted`).
- `domain/reference-ranges` Skill (entries #6-#10 — `sex='U'`/null-`birthDate` handling, the
  critical-field inversion — directly relevant to how this task calls `resolveObservationRange`).
- `docs/plans/feat-013-accessioning-labels-reception.md` (TASK-047 revision) — `specimen_fulfillment`
  usage precedent.

## 4. Skills loaded

- `domain/reference-ranges` (this task is the real integration point for TASK-049/050's services —
  every entry is directly relevant, especially #6/#7/#10).
- `domain/clinical-chemistry` (entry #6: every seeded analyte is `dataType: 'quantity'` — the
  `'coded'`/`'text'` paths in this task's own scope are real per KB-14 but untestable against real
  seeded data beyond `'quantity'`; covered by synthetic fixtures instead, same pattern TASK-049
  already used for age/method).
- `domain/specimen-lifecycle` (entry #3: `specimenFulfillment`'s real many-to-many shape).
- `engineering/api-design` (action-sub-resource convention, `ZodValidationPipe` explicit-instantiation
  requirement, RLS-makes-cross-tenant-invisible precedent).

## 5. Assumptions & autonomous decisions

- **`observation.status` mapping (§1 finding #2) decided directly, not raised as a question** — it
  follows from KB-14's own existing state definitions with zero ambiguity once read carefully.
- **Draft upserts are a plain `UPDATE` of the existing `'registered'`/`'preliminary'` row, not a new
  row per save** — matches §1 finding #2's append-only reading (only *verified* data is append-only)
  and avoids `observation`'s composite-PK/partitioning machinery (ADR-0008) generating a new
  partition row on every autosave keystroke, which the schema was never designed for at that write
  frequency.
- **`orderedTest.status` auto-advances; no separate "start" or whole-order "submit" action exists.**
  `'received' → 'in_process'` on first draft, `'in_process' → 'resulted'` on the last analyte's
  finalize — both are side effects of the per-analyte write, not separate endpoints, since KB-03
  names no distinct "start entering" or "submit the whole panel" action.
- **`resolveObservationRange`/`computeFlags` are called on every draft save, not deferred to
  finalize** — TASK-052's own AC names "live flags," and re-running already-tested, pure/near-pure
  services on every save is cheap and correct; finalize does not re-run them a second time (it
  reuses the values already snapshotted by the most recent draft, and computes fresh if this is a
  direct finalize-without-a-prior-draft).
- **`'coded'`/`'text'` dataTypes get no range/flag computation** — `flags` stays `[]`,
  `refLow`/`refHigh`/etc. stay `null`. KB-15's whole model is numeric; there's no reference-range
  concept for a coded or free-text result value.

## 6. Risks

- **Skipping audit on draft autosaves (§10 Q1) is the one place this task's own design departs from
  the Constitution's literally emphatic "every clinically significant action is audited."** The
  recommended reading — a draft isn't yet the technologist's asserted result, only finalize is — is
  reasonable but genuinely debatable, and this is the first task in the repo to draw that line at
  all; raised explicitly rather than assumed.
- **High write frequency**: a full 14-analyte CMP entered via autosave is up to 14 draft writes plus
  14 finalize writes per panel. Not a performance risk at this milestone's real scale, but worth
  noting since it's a new write-volume pattern this schema hasn't seen before (`observation`'s
  partitioning, per ADR-0008, was sized with analyzer-feed volumes in mind, not keystroke-level
  autosave — still comfortably within bounds, just newly exercised).
- **`observation.specimenId`'s still-missing FK (#260)** — this task adds the first real writer that
  depends on getting that value right from `specimen_fulfillment` at write time; a wrong or stale
  join here is not caught by any database-level constraint, only by this task's own tests.

## 7. Acceptance criteria

TASK-051's literal AC:
- [ ] Numeric, coded, and text results all persist correctly per value_type — proven for each of the
  three `dataType`s (quantity against real seeded chemistry analytes; coded/text against synthetic
  fixtures, per §4), draft and finalize, including the `dataType`-mismatch rejection.

## 8. Testing plan

1. `pnpm --filter @lis/domain typecheck`/build with the new `observation.ts` schema.
2. `apps/api/test/observation.e2e-spec.ts`, real Keycloak/Postgres/compiled-adapter-shaped HTTP:
   - Full chain: create order → receive specimen (real endpoints, not fixtures) → draft a `quantity`
     result → confirm live flags/snapshot returned → finalize → confirm `orderedTest.status →
     'resulted'` once every analyte is finalized, `'in_process'` while partial.
   - Synthetic `coded`/`text` analyte + `test_definition` (this task's own fixtures, not the shared
     seed) proving both dataTypes persist and round-trip correctly.
   - `dataType` mismatch (e.g. `text` value against a `quantity` analyte) → `400`.
   - Draft/finalize attempted before specimen reception (`orderedTest.status = 'ordered'`) → `409`.
   - Draft/finalize attempted after the `orderedTest` is already `'resulted'` → `409`.
   - Finalize with no prior draft (direct type-and-finalize) succeeds in one call.
   - Audit: finalize produces one `audit_event` row (`observation.finalize`); draft produces none —
     proven by an exact before/after `tenant-audit-count` delta, matching every prior audited-action
     test's own verification style, not assumed from the route's own code.
3. The full existing `apps/api` e2e suite re-run and confirmed still green.
4. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root, including a real compiled-server boot
   (`engineering/api-design` entry #10's own discipline — this repo's real Fastify adapter has broken
   silently on a new route before, TASK-040).

## 9. Rollback plan

Additive: one new domain schema file, one new controller (new route prefix, no existing route
touched), one new e2e spec. `orderedTest.status`'s two new real values (`'in_process'`/`'resulted'`)
are already in the existing CHECK constraint (TASK-042) — no migration. Rollback is reverting the
PR; no other feature depends on this yet.

## 10. Questions requiring human approval

1. **Endpoint shape and audit scope.** **Recommended:** two routes per analyte (`PUT .../results/
   :analyteId` draft, unaudited; `POST .../results/:analyteId/finalize`, audited) as designed in §2,
   with `orderedTest.status` auto-advancing as a side effect of each — not a single endpoint with a
   `status` body field (which can't cleanly vary `@Audit` per call within one NestJS route handler
   without a novel manual-`writeAuditEvent` pattern this repo has never used), and not a separate
   whole-panel "submit" action (KB-03 names no such action; the UI can finalize each analyte as the
   user tabs through them).
2. **`dataType` scope: `quantity`/`coded`/`text` only, the other 7 KB-14 dataTypes deferred.**
   **Recommended,** matching the AC's own literal wording exactly ("Numeric, coded, and text") — no
   seeded analyte is `ordinal`/`boolean`/`ratio`/`datetime`/`table`/`structured`/`attachment` today,
   and KB-14 itself treats them as genuinely separate concerns (e.g. `table`/`attachment` need
   object-store/file handling this task has no reason to build yet).

**RESOLVED 2026-08-06 — both as recommended.** Implementation begins now.

## 11. Real findings during implementation

**Real finding, caught by this task's own e2e test failing correctly, not assumed:** `resultEntrySchema`
(§2) has no field to submit clinical context (KB-15's `condition` dimension — fasting, pregnancy
trimester, etc.). Glucose's real seeded `normal` row requires `condition: 'fasting'` exactly (`db/
seed/chemistry-catalog.sql`) — a Glucose draft/finalize call through this API can therefore never
resolve a `normal` range (only its condition-wildcard `critical` rows can match), correctly
returning `no_range` rather than a fabricated match. This is a real, KB-15-consistent scope boundary
— nothing anywhere in this repo (this task included) has a mechanism to capture "this specimen was
drawn fasting," so building `condition` submission into this task would be speculative. The e2e
suite's own "drafts a quantity result" case uses Sodium (no `condition` dimension on its real range)
instead of Glucose for this reason; Glucose is still used for the critical-value case, since KB-15's
critical thresholds for it are condition-wildcard. Future work needing fasting-aware Glucose
resolution will need a real condition-capture mechanism first, not just a resolver-side fix.

Verified end-to-end against real Keycloak/Postgres/the full HTTP stack, including the real compiled
Fastify server (booted directly, confirming the new nested `:id`/`:analyteId` routes register and
bind params correctly — `engineering/api-design` entry #10's own discipline, given this repo's prior
real Express-vs-Fastify param-binding divergence on a differently-shaped route): draft save with
live flags/snapshot and the `'received' → 'in_process'` transition; a critical value flagging `HH`
live on draft; finalize-without-a-prior-draft in one call, audited, `'in_process' → 'resulted'` once
the one required analyte is finalized, and rejected once already `'resulted'`; rejection before
specimen reception (`409`); `dataType` mismatch rejection (`400`); synthetic `coded`/`text` fixtures
persisting and round-tripping correctly (the literal AC); the results-list read endpoint. Draft
produces zero new `audit_event` rows, finalize produces exactly one, both proven by an exact
before/after count delta. The full existing 101-test `apps/api` e2e suite green (zero regression);
repo-wide `typecheck`/`lint`/`build` green.

---

# Revision: TASK-052 — Result entry UI (analyte grid, live flags, autosave)
Status: **APPROVED** — §10 Q1 resolved 2026-08-06 via the native options-prompt, recommended option
(extend `GET /v1/catalog`) chosen. Implementation begins now.
Date: 2026-08-06    Backlog ID: FEAT-014 (#23) / TASK-052 (#111)

## 1. Goal

TASK-051 (result entry API) is merged (PR #313, `8739c7f`). TASK-052's own issue: "Result entry UI
(analyte grid, live flags, autosave)." Its one dependency, TASK-051, is satisfied. Its one AC: "A
full chemistry panel is enterable without using the mouse."

**This revision's scope is TASK-052 only.** `TASK-053` (calculated fields) remains open, to be
specified as a revision to this same file once this task's real output exists.

**Real, load-bearing finding #1:** the frontend has no way to learn, for a given `orderedTest`,
*which* `analyteId` to submit results against, or that analyte's `dataType`/unit for rendering —
`GET /v1/orders/:id` returns only `testDefinitionId` per ordered test, and `GET /v1/catalog`
(already fetched by the order detail page) returns only `id`/`code`/`displayName` per test, no
analyte information at all. This is a real, small gap TASK-051 didn't need to close (it takes
`analyteId` as a URL param, supplied by whatever calls it) but this screen does. **Resolved via §10
Q1** — extending `GET /v1/catalog`'s response, not adding a new endpoint.

**Real, load-bearing finding #2:** this is the first screen in this repo needing per-field autosave
(save-as-you-type-and-tab-away) rather than a single whole-form submission — every prior form
(`reception-form.tsx`, `order-builder-form.tsx`, registration) uses `useActionState` bound to one
`<form>`. A Next.js Server Action is a plain async function, callable directly from a Client
Component's own event handler (not only via `<form action={fn}>`) — this screen calls
`draftResult`/`finalizeResult` imperatively `onBlur`/on Enter, with per-row local state for the
pending/value/flags, never exposing `getValidAccessToken()`'s token to the browser (ADR-0014's own
server-side-only token boundary is preserved exactly the same way every prior screen preserves it —
this is a new *interaction* pattern, not a new *auth* pattern).

**Real, load-bearing finding #3:** `packages/ui`'s `StatusPill` component (TASK-035/036, `Badge`'s
clinical-flag sibling) already models exactly `N | H | L | HH | LL | A` with the correct
icon+color+"never color alone" treatment (Stitch Prompt Library §0) — built two milestones ago, with
**zero consumers until this task**, since no screen has had real flag data before now. This is the
"table exists, unused" pattern's UI-side equivalent, not a new component to design.

## 2. Affected files

- `apps/api/src/catalog/catalog.controller.ts` / `packages/domain/src/catalog.ts` — `CatalogTest`
  gains an `analytes: CatalogAnalyte[]` array (`id`, `display`, `dataType`, `unit` display string),
  populated via `test_analyte` (§10 Q1). Additive to an already-shipped, already-fetched-everywhere
  response shape — no breaking change to any existing consumer (`orders/new`, `orders/[id]`).
- `apps/web/app/(app)/orders/[id]/results/page.tsx` (new) — Server Component: fetches the order,
  catalog (now with analytes), and — per `orderedTest` in `'received'`/`'in_process'` status — its
  current results (`GET /v1/ordered-tests/:id/results`, `Promise.all` across the panel's own
  ordered tests, matching `orders/[id]/page.tsx`'s existing `Promise.all` shape; bounded by a real
  panel's real size, not paginated — same "don't build ahead of a real need" call as
  `ORDER_SEARCH_RESULT_LIMIT`).
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` (new), `'use client'` — the actual
  interactive grid: `packages/ui`'s `DataTable` (cell renderer hosts the input + `StatusPill`,
  `engineering/frontend-design`'s own "compose from existing primitives" precedent) with columns
  Analyte / Reference range / Result / Flag. Local state per row (value, pending, flags, finalized);
  `onBlur` calls the draft Server Action, `Enter` calls finalize then moves focus to the next
  not-yet-finalized row's input (native DOM `tabIndex`/`focus()`, no drag-drop or virtual-focus
  library — a native `<table>`'s row order is already the Tab order).
- `apps/web/app/(app)/orders/[id]/results/actions.ts` (new) — `draftResult`/`finalizeResult` Server
  Actions, plain typed async functions (not `useActionState`-bound — finding #2), calling
  `PUT`/`POST .../results/:analyteId` via the existing `createLisApiClient` pattern.
- `apps/web/app/(app)/orders/[id]/results/loading.tsx`, `error.tsx` (new) — matching every existing
  route's four-state convention (populated/empty/loading/error).
- `apps/web/app/(app)/orders/[id]/page.tsx` — gains a "Enter results" link (mirroring the existing
  "Receive at reception" link's own conditional-visibility pattern) when any `orderedTest` is
  `'received'`/`'in_process'`.

## 3. Architecture consulted

- FEAT-014's own AC ("entered without touching the mouse") and KB-14 (Observation lifecycle —
  already consumed via TASK-049/050/051, not new research here).
- `Google-Stitch-Prompt-Library.md` §0 (never color-alone for clinical flags — `StatusPill` already
  encodes this).
- `docs/plans/feat-014-result-entry-engine.md`'s own TASK-051 revision — the exact request/response
  shapes this screen calls.
- ADR-0014 (session token bridge) — reaffirmed, not revisited: this screen's new *interaction*
  pattern (imperative Server Action calls) doesn't touch the token-refresh boundary at all.

## 4. Skills loaded

- `domain/reference-ranges` (entries #6/#7/#10 — what a returned `no_range`/inverted-critical-field
  result means for how the UI should render it, e.g. a `no_range` result shows no reference range,
  not a blank-as-if-zero).
- `domain/clinical-chemistry` (entry #6 — real seeded data is 14/14 `quantity`; §5 scopes the UI to
  `quantity` input rendering only, `coded`/`text` input types deferred).
- `engineering/frontend-design` (compose-from-primitives discipline, the RSC-payload-retention
  gotcha from FEAT-013 — this task's route is a fresh page under `/orders/[id]/`, not reached via a
  patient-data-bearing intermediate route, so that specific gotcha's precondition doesn't recur, but
  checked explicitly rather than assumed).
- `engineering/google-stitch-integration` (if a §7 prompt exists for "Dynamic Result Entry" —
  FEAT-014's own issue names §9.1; consulted for layout, not literally implemented pixel-for-pixel
  where it exceeds this task's real backend scope, same "deliberately narrower than the mockups"
  precedent every prior frontend task in this repo has used).

## 5. Assumptions & autonomous decisions

- **UI renders `quantity` input only.** `domain/clinical-chemistry` entry #6: 14/14 seeded chemistry
  analytes are `quantity`; no catalog-driven vocabulary exists for what a `coded` value's valid
  options even are. Building `coded`/`text` input rendering now would be speculative UI for a shape
  with no real catalog backing — deferred until a real `coded`/`text` analyte exists.
- **Autosave triggers on blur, not on every keystroke.** Matches "autosave" as used by every other
  system with this pattern (save on losing focus, not per-character network calls) and is the
  natural moment in a keyboard-only Tab-driven flow — no debounce timer needed.
- **`Enter` finalizes the current field and advances focus; it does not also require a prior
  draft.** `finalizeResult` accepts the same value as draft (TASK-051's own design) — a user typing
  a value and immediately pressing Enter (never blurring first) still works correctly in one call.
- **Rows for `orderedTest.status === 'ordered'` (not yet received) are shown, disabled, with a
  "Not yet received" state** — matching KB-03's own ordering (result entry requires reception
  first, TASK-051's own `409` guard) — not hidden entirely, so the full panel's shape is still
  visible.
- **No new capability, no ADR** — `enter_result` already exists and is already used by TASK-051's
  own endpoints; this screen is a pure consumer.

## 6. Risks

- **Where the analyte metadata should live is a real API-shape decision, not just a UI concern** —
  raised as §10 Q1 rather than silently extending the catalog response, since it changes an
  already-shipped, multi-consumer endpoint's shape.
- **Focus management on Enter-to-advance is exactly the kind of interaction that's easy to get
  subtly wrong** (skipping an already-finalized row, or a row still mid-flight from a prior save) —
  §8's testing plan includes a real keyboard-driven `web-verify` pass specifically exercising this,
  not just a unit test of the advance-logic in isolation.
- **This is the first screen where a network call's *result* (live flags) must render back into the
  same row a user might have already tabbed away from** — a slow draft response arriving after the
  user has moved on (and possibly already started editing the next field) needs to update the
  correct row without disturbing focus or an in-progress edit elsewhere. Handled by keying all state
  updates by `orderedTestId`/`analyteId`, never by "the currently focused row."

## 7. Acceptance criteria

TASK-052's literal AC:
- [ ] A full chemistry panel is enterable without using the mouse — proven via a real, keyboard-only
  `web-verify` pass: Tab into the first field, type a value, Enter, repeat through every analyte in
  a real CMP order, confirm every row finalizes and the order's own `orderedTest` statuses reach
  `'resulted'`, with zero mouse interaction anywhere in the flow.

## 8. Testing plan

1. `pnpm --filter @lis/domain typecheck`/build with the extended `CatalogTest` schema.
2. `apps/api/test/catalog.e2e-spec.ts` — extended to assert the real seeded CMP tests' `analytes`
   arrays are populated and correctly shaped (real Postgres, not mocked).
3. The full existing `apps/api` e2e suite re-run and confirmed still green (an additive response
   field, no existing consumer's assertions should break — verified, not assumed).
4. `web-verify` (real headless Chromium, this sandbox's own missing-`libnss3.so` workaround): a real
   order → receive → results flow, keyboard-only, both light and dark mode; live flag rendering for
   an in-range, an out-of-range, and a critical value (a real Glucose/Sodium/Potassium/Calcium
   value, not synthetic); the "not yet received" disabled-row state; zero console/page errors.
5. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root, including Storybook's `a11y` check
   (this repo's CI-enforced a11y gate, TASK-037) for any new/changed `packages/ui` usage.

## 9. Rollback plan

Additive: one new route (`/orders/[id]/results`), one new Server Actions file, one extended
response field (`CatalogTest.analytes`, ignorable by every existing consumer). Rollback is
reverting the PR; no existing screen depends on the new field.

## 10. Questions requiring human approval

1. **How should the frontend learn each ordered test's required analyte(s) and their
   dataType/unit?** **Recommended:** extend `GET /v1/catalog`'s `CatalogTest` with an `analytes`
   array (`id`, `display`, `dataType`, `unit`) populated via `test_analyte` — reuses the endpoint
   every order-adjacent screen already fetches, rather than a new per-`orderedTest` call (which
   would mean up to 14 extra round trips just for metadata on a full-panel screen). The alternative
   (a new `GET /v1/ordered-tests/:id` endpoint) is a real option but adds a second read path for
   information the catalog already conceptually owns (which analytes a test definition produces).

**RESOLVED 2026-08-06 — extend `GET /v1/catalog`, as recommended.** Implementation begins now.

## 11. Real findings during implementation

**Real bug found in TASK-051's own already-merged output, fixed here since it directly blocks this
task:** `observation.controller.ts`'s two write routes declared `@Body() body: ResultEntryInput` —
a plain type alias, not a `createZodDto`-based class (a discriminated union can't be written as
`class X extends createZodDto(schema) {}`, since its inferred type is a union of object types, not
one the `extends` clause resolves to). `@nestjs/swagger`'s reflection had nothing to introspect from
a plain type alias, so the generated OpenAPI document silently had **no request body at all** for
either route (`requestBody?: never` in the generated SDK types) — this task's own frontend code
would have had zero compile-time safety on what it sent. Fixed per `nestjs-zod`'s own documented
pattern for non-extendable schemas: bind the DTO as a value (`const ResultEntryDto =
createZodDto(resultEntrySchema)`) and alias the type to its instance shape
(`type ResultEntryDto = InstanceType<typeof ResultEntryDto>`), rather than `extends` — `@nestjs/
swagger` reflects the real runtime class either way. Also added `.meta({ id: "ResultEntryDto" })` to
the schema itself so the generated OpenAPI component has a real name instead of a generic
`AugmentedZodDto`. Confirmed fixed by inspecting the regenerated `openapi.json`/`packages/sdk/src/
schema.ts` directly, not assumed from the code change alone — the discriminated union's three
variants now appear correctly as an OpenAPI `oneOf`.

Verified end-to-end: `apps/api/test/catalog.e2e-spec.ts` extended and green (the real seeded CMP's
analyte metadata, correctly shaped); the full existing 108-test `apps/api` e2e suite green (109/109
total, zero regression); repo-wide `typecheck`/`lint`/`build` green (including a real `next build`).
A real headless-Chromium `web-verify` pass (real Keycloak/Postgres/the compiled `apps/api` server,
real order → receive → enter-results flow against the seeded 14-test CMP panel): every one of the 14
analytes entered and finalized **keyboard-only** (Tab to the first field, then type-and-Enter
through the rest, zero mouse interaction — the auto-advance-to-next-row logic proven directly, since
a broken advance would have stopped the loop after the first row once that row's input became
disabled) — the literal AC. Live flags rendered correctly across the full severity range the real
panel data produced (`N`, `H`, `L`, `HH`, `LL`), `StatusPill`'s icon+color treatment confirmed
legible in both light and dark mode, and entered values persisted correctly across a fresh page
load. Zero console/page errors throughout.
