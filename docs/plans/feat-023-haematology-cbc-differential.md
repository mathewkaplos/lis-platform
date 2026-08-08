# Implementation Proposal: FEAT-023 Haematology CBC + differential
Status: **APPROVED**
ADR: adr-0020 (accepted 2026-08-08)    Date: 2026-08-08    Backlog ID: FEAT-023 (#32)

**Both §10 questions resolved via the native options-prompt, 2026-08-08** — recommended option
chosen for each: ADR-0020 accepted as drafted; TASK-071/072/073 created as real GitHub issues
alongside proposal approval.

## 1. Goal

M5 has four open, undivided features (FEAT-022, 023, 024, 025); none is `/develop`-ready. FEAT-023 was
chosen this session (`/orient`): it is the only `priority:critical` feature among them, its own
stated purpose is to "prove the metadata model generalizes to a second discipline at low marginal
cost," its sole dependency (FEAT-014, result entry engine) already shipped, and it is a hard blocker
for FEAT-024 (Peripheral film), which explicitly depends on it.

FEAT-023's issue names two ACs: "CBC panel enters correctly with age/sex-dependent ranges" and
"Differential sub-grid computes both % and calculated absolute counts correctly with flags." Its
Tasks section is unstarted, same "belongs to a rolling-wave milestone" state every M5 feature starts
in.

**Task decomposition (drafted this session, not yet created as GitHub issues — see §10 Q3):**
- **TASK-071 — Haematology catalog + reference ranges.** Seed `code_system_value`/`unit`/`analyte`/
  `test_definition`/`test_analyte`/`reference_range` rows for a CBC + 5-part differential panel
  (~15-20 analytes: Hb, RBC, HCT, MCV, MCH, MCHC, RDW, WBC, platelets, MPV, + 5 × {percentage,
  calculated absolute count} for neutrophils/lymphocytes/monocytes/eosinophils/basophils), with
  age/sex-banded reference ranges — same "standard published intervals, explicitly labeled
  placeholder, not partner data" discipline `chemistry-catalog.sql`/`clinical-chemistry` entry #1
  already established. No new schema, no new resolver code (`domain/reference-ranges` entries #1-10
  already generalize across every dimension this needs).
- **TASK-072 — Calculated absolute-count formulas.** Extend `packages/domain/src/
  calculated-fields.ts`'s `CALCULATED_ANALYTES` registry with five new entries (one per differential
  cell type), per ADR-0020 Decision 1 — `absolute = (percentage / 100) × WBC`, mirroring the existing
  eGFR/LDL entry shape exactly (`outputLoincCode`, `inputLoincCodes: [<cell%>, <WBC>]`, `formula`,
  `compute`). No new mechanism; this is data, not new code shape.
- **TASK-073 — CBC/differential result-entry UI verification.** Per ADR-0020 Decision 3, the existing
  `results-grid.tsx` (quantity-only rendering, already generalized) needs **no code change** to
  display CBC/differential rows — they are ordinary `quantity` rows, same as chemistry's. This task is
  real verification work (Stitch §12.1 CBC Entry prompt, `web-verify` pass confirming the grid
  actually renders ~25 haematology rows correctly with live flags, in both light/dark, against a real
  seeded order), not new frontend code — the same "prove it, don't assume it" discipline TASK-069
  applied to `DataTable` reuse.

**Real, load-bearing finding from this proposal's own research, not present in FEAT-023's issue
text or in KB-19 concretely enough to build against directly:** KB-19 describes the differential as
a `table`-typed Observation plus discrete atoms — but neither the `table` dataType nor the `ordinal`
dataType (needed for KB-19's morphology capture, out of scope here per FEAT-024) has ever been
exercised end-to-end anywhere in this repo; the result-entry API and UI are both explicitly,
deliberately scoped to `quantity | coded | text` only (TASK-051's own comment). **ADR-0020** (drafted
alongside this proposal, Status: proposed) resolves this: the differential is modeled as discrete
`quantity` Observation pairs (percentage + calculated absolute count) per cell type, reusing the
already-proven calculated-analyte mechanism (TASK-053) instead of building `table` support from zero.
TASK-071/072 cannot start until ADR-0020 is accepted (§10 Q1).

**Second finding:** morphology (`ordinal`) capture is explicitly out of scope — FEAT-024's own AC is
the first real `ordinal` consumer, not FEAT-023's. `domain/haematology` Skill entry #3 (drafted this
session) records this narrowing.

**Third finding:** `domain/haematology` — the Skill FEAT-023's own issue names under "Required
Skills" — did not exist anywhere in `lis-engineering` before this session (confirmed by `ls`). Drafted
this session (5 entries, UNREVIEWED, mirroring `domain/clinical-chemistry`'s own FEAT-014-era
precedent) as part of this proposal's research, not a separate follow-up.

## 2. Affected files

- `lis-engineering/adr/adr-0020-haematology-differential-as-discrete-quantity-observations-not-table-datatype.md`
  (new, this session) — must be **accepted** before TASK-071/072 are built (§10 Q1).
- `lis-engineering/skills/domain/haematology/SKILL.md` (new, this session) — required reading for all
  three tasks.
