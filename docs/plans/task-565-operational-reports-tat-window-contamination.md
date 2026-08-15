# Implementation Proposal: Fix timing-fragile TAT assertions in `operational-reports.e2e-spec.ts`
Status: APPROVED
ADR: none    Date: 2026-08-15    Backlog ID: issue #565 (lis-platform)

**Approved 2026-08-15** via the native options-prompt (accepted as scoped in §10 — assertion-scoping
fix, not the dedicated-tenant alternative).

## 1. Goal
Fix the intermittent failure in `apps/api/test/operational-reports.e2e-spec.ts`'s `'computes real
TAT by priority and by test, with real SLA-percentage math'` test, observed 3 times across 3
unrelated feature PRs (FEAT-059/060/061) only when running as part of the full ~58-file e2e suite,
never in isolation.

**Root cause is corrected here relative to issue #565's own filed theory**, per AGENTS.md's "verify
precedent, don't trust a plausible-sounding claim" rule — read directly from
`computeTatReport` (`apps/api/src/report/operational-reports.service.ts:82-166`), not assumed:

- Issue #565's theory: real wall-clock time elapsing between the fixture's `Date.now()`-relative
  backdate and the later finalize/verify steps pushes the computed TAT outside its ~60s tolerance
  window.
- **What the code actually shows:** `computeTatReport`'s `byPriority` bucket aggregates **every**
  `ordered_test` row in the tenant (RLS-scoped, not scoped to this fixture's own
  `testDefinitionId`) whose `createdAt` falls inside the query window — currently `[now-100min,
  now-2min]`, a ~98-minute-wide window. `engineering/testing` Skill entry #13 already fixed one
  contamination symptom this same window shape caused (`routineRow.count` coming back 29, not 1)
  by excluding real "now" from the window's upper bound. That fix stops rows created *after* this
  file's own `beforeAll` window is computed from leaking in, but does nothing about **other spec
  files' own `routine`-priority `ordered_test` rows created earlier in the same full-suite run**
  (or `sla-breach.e2e-spec.ts`'s own deliberately-backdated fixtures, per this file's own existing
  comment on `byPriority`'s `count` assertion) — those still land inside the wide backward-looking
  window and get folded into the same `routine`/`stat` bucket's `mean`/`median`/`withinTargetPct`.
  Under full-suite load, enough near-zero-TAT `routine` rows from unrelated spec files can dilute
  the bucket's mean far below this fixture's own 5-minute backdate — matching the actual observed
  failure (`0.19–0.63` minutes, i.e. diluted toward zero, not pushed upward as #565's theory would
  predict).
- `byTest`'s assertions (scoped to this fixture's own unique `testDefinitionId`, which no other
  spec file shares) are already structurally immune to this — the file's own comment above the
  `byPriority` count assertion says as much. `byPriority`'s `count` was already loosened to a floor
  for the identical reason; `meanMinutes`/`medianMinutes`/`withinTargetPct` were not.

This proposal loosens the still-fragile `byPriority` value assertions the same way `count` already
was, and moves exact-value proof of `withinTargetPct`'s arithmetic to a pure unit test — consistent
with this file's own already-established `mean`/`median` pattern — rather than widening tolerances
or making the backdate timestamp deterministic (neither addresses the actual contamination
mechanism).

## 2. Affected files
- `apps/api/src/report/operational-reports.service.ts` — extract the inline `withinTargetPct`
  calculation (currently inlined in `computeTatReport`, lines ~171-174) into its own exported pure
  function `computeWithinTargetPct(values: number[], targetMinutes: number | undefined): number |
  null`, mirroring the already-exported `mean`/`median` pattern (same file, lines 27-37) and its own
  stated rationale ("this pure math doesn't [need a real tx]").
- `apps/api/src/report/operational-reports.service.spec.ts` — add unit tests for
  `computeWithinTargetPct` (no DB), covering: values below/above/at target, an empty-values edge
  case matching current `NaN`-avoidance behavior (guarded by `values.length` — confirm actual
  current guard, see §5), and `target === undefined` returning `null`.
- `apps/api/test/operational-reports.e2e-spec.ts` — loosen `routineRow`/`statRow`'s `meanMinutes`
  and `withinTargetPct` assertions (byPriority) to structural/plausible checks (e.g.
  `toBeGreaterThan(0)`, `toBeGreaterThanOrEqual(0)` / `toBeLessThanOrEqual(100)` or removed in favor
  of the already-scoped `byTestRow` and the new unit test), with a comment explaining why,
  referencing this proposal and `engineering/testing` Skill entry #13. `byTestRow`'s existing tight
  `meanMinutes` assertions are unchanged (already correctly scoped, already the real proof).
- `~/work/lis-engineering/skills/engineering/testing/SKILL.md` — new entry (adding to the #13
  "time-window contamination" family, not overwriting it) documenting that a window-exclusion fix
  for *count* contamination does not also fix *aggregate-value* contamination on a bucket that
  isn't scoped to the fixture's own unique identity, and that the fix is either (a) scope the
  assertion to a fixture-unique bucket (`byTest`, here) or (b) extract the pure math and unit-test
  it directly, not widen tolerances or tighten timestamps.

## 3. Architecture consulted
- `engineering/testing` Skill entry #1 (real-Postgres checks belong in e2e specs; pure math in
  Vitest units) and entry #13 (time-window fixture contamination under full-suite runs) — both
  directly on point, no other KB/ADR governs test-fixture design.
