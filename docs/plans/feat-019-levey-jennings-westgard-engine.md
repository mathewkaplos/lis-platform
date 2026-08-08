# Implementation Proposal: FEAT-019 Levey-Jennings + Westgard engine
Status: **TASK-067 + TASK-068 IMPLEMENTED**. TASK-069 (#374) will get its own revision to this file
once its preceding task is real, per FEAT-018's own precedent.
ADR: adr-0018 (accepted 2026-08-08)    Date: 2026-08-08    Backlog ID: FEAT-019 (#28) / TASK-067 (#372) / TASK-068 (#373) / TASK-069 (#374)

**Both §10 questions resolved via the native options-prompt, 2026-08-08** — recommended option
chosen for each: ADR-0018 accepted as drafted; TASK-067/068/069 created as real GitHub issues
(#372/#373/#374) alongside proposal approval.

**TASK-067 (Westgard multirule evaluation engine), 2026-08-08.** Delivered exactly per §2's
affected-files list, with two real corrections found during implementation (both noted inline where
they occurred, not silently absorbed): no standalone `packages/domain/src/qc-westgard.test.ts` (no
package under `packages/` has ever had its own test runner — every existing pure-domain function is
validated via a `describe(...'no DB dependency'...)` block inside its own `apps/api/test/*.e2e-spec.ts`,
`flagging.e2e-spec.ts`'s own precedent); and no bespoke forced-failure test for transactional
atomicity (already proven generically by `capability-check.e2e-spec.ts` for any audited route sharing
the same transaction wrapper). A third, real implementation-only finding: this repo's own e2e specs
share one seeded set of analytes across all test files, and R-4s's sibling-pairing is scoped by
`analyteId` alone — the first draft of `qc-westgard.e2e-spec.ts` let two unrelated tests share one
analyte, so one test's own 'high'-level control lot leaked in as a false R-4s sibling for a later
test. Fixed by allocating a distinct analyte per test (`analyteIds[0..7]`), not by narrowing the
production query (the leak was a test-isolation bug, not an evaluator bug — confirmed by the pure-eval
describe block's own direct-call tests passing throughout). 202/202 `apps/api` e2e suite green on a
clean DB (20 new: 12 pure-eval boundary cases + 8 HTTP/RLS/persistence cases); `rls-check` green
(`qc_rule_violation` fixture added to `insertFixtures()`, mirroring `control_lot`'s own TASK-063
precedent); repo-wide `typecheck`/`lint`/`build` green, including a real `next build`/`nest build`;
`openapi.json`/`packages/sdk/src/schema.ts` confirmed unchanged (`recordResult()` has no
`@ZodResponse` binding, per TASK-064's own precedent, so the additive `violations` field doesn't
surface in the OpenAPI spec at all — not a gap, the route's response was never schema-bound);
migration applies cleanly on two separate `pnpm db:reset` runs.

**TASK-068 (Levey-Jennings chart data API), 2026-08-08.** The human asked for TASK-068 by name
(continuing directly from TASK-067, no new `/orient` cycle), so — per FEAT-018's own TASK-064
precedent — this revision documents the design decisions made during implementation rather than
re-running the full open-questions options-prompt; none were genuinely ambiguous enough to need one.

**Route/response shape:** `GET v1/control-lots/:id/chart`, per this file's own §2 sketch. Response:
`{ controlLotId, analyteId, level, targetMean, targetSd, points: [{ id, value, zScore, producedAt,
createdAt, violations }] }`, ordered **oldest-first** — deliberately the reverse of `listResults`'s
own most-recent-first convention, since a chart reads left-to-right chronologically; a different
consumer, not an inconsistency. `zScore` per point is a new, small addition beyond this file's
original §2 sketch — Stitch §14.2's own QC Charts prompt names a "value, target, SD, z-score, rules
triggered" table, so computing it server-side (trivial: `(value - targetMean) / targetSd`) avoids
making the frontend duplicate that arithmetic, not a speculative addition.

**Quantity-only, real scope decision:** a mean/SD band is meaningless for a coded/text control lot
(no such lot exists in the real chemistry-catalog seed today, but the schema doesn't forbid one) —
the endpoint 400s if the control lot's own analyte isn't `quantity`-dataType, mirroring
`loadControlLot`'s existing dataType-mismatch 400 precedent, rather than silently returning an empty
or nonsensical chart.

**No `@Audit()`** — an unmutating read, same as `listResults` (`engineering/api-design` entry #6).

**Real finding during implementation:** `chemistry-catalog.sql`'s own seed only ever inserts
`quantity`-dataType analytes (confirmed by inspection, not assumed) — proving the "400 for
non-quantity" case needed a synthetic, explicitly non-clinical coded-analyte fixture inserted by the
test itself (a `code_system_value` + `analyte` row), the same "state the gap, don't fabricate real
data" discipline `domain/qc-westgard` entry #6 and `domain/reference-ranges` entry #4 already
established.

Delivered: `packages/domain/src/control-lot.ts` (`qcChartPointSchema`/`qcChartSchema`),
`control-lot.controller.ts`'s `getChart()`. `openapi.json`/`packages/sdk/src/schema.ts` regenerated —
this route IS `@ZodResponse`-bound (unlike `recordResult()`), so a real diff was expected this time —
confirmed purely additive (+165 lines `openapi.json`, +72 `schema.ts`, 0 deletions in either).

Verified: 6 new HTTP-level e2e tests in `apps/api/test/qc-chart.e2e-spec.ts` (401 unauthenticated,
404 nonexistent lot, 404 cross-tenant lot, empty-points band-only response, ordered points with
per-point z-score/violations matching a real `POST` first, 400 for a non-quantity analyte)); full
`apps/api` e2e suite 208/208 on a clean DB, zero regression; repo-wide `typecheck`/`lint`/`build`
green, including a real `next build`/`nest build` (confirming `apps/web` still typechecks against the
regenerated SDK schema).

## 1. Goal

M5 continues after FEAT-021 (critical notification/escalation) closed last session. Of M5's four
currently-unblocked open features (FEAT-019, FEAT-022, FEAT-023, FEAT-025), FEAT-019 was chosen: it
is the direct next link in the QC/safety thread FEAT-018 (QC materials & results as Observations)
already built this milestone, and it unblocks FEAT-020 (QC gating of result release, also Critical
priority) — the only M5 feature whose completion lets a second Critical feature start.

FEAT-019's issue text names two ACs: a Levey-Jennings chart that "correctly plots control values
against mean ± 1/2/3 SD bands," and Westgard rule violations "correctly detected and flagged (1-2s,
1-3s, 2-2s, R-4s at minimum)." Its Tasks section is unstarted, same "belongs to a rolling-wave
milestone" state every M5 feature starts in.

**Task decomposition (drafted this session, not yet created as GitHub issues — see §10 Q3):**
- **TASK-067 — Westgard multirule evaluation engine.** This proposal's scope. The pure-function rule
  evaluator, the `qc_rule_violation` table, and wiring evaluation into the existing
  `POST /v1/control-lots/:id/results` write path (TASK-064) so a violation is detected and flagged at
  the moment of QC entry — literally FEAT-019's "detected and flagged" AC. No chart, no new read
  endpoint beyond what's needed to prove detection.
- **TASK-068 — Levey-Jennings chart data API.** Depends on TASK-067. `GET
  /v1/control-lots/:id/chart` (or equivalent) returning ordered control points + mean/SD bands +
  each point's violation flags, in the shape the frontend chart needs — the literal "queryable" half
  of the charting AC.
- **TASK-069 — Levey-Jennings chart UI.** Depends on TASK-068. Frontend chart (Stitch §14.2/§14.4)
  plus a Westgard-violation indicator (§14.5) — the literal "correctly plots" AC and the feature's
  only frontend surface.

**Real, load-bearing finding from this proposal's own research, not present in FEAT-019's issue
text:** KB-27 states Westgard rules are "metadata per analyte/instrument" and "evaluated across
levels and, where configured, across runs" — but no rule-pack configuration table and no "run"
grouping concept exist anywhere in this schema (confirmed by grep, `domain/qc-westgard` Skill entry
#3/#7). These are genuine schema/algorithm decisions, not implementation details. **ADR-0018**
(drafted alongside this proposal, Status: proposed) resolves both: a fixed default rule set (not a
configurable table) and a nearest-same-day-sibling-level pairing heuristic for the cross-level R-4s
rule (no `qc_run` entity). TASK-067 cannot start until ADR-0018 is accepted (§10 Q1).

**Second finding:** FEAT-019 must not build the release-gate hold/alert logic — KB-27's own pipeline
names that as FEAT-020's later stage. TASK-067 detects and persists violations only; no hold, no
gate, no resolution workflow. `domain/qc-westgard` Skill entry #4 already records this narrowing
from FEAT-018's own kickoff, reaffirmed here for FEAT-019.

## 2. Affected files

- `lis-engineering/adr/adr-0018-westgard-multirule-evaluation-fixed-rule-set-same-transaction-nearest-sibling-run-pairing.md`
  (new, this session) — must be **accepted** before this task's migration/code is written (§10 Q1).
- `packages/domain/src/qc-westgard.ts` (new) — pure-function evaluator:
  `evaluateWestgardRules(points: readonly QcPoint[], siblingLevelPoint: QcPoint | null, targetMean:
  number, targetSd: number): QcRuleViolationCandidate[]`, where `QcPoint = { value: number;
  producedAt: Date }`. No DB access — same "pure domain logic" shape as `calculated-fields.ts`
  (TASK-053's own precedent), unit-testable without Postgres.
- `packages/domain/src/control-lot.ts` (modify) — extend `QcObservationResult`'s containing response
  type with an optional `violations: QcRuleViolationResult[]` field on the audited mutation's
  `after`; add `qcRuleViolationSchema`/`QcRuleViolationResult`.
- `packages/db/src/schema/qc-rule-violation.ts` (new) — `qc_rule_violation` table per ADR-0018:
  `id`, `tenantId`, `controlLotId` (FK → `control_lot.id`), `observationId` + `observationCreatedAt`
  (composite FK → `observation.(id, created_at)`, per `database-design` Skill entry #10's own
  composite-FK-companion-column finding — applied directly here, not rediscovered), `ruleCode`,
  `severity`, `detectedAt`, `createdAt`. Tenant-scoped, RLS via the standard local `tenantIsolation()`
  helper (`control-lot.ts`/`reference-range.ts` precedent).
- `packages/db/src/index.ts` — export `qcRuleViolation` schema.
- `db/migrations/0021_qc_rule_violation.sql` (new, hand-written per this repo's CHECK-constraint/RLS
  convention) — creates `qc_rule_violation`.
- `apps/api/src/control-lot/control-lot.controller.ts` (modify) — `recordResult()` extended to, within
  the existing `tx`: load recent same-lot history (within-level rules) and the nearest same-day
  sibling-level result (R-4s, per ADR-0018 §Decision 3 — queried by joining `control_lot` on
  `analyteId`/`instrumentId` with a different `level`), call `evaluateWestgardRules`, insert any
  resulting `qc_rule_violation` rows, and include them in the returned `after.violations`.
- `apps/api/test/qc-westgard.e2e-spec.ts` (new) — a `describe('pure rule evaluation (no DB
  dependency)', ...)` block calling `evaluateWestgardRules` directly (boundary-exact cases per named
  rule — exact-2SD not a 1-2s trigger, etc.), plus real-Postgres blocks: RLS isolation on
  `qc_rule_violation`, each named rule detected end-to-end from a crafted history via the real HTTP
  route, R-4s correctly skipped when no sibling-level result exists in-window,
  1-2s-alone-vs-1-2s-suppressed-by-a-confirming-rejection-rule, transactional atomicity (a forced
  failure after violation-detection rolls back the whole insert).
  **Correction made during implementation, not anticipated when this proposal was drafted:** no
  package under `packages/` has ever had a standalone test file or test runner configured (confirmed
  by repo-wide search) — every existing pure-domain function (`computeFlags`, TASK-050;
  `calculated-fields.ts`, TASK-053) is validated exclusively via a `describe(...'no DB
  dependency'...)` block inside its own `apps/api/test/*.e2e-spec.ts` (`flagging.e2e-spec.ts`'s own
  precedent, line 299), not a separate `packages/domain/src/*.test.ts`. Introducing a new test
  runner/config to `packages/domain` for this one file would be exactly the kind of premature
  infrastructure this repo's own engineering culture avoids elsewhere (`control_lot.level` staying
  free text, ADR-0018's own "don't build the config layer before it's needed"). No separate
  `qc-westgard.test.ts` file — superseding the line originally drafted below.
- No frontend, no chart-data endpoint this task — matches TASK-067's own "detection only" scope;
  TASK-068 is the first read-shaped consumer, TASK-069 the first frontend consumer.

## 3. Architecture consulted

- KB-27 Quality Control — primary; the Westgard multirule description and the release-gate boundary.
- ADR-0018 (this session) — the concrete rule-set/pairing/transaction mechanism.
- ADR-0015 (FEAT-018) — `control_lot`/`observation` QC-subject shape this task builds directly on.
- ADR-0008 (observation partitioning) — the composite-PK reason `qc_rule_violation`'s FK to
  `observation` needs a companion `observationCreatedAt` column.
- `domain/qc-westgard` Skill — primary; entries #1-7 all directly load-bearing for this task.

## 4. Skills loaded

- `domain/qc-westgard` — primary, all seven entries.
- `engineering/database-design` — composite-FK-to-`observation` precedent (entry #10), hand-written
  migration/RLS convention.
- `engineering/rls-multi-tenancy` — new tenant-scoped table pattern.
- `engineering/api-design` — existing route/audit conventions this task extends rather than
  duplicates (entry #6 unmutating-read-no-@Audit, entry #7 cross-tenant-404, entry #11 sub-resource
  route shape, entry #14 the discriminatedUnion DTO-binding workaround `qcResultEntrySchema` already
  uses).
- `engineering/testing` — real-Postgres transactional-rollback test precedent.
- `domain/reference-ranges` entry #4 / `domain/qc-westgard` entry #6 — the "state the data gap
  plainly, don't fabricate" discipline applied to R-4s's own missing-sibling-data case and to this
  task's synthetic e2e fixtures.

## 5. Assumptions & autonomous decisions

- **Fixed default rule set, no per-tenant configuration.** Per ADR-0018 §Decision 1 — FEAT-019's own
  AC only requires the six named rules functioning; KB-16 (the discipline-profile concept
  configuration would attach to) doesn't exist. Not raised as an open question: the alternative
  (build rule-pack config now) is speculative scope with no stated real need, the same class of call
  FEAT-018 already made for `control_lot.level`.
- **R-4s pairing via nearest same-day sibling-level result, not a new `qc_run` table.** Per ADR-0018
  §Decision 3 — raised as §10 Q1 (bundled with ADR-0018 acceptance) since it's a genuine clinical-
  methodology judgment call with a real accuracy trade-off, not a pure implementation detail a
  developer should silently decide.
- **Violations fold into the existing `recordResult()` audit event, no second `@Audit()` write.** Per
  ADR-0018 §Decision 5, mirroring TASK-065's `criticalNotificationId` precedent directly.
- **This task adds no new capability and no new HTTP route** — `recordResult()`'s existing
  `enter_result` capability guard is unchanged; violation detection is a side effect of the same
  authorized action, not a new authorizable action.
- **No hold/gate/resolution logic.** Matches `domain/qc-westgard` entry #4's FEAT-018→019→020
  narrowing, reaffirmed for this task explicitly.

## 6. Risks

- **ADR-0018 is not yet accepted.** Single blocking dependency for this entire task, raised as §10
  Q1, not assumed.
- **The 24-hour sibling-pairing heuristic is an approximation, not a precise "run" concept** (ADR-0018
  Consequences) — will under-detect R-4s in real edge cases (levels run >24h apart, or only one level
  ever run). Documented, accepted trade-off; a future `qc_run` entity is the precise fix, deliberately
  deferred until FEAT-027 (analyzer integration) makes multi-level batch entry a structured event.
- **No real QC data exists to validate the rule evaluator against** (`domain/qc-westgard` entry #6,
  reaffirmed) — correctness rests on unit tests against textbook Westgard rule definitions and
  synthetic e2e fixtures, not partner-reviewed control data. Lower risk than a reference-range/
  criticals gap since no patient-facing clinical value is asserted by this task (violations are
  QC-internal signals, not patient results) — but worth stating plainly.
- **Extending `AuditedMutationResult.after`'s shape is a real, if backward-compatible, API contract
  change** to an existing, already-shipped route (`POST /v1/control-lots/:id/results`, FEAT-018). The
  new `violations` field is additive/optional — existing consumers unaffected — but `openapi.json`/
  `packages/sdk/src/schema.ts` regeneration and a real `apps/web` build are required to confirm no
  breakage, per `database-design` entry #10's own DTO-corruption cautionary precedent (TASK-065's
  third finding).

## 7. Acceptance criteria

Narrowed to TASK-067's own detection scope (TASK-068/069 will carry FEAT-019's full literal ACs):
- [x] `qc_rule_violation` exists, tenant-scoped, RLS-enforced (negative test: wrong-tenant session
  sees 0 rows via `lis_app`), with a real composite FK to `observation` and a real FK to
  `control_lot`. — `qc-westgard.e2e-spec.ts`'s "RLS isolation" describe block; structural sweep +
  live leak check both confirmed via `pnpm --filter @lis/db rls-check`.
- [x] Each of 1-2s, 1-3s, 2-2s, 4-1s, 10x is correctly detected from a crafted single-lot history,
  including exact-boundary cases (a point at precisely 2 SD is not a 1-2s trigger). — pure-eval
  describe block (12 cases) plus HTTP-level describe block (one per rule).
- [x] R-4s is correctly detected when a same-day sibling-level result exists, and correctly *not*
  evaluated (no violation, no error) when none exists in the 24-hour window. — both proven in the
  same test, two different analytes so the "no sibling" case is genuinely guaranteed, not just
  timed-out.
- [x] 1-2s alone persists as `severity: 'warning'`; a confirming rejection rule persists as
  `severity: 'rejection'` and suppresses the redundant 1-2s warning for the same point. — proven for
  every rejection rule (each test's first, sub-2-SD-then-2-SD, or exactly-non-suppressed case).
- [x] `POST /v1/control-lots/:id/results` returns detected violations in `after.violations`, and each
  is persisted in the same DB transaction as the QC Observation insert. — response-shape + direct DB
  row checked in the same test; **atomicity itself is not re-proven with a new forced-failure route**
  (see §8's own correction note — already proven generically by
  `capability-check.e2e-spec.ts`'s `enter-result-forced-audit-failure` test for any audited route
  sharing the same transaction wrapper).
- [x] Every existing `apps/api` e2e test still passes unchanged — zero regression to FEAT-018's own
  write/read paths. — 202/202 `apps/api` e2e suite green on a clean DB.
- [x] Migration runs up **and** down cleanly on seeded data. — `pnpm db:reset` (drop/recreate) run
  twice during implementation, both clean; no literal down-migration script exists in this repo's own
  convention (ADR-0008/ADR-0015 precedent: rollback = revert the PR + migration, no production data
  exists at this milestone).

## 8. Testing plan

1. `apps/api/test/qc-westgard.e2e-spec.ts`'s own `'pure rule evaluation (no DB dependency)'`
   describe block — one boundary case per named rule, run without Postgres (superseded a separate
   `packages/domain/src/qc-westgard.test.ts`, see §2's correction note).
2. `pnpm --filter @lis/db typecheck`/build with the new `qc-rule-violation.ts` module.
3. `apps/api/test/qc-westgard.e2e-spec.ts`, real Postgres, connected as `lis_app`:
   - RLS isolation on `qc_rule_violation` (wrong-tenant session sees 0 rows).
   - Each named rule detected end-to-end via `POST /v1/control-lots/:id/results` against a crafted
     history.
   - R-4s present/absent-by-design (sibling exists / doesn't) both proven.
   - 1-2s-suppressed-by-rejection-rule case.
   - Transactional atomicity: **not re-proven with a new forced-failure route.** `capability-
     check.e2e-spec.ts`'s existing `enter-result-forced-audit-failure` test already proves, generically,
     that any late failure inside an audited route's transaction (the same `TenantContextInterceptor`/
     `AuditInterceptor` wrapping `recordResult()` uses) rolls back the whole request — this task's
     violation insert is just another statement inside that same, already-proven transaction, not a
     new mechanism needing its own dedicated proof. Correction made during implementation: this
     proposal originally planned a bespoke forced-failure test for this route; building one would
     re-derive an already-proven, route-agnostic NestJS guarantee at real cost (new test-only route)
     for no new confidence.
4. The full existing `apps/api` e2e suite re-run and confirmed still green.
5. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root, including a real `next build`/`nest
   build`.
6. `openapi.json`/`packages/sdk/src/schema.ts` regenerated and confirmed to reflect the additive
   `violations` field only (CI-enforced since PR #343).
7. Migration up/down cycle run locally against seeded data.

## 9. Rollback plan

Additive: `qc_rule_violation` is a new table (drop it); `control-lot.controller.ts`'s change is a
pure addition to an existing handler (remove the added logic, the route's prior behavior is
untouched). No existing column is modified. Reverting the PR and the migration is clean, no
data-preservation concern (no production data exists at this milestone, same precondition ADR-0008/
ADR-0015 already relied on).

## 10. Questions requiring human approval

1. **Is ADR-0018 (fixed default Westgard rule set; synchronous same-transaction evaluation;
   nearest-same-day-sibling-level pairing for R-4s) approved as written?** This blocks TASK-067
   entirely. Recommended: accept as drafted — each of its three decisions is the minimal,
   directly-justified mechanism for what FEAT-019's own AC requires, with the more precise
   alternatives (configurable rule packs, a formal `qc_run` table) explicitly named and deliberately
   deferred rather than silently foreclosed.
2. **Should TASK-067/068/069 be created as real GitHub issues now**, alongside proposal approval —
   the same sequencing every prior M5 feature kickoff in this repo has used? Recommended: yes, now.

---