- `db/seed/haematology-catalog.sql` (new, TASK-071) — `code_system_value` (LOINC analyte codes, UCUM
  units), `unit`, `analyte` (~20 rows: 10 direct CBC parameters + 10 differential percentage/absolute
  pairs), `test_definition`/`panel_test`/`test_analyte` (a "CBC + Differential" orderable panel,
  mirroring `chemistry-catalog.sql`'s own panel-wiring pattern).
- `db/golden/haematology-ranges-criticals.json` (new, TASK-071) — age/sex-banded reference ranges +
  critical thresholds (severe anaemia, critical thrombocytopenia, critical leukocytosis/leukopenia —
  KB-19's named haematology criticals), mirroring `chemistry-ranges-criticals.json`'s shape; feeds the
  existing golden-dataset CI check (TASK-026) unchanged.
- `packages/domain/src/calculated-fields.ts` (modify, TASK-072) — five new `CALCULATED_ANALYTES`
  entries per ADR-0020 Decision 1.
- `apps/api/test/calculated-fields.e2e-spec.ts` (modify, TASK-072) — five new boundary/computation
  cases (including a WBC = 0 / missing-input suppression case, mirroring `computeLdl`'s existing
  triglyceride-guard suppression pattern).
- `apps/api/test/haematology-catalog.e2e-spec.ts` (new, TASK-071) — golden-dataset-shaped coverage:
  every seeded haematology analyte resolves a correct range for at least one sex/age combination
  (mirrors `qc-westgard.e2e-spec.ts`'s "prove the data, not just the code" precedent).
- No changes to `packages/domain/src/observation.ts` (`resultEntrySchema`), no changes to
  `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` — per ADR-0020 Decision 3, both already
  handle `quantity` rows generically; TASK-073 is verification, not modification.

## 3. Architecture consulted

- KB-19 Haematology — primary; scope, differential/morphology modeling, criticals.
- ADR-0020 (this session) — the concrete differential-storage decision.
- ADR-0006 (observation `data_type` native enum) — confirms `table`/`ordinal` already exist as enum
  members, informing why ADR-0020 can defer them without a schema change either way.
- `domain/haematology` Skill (this session) — primary, all five entries.
- `domain/reference-ranges` — entries #1, #3, #4, #7 (resolver already generalized; age/method golden-
  dataset gap discipline carries over identically).
- `domain/clinical-chemistry` — entry #1 (placeholder-seed precedent), entry #3 (calculated-analyte
  precedent this feature directly reuses).

## 4. Skills loaded

- `domain/haematology` — primary, all five entries (this session's draft).
- `domain/reference-ranges` — range-resolution mechanics TASK-071's seed data must satisfy correctly;
  entry #4's "prove sex/condition against real data, age/method against synthetic labeled fixtures"
  pattern applies identically to the new haematology golden dataset.
- `domain/clinical-chemistry` — entry #3's calculated-analyte gap (now closed by TASK-053) is the
  direct precedent TASK-072 extends.
- `engineering/database-design` — seed-file/golden-dataset convention (mirrors TASK-019/027 exactly,
  no new pattern).
- `engineering/testing` — e2e coverage conventions (`describe` blocks, golden-dataset CI check).

## 5. Assumptions & autonomous decisions

- **Differential as discrete `quantity` Observations, not `table`.** Per ADR-0020 — raised as §10 Q1
  since it's a genuine architectural fork from KB-19's literal text with real, if modest, consequences
  (no single-row differential shape for a future consumer), not a pure implementation detail.
- **Morphology (`ordinal`) fully out of scope.** Matches FEAT-024's own explicit dependency
  relationship; not raised as a question, since the issue bodies themselves already establish this
  split.
- **Standard/textbook CBC reference ranges, not design-partner data.** Same precondition as
  `chemistry-catalog.sql` (TASK-019) — no design-partner lab exists yet anywhere in this project as of
  2026-08-08 (re-confirmed this session). Explicitly labeled placeholder in the seed file header, per
  existing convention; not raised as a question since TASK-019/027 already established this exact
  precedent and got it approved.
- **Five differential cell types only (neutrophils, lymphocytes, monocytes, eosinophils, basophils) —
  no bands, no nucleated RBCs, no blast percentage as a separate reportable line.** Matches a standard
  5-part differential analyzer output (KB-19's own "5-part diff" framing); a 6-part diff (adding
  immature granulocytes) or manual-differential-only findings (bands, blasts) are real future
  catalog work, not this feature's scope, since FEAT-023's AC says "differential," not "manual
  differential" or "6-part."
- **No new capability, no new HTTP route.** Both tasks in code (TASK-072) extend an existing pure
  function registry and an existing catalog seed path — the existing `enter_result` capability guard
  on result-entry routes is unchanged.

## 6. Risks

- **ADR-0020 is not yet accepted.** Single blocking dependency for TASK-071/072, raised as §10 Q1, not
  assumed.
- **No real haematology clinical data exists to validate ranges/criticals against** (same class of
  risk `domain/reference-ranges` entry #4 and `clinical-chemistry` entry #1 already carry for
  chemistry) — correctness rests on published reference intervals (ICSH-style, cited in the seed file)
  rather than partner-reviewed data. Higher stakes than the differential-formula risk below, since
  these ARE real patient-facing reference ranges/criticals, not QC-internal signals — flagged plainly,
  same discipline as chemistry's own placeholder labeling.
- **`analyte.dataType` has no DB-level CHECK against `observation.data_type`'s enum** (`domain/
  haematology` entry #5) — a typo in the new seed file would insert successfully and fail silently
  later. Mitigated by TASK-071's own e2e coverage asserting every seeded analyte's `dataType` resolves
  correctly end-to-end, not by a schema change (out of scope, pre-existing, tracked as a general gap
  not specific to this feature).
- **Age-banded paediatric CBC ranges are clinically more consequential to get wrong than chemistry's
  adult-only ranges were** — CBC reference intervals vary significantly by age in ways chemistry's
  seeded CMP mostly didn't need to model yet. TASK-071 must cite a real published source per age band,
  not extrapolate; if a needed age band can't be sourced confidently, state the gap plainly (per
  `reference-ranges` entry #4's "narrower than golden-dataset-provable" pattern) rather than
  fabricate a value.

## 7. Acceptance criteria

- [ ] Every CBC parameter (Hb, RBC, HCT, MCV, MCH, MCHC, RDW, WBC, platelets, MPV) is a seeded
  `quantity` analyte with at least adult M/F reference ranges, correctly resolved by the existing
  resolver (no resolver code change).
- [ ] Each of the 5 differential cell types resolves to a percentage `quantity` Observation (entered)
  and a calculated absolute-count `quantity` Observation (`source: 'calculated'`), both independently
  range-resolved and flagged.
- [ ] Calculated absolute counts compute correctly (`percentage / 100 × WBC`), rounding matching
  existing `calculated-fields.ts` convention, with a defined suppression behavior when WBC is missing
  or zero.
- [ ] At least the KB-19-named haematology criticals (severe anaemia, critical thrombocytopenia,
  critical leukocytosis/leukopenia) exist as `rangeType: 'critical'` rows and correctly produce
  HH/LL flags.
- [ ] A real order for the new CBC+Differential panel renders all ~25 rows correctly in
  `results-grid.tsx` with live flags, verified via `web-verify` in both light/dark mode, zero console
  errors — no frontend code change, verification only.
- [ ] Golden-dataset CI check (TASK-026) passes against the new `haematology-ranges-criticals.json`
  file, same mechanism as chemistry's.
- [ ] Every existing `apps/api` e2e test still passes unchanged — zero regression.

## 8. Testing plan

1. `apps/api/test/haematology-catalog.e2e-spec.ts` (new) — golden-dataset-shaped range-resolution
   coverage for every seeded analyte, at least one sex/age combination each; critical-range HH/LL
   cases for the KB-19-named criticals.
2. `apps/api/test/calculated-fields.e2e-spec.ts` (modified) — five new differential formula cases,
   including the WBC-missing/zero suppression case.
3. `pnpm --filter @lis/db typecheck`/build; migration N/A (no schema change — pure seed data).
4. Golden-dataset CI check re-run against the new JSON file (existing TASK-026 mechanism, no changes
   needed to the checker itself).
5. `web-verify` pass: seed a real haematology order, enter/view results in `results-grid.tsx`, confirm
   all rows render with correct flags in both light and dark mode, zero console errors.
6. Full existing `apps/api` e2e suite re-run and confirmed still green.
7. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root, including a real `next build`/`nest
   build`.

## 9. Rollback plan

Additive only: new seed/golden-dataset files (delete them), five new registry entries in
`calculated-fields.ts` (remove them — pure function additions, no state). No schema migration, no
existing column or route modified. Reverting the PR(s) is clean; no production data exists at this
milestone (same precondition every prior M5 feature has relied on).

## 10. Questions requiring human approval

1. **Is ADR-0020 (differential as discrete `quantity` Observations — percentage + calculated absolute
   count per cell type — not the `table` dataType) approved as written?** This blocks TASK-071/072
   entirely. Recommended: accept as drafted — it reuses fully-proven infrastructure (TASK-053's
   calculated-analyte mechanism, TASK-049's generalized range resolver) at genuinely lower risk than
   building an unproven `table`/`valueJson` shape and new API/UI handling for it, and FEAT-023's own
   literal AC doesn't require a single-table differential view. The `table` dataType is explicitly
   deferred, not foreclosed, for whichever future feature (likely a Microbiology antibiogram grid)
   becomes its first real consumer.
2. **Is the `domain/haematology` Skill (drafted this session, UNREVIEWED) an accurate enough starting
   point to proceed on?** It will be reaffirmed/corrected against real code once TASK-071/072/073 are
   actually built, same "UNREVIEWED until implementation" convention `domain/clinical-chemistry` used
   for FEAT-014.
3. **Should TASK-071/072/073 be created as real GitHub issues now**, alongside proposal approval — the
   same sequencing every prior M5 feature kickoff (FEAT-019, FEAT-020, FEAT-021) has used? Recommended:
   yes, now.