- No ADR needed: test-only change plus a same-file, same-module pure-function extraction with no
  behavior change to the production `computeTatReport` output (the extracted function computes the
  identical value it replaces inline).

## 4. Skills loaded
- `engineering/testing` (entries #1, #13 — directly on point; this proposal both applies and
  extends them)
- `engineering/api-design` (not required — no new route or DTO added, per `plan` Skill's own
  triggering rule)

## 5. Assumptions & autonomous decisions
- Assume the current inline `withinTargetPct` guard (`target === undefined ? null : (...)`) has no
  separate empty-`values`-array guard beyond what `byPriority`'s own `Array.from(...).map(...)`
  already structurally prevents (a bucket only exists in the map if at least one row pushed into
  it, so `values.length` is never 0 when this runs today) — the new unit test will cover
  `values.length === 1` and a mix of within/outside-target values, not a genuine empty array, unless
  reading the extraction reveals the guard is reachable with an empty array, in which case the test
  will cover that too.
- `byTest`'s type (`TatReport['byTest']`) is left unchanged (no `withinTargetPct` field added to
  it) — extending the byTest shape to carry `withinTargetPct` would be a real API/DTO change
  (`@lis/domain`, `@lis/sdk` regeneration, `apps/web` consumers) out of proportion to a test-fixture
  fix, and the pure unit test already gives exact-value proof of the arithmetic without it.
- The loosened `byPriority` assertions keep asserting `count >= 1` and a plausible numeric range
  (not deleted outright) — still proving the report returns *some* real, positive, well-formed
  bucket for both priorities under real data, just not an exact mean tied to a bucket that can't be
  isolated from full-suite contamination.

## 6. Risks
- Loosening the `byPriority` `meanMinutes` assertion trades some precision for stability — a real
  regression that shifted `computeTatReport`'s `byPriority` math (as opposed to `byTest`'s, still
  tightly checked) could theoretically go undetected at the e2e layer. Mitigated by the new unit
  test covering the exact `withinTargetPct` arithmetic directly, and by `byTest`'s `meanMinutes`
  exercising the same underlying per-row TAT computation (`completedAt.getTime() -
  row.createdAt.getTime()`) that both buckets share — only the aggregation *grouping*, not the
  per-row math, differs between `byPriority` and `byTest`.
- The fix must be verified against the real full e2e suite (not just this file in isolation, which
  already passes today and never demonstrated the bug) — per AGENTS.md's "a pass in one harness
  doesn't prove a pass in another," isolation-only testing is exactly what let this ship unnoticed
  three times already.

## 7. Acceptance criteria
- `computeWithinTargetPct` exists as an exported pure function in `operational-reports.service.ts`,
  used by `computeTatReport`, with no change to `computeTatReport`'s actual return values for any
  existing caller.
- New unit tests in `operational-reports.service.spec.ts` cover `computeWithinTargetPct` directly
  (below/above/at target, `target === undefined`).
- `operational-reports.e2e-spec.ts`'s `byPriority` `meanMinutes`/`withinTargetPct` assertions no
  longer assert a narrow, contamination-vulnerable exact range; `byTestRow`'s existing precise
  assertions are untouched.
- The full e2e suite (`pnpm --filter api test:e2e`, real Postgres/Keycloak, `fileParallelism:
  false`) passes, run at least twice back-to-back to gain real confidence against the intermittency
  this issue describes (a single green run doesn't distinguish "fixed" from "didn't get unlucky
  this time").
- `engineering/testing` Skill gains the new entry described in §2, committed to `lis-engineering`
  main same-day per AGENTS.md's own same-day-Skill-authoring rule.
- Issue #565 closed with a comment noting the corrected root cause (contamination of an
  un-scoped aggregate bucket, not backdate-to-verify elapsed time) alongside the fix.

## 8. Testing plan
1. `pnpm --filter api test` (unit) — new `computeWithinTargetPct` tests pass.
2. `pnpm --filter api test:e2e` (real DB/Keycloak, full suite) — run twice consecutively; both must
   pass, specifically `operational-reports.e2e-spec.ts`'s TAT test.
3. Typecheck/lint (`pnpm typecheck`, `pnpm lint`) clean — the extraction touches a shared service
   file.
4. No `apps/web`/`@lis/sdk` changes expected (no DTO/route shape change) — confirm no regeneration
   is needed by checking `openapi.yaml`/`schema.ts` are untouched by the diff.

## 9. Rollback plan
Test-only + same-file pure-function extraction with no production-facing behavior change; revert
the commit if the new unit tests or e2e run surface a problem. No migration, no deploy-order
concern, no data involved.

## 10. Questions requiring human approval
1. **Approve this proposal (Status: DRAFT → APPROVED) to proceed with implementation as scoped
   above** — specifically: loosening `byPriority`'s value assertions rather than pursuing a
   heavier structural fix (e.g. giving this spec file its own dedicated tenant so no other spec's
   `routine`/`stat`-priority activity can ever land in its window at all)? The dedicated-tenant
   approach would be more thorough but is a materially bigger change (new Keycloak test realm
   users/tenant fixtures) for a test-only reliability fix, and this repo's own `byTest` precedent
   already establishes "scope the assertion, not the whole environment" as the accepted pattern.
