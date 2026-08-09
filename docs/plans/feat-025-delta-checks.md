# Implementation Proposal: FEAT-025 — Delta checks
Status: APPROVED
ADR: adr-0023 (accepted)    Date: 2026-08-09    Backlog ID: FEAT-025 (#34)

§10's open questions were resolved by the human via the native options-prompt, all recommended
options chosen: **Q1** new tenant-scoped `delta_check_rule` table. **Q2** percent-only threshold in
v1. **Q3** unbounded prior lookback in v1. **Q4** yes, draft an ADR now — see `adr-0023`
(`~/work/lis-engineering/adr/adr-0023-delta-check-rule-is-a-new-tenant-scoped-percent-only-table-unbounded-prior-lookback.md`),
drafted alongside this proposal and **accepted 2026-08-09**, same session, alongside this
proposal's own approval.

## 1. Goal

FEAT-025's literal AC (issue #34): "A result exceeding the configured delta threshold from the
prior value surfaces an inline plausibility warning." KB-14 (Result Engine) names this as pipeline
step 4 of validation: "compare to the most recent prior verified Observation for the same
patient+analyte; excessive change sets flag `D` and routes to review" — with a worked example
(prior K⁺ 4.1 → today's 6.9, no clinical change, haemolysis flag → `D` + `HH` → routed to review).

This is a real, previously-identified, explicitly-deferred gap, not a new idea. FEAT-015's own
TASK-057 proposal (`docs/plans/feat-015-verification-criticals.md:1035`) found: **"'delta' has no
supporting computation anywhere in this codebase"** and closed §10 Q1 as "prior result only, no
computed delta... since nothing like that exists anywhere in this codebase to build on." FEAT-025
is the feature that was always meant to fill that gap — its one dependency, FEAT-015, is fully
merged.

**Scope is deliberately narrow, matching this repo's established "narrower than the literal AC
text, with the gap stated plainly" pattern** (used by FEAT-013, and by `reference-ranges` Skill
entry #4 for age/method dimensions): compute a `D` flag and persist it on the Observation at
write time, and render it in the results grid. No auto-verify gating (FEAT-031, "Auto-verification
deny-by-default," is M6, not started — there is no auto-verify path to block yet, so KB-14's
"blocked from auto-verify" clause is not literally buildable today, same class of finding as
TASK-057's own QC finding). No finalization block (unlike criticals, the AC does not ask for one).

## 2. Affected files

**New:**
- `db/migrations/00xx_delta_check_rule.sql` — new tenant-scoped table (see §5/§10 Q1), RLS policy
  in the same migration (Constitution invariant 4).
- `packages/db/src/schema/delta-check-rule.ts` — Drizzle schema for the above.
- `db/seed/delta-check-thresholds.sql` (or added to existing chemistry/haematology seed files) —
  seed rows for the analytes that already have critical thresholds (Glucose, Sodium, Potassium,
  Calcium — `db/seed/chemistry-catalog.sql`), marked `PLACEHOLDER — NOT PARTNER-VALIDATED` per this
  repo's existing convention (`db/golden/chemistry-ranges-criticals.json`'s own header).
- `packages/db/src/delta-check.ts` — `resolveDeltaCheck(tx, {patientId, analyteId, valueNum,
  producedAt})`, mirroring `reference-range.ts`'s shape: looks up the most recent prior
  **verified** Observation for the same `(patientId, analyteId)` (reuses `ix_obs_trend`,
  `packages/db/src/schema/observation.ts:117` — already indexed on exactly
  `(tenantId, patientId, analyteId, producedAt)`, built for this), looks up the analyte's
  `delta_check_rule` row, and returns `{flagged: boolean, previousObservationId: string | null,
  priorValue: number | null, percentChange: number | null}`.
- `db/golden/delta-check-thresholds.json` — golden fixture proving seed matches config, mirroring
  `db/golden/chemistry-ranges-criticals.json`'s TASK-027 pattern.

**Modified:**
- `packages/db/src/flagging.ts` — `computeFlags`'s own doc comment (lines 3-7) already anticipated
  this: `text[]` "so a future task can still append `A`/`D`/`R` alongside." Add a sibling function
  or extend the call site to merge `'D'` into the array this function returns, without changing
  its existing `N|L|LL|H|HH` behavior.
- `apps/api/src/observation/observation.controller.ts` — `resolveRangeAndFlags` (line 260) is the
  existing single call site where flags are computed "on every write, draft or final" (its own
  comment, lines 254-258); add the delta-check call here, merge `'D'` into the returned `flags`
  array, and set `previousObservationId` on the write (the column already exists —
  `packages/db/src/schema/observation.ts:104`, `// delta/trend chain` — and has never been set by
  any business code path, confirmed by repo-wide grep during this proposal's research).
- `packages/domain/src/observation.ts` — `observationSchema`'s `flags: z.array(z.string())` (line
  72) needs no change (already unconstrained). Consider widening `ObservationResult` with
  `priorValue`/`percentChange` if the UI warrants showing the actual delta, not just the flag
  (see §10 Q2).
- `packages/ui/src/components/status-pill.tsx` — `ResultFlag` (line 8) is currently
  `"N" | "H" | "L" | "HH" | "LL" | "A"` — **does not include `'D'`**. Add `"D"` to the union and a
  `FLAG_META.D` entry (label "Delta", a distinct icon/color from `A` so the two aren't visually
  confused).
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` — `isFlag()` (line 83) is a hard
  whitelist that silently drops any flag not in `N|H|L|HH|LL|A` — **without this change, a
  backend-computed `'D'` flag would compute correctly and then vanish before rendering**, a real
  bug this proposal must not introduce. Add `'D'` to the whitelist. The stale comment at line 333
  ("no computed delta/percent-change (unconditionally out of scope)") describes a decision this
  feature reverses — update or remove it.

**Not touched:** `finalize()`/`verify()` gating logic (result-verification Skill entries #5/#8) —
no new 409 path; the `prior()` endpoint (`observation.controller.ts:960`) — remains the separate,
already-shipped read-only "show prior value(s)" feature, untouched by this proposal's own delta
computation.

## 3. Architecture consulted

- KB-14 Result Engine (`/mnt/d/LIS/research/14-result-engine.md`) — validation pipeline step 4,
  worked example, `previousObservationId` field definition.
- Constitution invariant 4 (tenant isolation is structural, RLS from the creating migration) —
  governs the new `delta_check_rule` table.
- `docs/plans/feat-015-verification-criticals.md` (TASK-057 revision, lines 1035-1052) — the
  direct predecessor finding that this feature exists to close.

## 4. Skills loaded

- `domain/reference-ranges` — the closest existing analogue (tenant-scoped, per-analyte,
  metadata-configurable threshold table with an existing resolver pattern to mirror).
- `domain/result-verification` — entry #6 (previousObservationId vs amendmentOf, do not conflate),
  entry #8 (finalized-status matching discipline, relevant if a future task ever gates on delta).

## 5. Assumptions & autonomous decisions

- **Compare only against `status = 'verified'` prior Observations**, per KB-14's literal wording
  ("most recent prior verified Observation"), not `preliminary`. A not-yet-verified prior value
  could itself still be corrected/wrong — comparing against it would produce a delta check with no
  real clinical grounding.
- **`computeFlags`'s existing severity-flag behavior (`N|L|LL|H|HH`) is unchanged.** `D` is
  additive — a value can be simultaneously `H` (out of normal range) and `D` (an implausible jump),
  matching KB-14's own example (`D` + `HH` together).
- **No time window on "most recent prior" in v1** — reuses the same unbounded-lookback semantics
  the existing `prior()` endpoint already established (`PRIOR_OBSERVATION_LIMIT`,
  `packages/domain/src/observation.ts:119`), for consistency rather than inventing a second
  lookback policy. Flagged as a real limitation in §10 Q3, not silently assumed correct.
- **This task populates `observation.previousObservationId`** on write, turning the dormant column
  (KB-14: "for delta/trend linkage") into a real, populated trend-chain pointer for the first time
  — a natural, low-risk extension of work this proposal is already doing (the delta-check lookup
  already finds that exact row), not scope creep.
- **Boundary inclusivity: a change exactly at the threshold flags `D`** (inclusive), mirroring
  `computeFlags`'s own resolved precedent for normal/critical boundaries (TASK-050 proposal §10 Q1,
  `flagging.ts:22-24`: "inclusive both ways").

## 6. Risks

- **Silent-drop risk, already identified in §2:** if the frontend whitelist (`isFlag`) isn't
  updated in the same PR as the backend flag computation, `D` will compute correctly server-side
  and never render — a real bug class this repo has hit before with unconstrained `text[]` flags
  reaching a hardcoded frontend union. Both changes must land together.
- **Fabricated clinical thresholds:** like `chemistry-ranges-criticals.json` (TASK-027) before it,
  seeded delta thresholds are placeholder values, not partner-validated. Must be labeled as such,
  not presented as clinically authoritative.
- **New tenant-scoped table needs its own RLS policy from the creating migration** (Constitution
  invariant 4, non-negotiable) — a real, easy-to-get-wrong step if copied carelessly from a
  non-tenant-scoped table like `analyte`/`unit` (`packages/db/src/schema/catalog.ts:1-6`, which are
  explicitly RLS-exempt global reference tables per ADR-0004 — the wrong pattern to copy here).

## 7. Acceptance criteria

- [ ] A result whose absolute percent change from the most recent verified prior result (same
      patient + analyte) exceeds the analyte's configured threshold gets flag `D` appended to
      `observation.flags`, alongside any severity flag already present.
- [ ] `observation.previousObservationId` is set to the compared-against row's id whenever a delta
      check runs (a comparison happened), `null` when no eligible prior exists.
- [ ] The results grid renders a `D` status pill distinct from existing flags; it is not silently
      dropped.
- [ ] An analyte with no configured `delta_check_rule` row never gets a `D` flag (no fabricated
      threshold) — mirrors `reference-ranges`'s own "no_range... never silently treated as normal"
      discipline, applied to the absence of a delta rule.
- [ ] RLS isolation test added for `delta_check_rule` (new tenant-scoped table).
- [ ] Golden-dataset test proving seeded thresholds match `db/golden/delta-check-thresholds.json`.

## 8. Testing plan

- Unit tests for `resolveDeltaCheck`: no prior exists (null case), prior exists but no rule
  (no-flag case), prior + rule + change under threshold (no flag), over threshold (flag +
  `previousObservationId` set), boundary-exact value (inclusive/exclusive — resolved in §10 Q4).
- e2e: draft/finalize a result for an analyte with an existing verified prior result exceeding
  threshold → assert `D` in response `flags`. RLS isolation test for `delta_check_rule` (standard
  cross-tenant-invisibility pattern already used for `reference_range`).
- `web-verify`: confirm the `D` pill actually renders in a real browser session, not just in the
  API response — directly protects against the silent-drop risk in §6.

## 9. Rollback plan

Additive only: new table, new column usage (existing dormant column), new flag value in an
already-unconstrained `text[]`. Revert is a straightforward PR revert; no destructive migration
(the new table can be dropped cleanly if unused). No existing behavior changes for analytes with no
configured delta rule.

## 10. Questions requiring human approval

**Q1 — How should per-analyte delta thresholds be stored?** No delta-threshold config exists
anywhere today (`analyte`, `packages/db/src/schema/catalog.ts:30`, has no such column; grepped
repo-wide, zero hits). Options: (a) a new tenant-scoped `delta_check_rule` table, mirroring
`reference_range`'s existing tenant-customizable pattern — **recommended**, since KB-14 explicitly
calls delta thresholds "metadata-configurable per analyte/discipline/tenant," same requirement
`reference_range` was built for; (b) hardcode threshold constants in application code — rejected,
contradicts KB-14 and this repo's own established metadata-driven pattern; (c) add delta columns
directly onto `analyte` — rejected, conflates global reference data (ADR-0004: `analyte` is
tenant-identical) with genuinely tenant-customizable config.

**Q2 — Percent change, absolute change, or both?** KB-14's own example is a raw-value jump (K⁺ 4.1
→ 6.9, +68%) but doesn't mandate a basis. **Recommended: percent-only for v1** (a single
`thresholdPercent` column) — works uniformly across differently-scaled analytes without a second
"floor" concept to design now; absolute-change support is real, deferred future work if a specific
analyte needs it (e.g. one where percent alone is unreliable near zero).

**Q3 — Time window on "most recent prior," or unbounded lookback?** v1 assumption (§5) is
unbounded, matching the existing `prior()` endpoint. Real lab practice often bounds delta checks to
a clinically meaningful interval (a multi-year-old prior value isn't a meaningful comparison).
**Recommended: unbounded for v1** (matches existing precedent, smaller scope, real limitation
stated plainly here rather than silently assumed) with time-windowing as explicit, named future
work — not blocking this feature's own narrow AC.

**Q4 — Should an ADR be drafted for the new `delta_check_rule` table before this proposal is
approved for implementation?** This introduces a new tenant-scoped-table + RLS pattern into the
schema and decides percent-vs-absolute/time-window semantics that will likely govern every future
discipline's delta checks, not just this feature's own chemistry/haematology scope — the kind of
load-bearing decision the feature issue itself flags ("write one if a load-bearing decision is
discovered during planning"). **Recommended: yes** — I can draft it now, alongside this proposal,
for your review in the same pass.
