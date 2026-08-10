# Implementation Proposal: FEAT-034 Operational reports (TAT, workload)
Status: **IMPLEMENTED** — merged PR #453 (`2a21303`), closing #43. §10's open questions resolved by
the human via the native options-prompt (2026-08-10), all three decided as the recommended option.
Full apps/api e2e suite (32 files / 324 tests) green against a freshly reset DB, confirmed stable
across 3 consecutive full-suite runs; repo-wide typecheck/lint/build clean; golden-dataset check
PASS. Two real test-fixture-isolation bugs were found and fixed during implementation: a "safely
wide" TAT window silently summed in every other spec file's own real-time `routine`-priority
fixtures once run as part of the full suite (fixed by excluding real "now" from the window
entirely), and the workload window (even after a first, DB-clock-anchored tightening) remained
intermittently contaminated by other specs' own `test-user-4` activity (fixed by deriving the
window directly from the fixture's own two real `observation` row timestamps, not any wall-clock
estimate). `ordered_test.status` was also confirmed to never reach a literal `'verified'` value --
verification is tracked exclusively via `observation.status`.
ADR: none yet — write one if a load-bearing decision is discovered during planning (none surfaced
here that isn't already settled by direct precedent or by KB-44's own explicit scope boundary).
Date: 2026-08-10    Backlog ID: FEAT-034 (#43)

**§10 resolved 2026-08-10, all three questions decided as the recommended option:** Q1 (capability
gate): a new `view_operational_reports` capability, `qa` role. Q2 (recurring KB-doc-mismatch
pattern): flagged in this proposal only, no separate issue/retro. Q3 (TAT completion status):
`status = 'verified'` only. Every §5 assumption already matched these — no changes needed to the
design itself, only this record of confirmation.

## 1. Goal

M7's own three other features (FEAT-032 #41, FEAT-035 #44, FEAT-033 #42) all shipped this session.
FEAT-034 is the last open M7 feature; its one dependency, `FEAT-022` (Worklist v2), is closed.
FEAT-034's own literal AC: **"TAT, workload, and rejection-rate reports render correctly against
real seeded data."**

Its own "Architecture documents to reference" names **KB-44 (Analytics)**.

**Real, load-bearing finding #1 — KB-44 explicitly, in its own text, excludes this feature's exact
scope from itself.** KB-44's own "Scope" section states: *"Operational/clinical reports for
day-to-day lab management are [`43`](./43-reporting.md); this is the deeper analytical layer."*
KB-44 is about the CDC-to-warehouse pipeline, the dimensional fact model, and cross-tenant
de-identified analytics/AI features — real, described-in-detail future infrastructure (M9/M10,
matching this session's own already-established finding for FEAT-033: no replica/warehouse/CDC
exists anywhere in this repo, confirmed again by the same grep). **KB-43 (Operational Reporting),
not cited by this issue at all, is the actually-relevant document** — it is the one that literally
names "TAT per workflow step, workload by bench/analyst, specimen rejection rates by cause" as its
own worked examples, word-for-word matching this issue's own three named report types. This is the
third time this exact "the issue cites a bigger/adjacent KB doc instead of the one that actually
describes this feature's own real scope" pattern has recurred this session (FEAT-032 vs. KB-12/13;
FEAT-033 vs. KB-13/43) — worth a standing note (§10, not silently fixed) rather than assumed
coincidental a third time.

**Real, load-bearing finding #2 — `engineering/observability`, this issue's own named Required
Skill, does not exist anywhere in `lis-engineering/skills/`.** Confirmed by directory search: zero
matches. This feature is three read-only SQL aggregation queries against already-existing OLTP
columns, not an APM/tracing/monitoring concern (this repo's actual observability tooling —
structured logging, Sentry — was built by TASK-010, M1, and needs no change here). The Skill
reference reads as another instance of finding #1's own pattern (aspirational/mismatched
reference), not a real missing dependency to build first. No new Skill is drafted speculatively
here, matching this repo's own "don't build a Skill ahead of a real finding to put in it" discipline
(`engineering-radar`'s own stated principle) — flagged at §10, not silently ignored.

**Real, load-bearing finding #3 — every column all three report types need already exists; this
proposal is additive-at-the-API-layer only, the same characteristic every M7 feature this session
has had.** `sla_target` (FEAT-022) + `ordered_test.createdAt`/`status` give TAT-vs-target; `observation
.verifierUserId`/`.operatorUserId` (both already columns) give workload-by-user; `specimen.status`/
`.rejectionReason` (already a real, CHECK-constrained coded vocabulary: `haemolysed|clotted|
insufficient_volume|mislabelled|wrong_container|improper_temperature|expired`, TASK-047) give
rejection-rate-by-cause directly. No migration.

**Real, load-bearing finding #4 — "TAT" needs a real "done" timestamp for a panel, which is not a
single column anywhere, but is exactly the same `MAX(verifiedAt)` computation
`report-assembly.ts`'s own `assembleAndPersistReport` already performs for its "most-recently-
verified analyte" verifier block (FEAT-016).** `ordered_test` has no `resultedAt`/`verifiedAt`
column of its own; a panel's own completion time is the latest `observation.verifiedAt` among its
analytes. Reusing this exact, already-proven aggregation (not inventing a new "when did this panel
finish" definition) keeps TAT's own "done" moment consistent with what the rest of this codebase
already means by it.

**Real, load-bearing finding #5 — a date-range query-parameter convention already exists in this
exact codebase, one feature away.** `order.controller.ts`'s own `search()` (`createdFrom`/
`createdTo`, `z.iso.datetime().optional()`, combined via `gte`/`lte` and a filtered array of
conditions) is the direct, reusable precedent for every one of this proposal's three new routes —
not a new pagination/date-filter mechanism, and not the speculative-ahead-of-need gap
`engineering/api-design` Skill entry #4 defers elsewhere.

## 2. Affected files

- `packages/domain/src/operational-reports.ts` (new) — Zod schemas: a shared
  `operationalReportQuerySchema` (`from`/`to`, both `z.iso.datetime()`, required — unlike
  `order.controller.ts`'s own optional pair, an aggregate report has no sane "all time" default at
  real data volume) and one result schema per report type (`tatReportSchema`, `workloadReportSchema`,
  `rejectionRateReportSchema`).
- `apps/api/src/report/operational-reports.controller.ts` (new) —
  `GET /v1/reports/operational/tat`, `GET /v1/reports/operational/workload`,
  `GET /v1/reports/operational/rejection-rate`, each accepting `from`/`to`.
- `apps/api/src/report/operational-reports.service.ts` (new) — the three aggregation queries:
  - **TAT**: `ordered_test` rows with `status = 'verified'` (or `'reported'`) whose `createdAt`
    falls in `[from, to]`, joined to `MAX(observation.verifiedAt)` per `ordered_test_id` (finding
    #4), grouped by `order.priority` and by `test_definition_id`; mean/median minutes and
    `% within sla_target.targetMinutes` per group.
  - **Workload**: `observation` rows with `status IN ('preliminary', 'verified')` and
    `producedAt`/`verifiedAt` in range, counted per `operatorUserId` (finalized-by) and per
    `verifierUserId` (verified-by) — raw ids only, no name resolution (no user table yet, M2 gap,
    matching every other "raw id shown" precedent in this codebase, e.g. `report-assembly.ts`'s own
    verifier block).
  - **Rejection rate**: `specimen` rows with `receivedAt`/`createdAt` in range, count of
    `status = 'rejected'` grouped by `rejectionReason`, over total specimens in the window (the
    denominator for a real rate, not just a raw count).
- `apps/api/src/report/report.module.ts` — registers the new controller (folded into the existing
  `ReportModule`, mirroring FEAT-033's own choice, not a new module for three related read routes).
- `apps/api/src/auth/capabilities.ts` — new `view_operational_reports` capability (§10 Q1).

**Not affected:**
- No migration — every source column already exists (finding #3).
- No new `apps/web` screen — "Google Stitch prompts required: Not applicable... or composed
  entirely from existing `packages/ui` primitives," read the same way this session has read
  identical wording for FEAT-032/033: API-only for this proposal's own scope.
- No warehouse/CDC/replica infrastructure — KB-44's own explicit exclusion (finding #1) means this
  was never actually this feature's own job to begin with, not a deferred/descoped item.

## 3. Architecture consulted

- **KB-43 Operational Reporting** — the actually-relevant document (finding #1); its own three
  worked examples (TAT, workload, rejection rate) match this issue's literal AC verbatim.
- **KB-44 Analytics** — read to confirm it explicitly excludes this feature's own scope from itself
  (finding #1's own opening); its warehouse/CDC/dimensional-model content has no bearing here.
- `apps/api/src/worklist/worklist.controller.ts` — the existing `sla_target`/`ageMinutes`/
  `computeSlaStatus` precedent this proposal's own TAT report reuses the same target-minutes lookup
  from, generalized from "how old is this still-open item" to "how long did this completed item
  actually take, and did it meet target."
- `docs/plans/feat-016-minimal-report.md` — the `MAX(verifiedAt)`-per-panel precedent reused
  verbatim for TAT's own "done" timestamp (finding #4).
- `apps/api/src/order/order.controller.ts`'s `search()` — the `createdFrom`/`createdTo` date-range
  convention reused directly (finding #5).
- `engineering/api-design` Skill — entry #6 (reads aren't audited by default — every route here is
  a read); entry #4 (pagination/date-range deferred "until a real endpoint's failure mode needs
  one" — this proposal's own required `from`/`to` is that real need, for this endpoint specifically,
  not a general pagination mechanism).

## 4. Skills loaded

- `engineering/api-design` — read-route conventions, date-range-filter precedent (finding #5).
- `engineering/database-design` — checked for whether any new column/table/migration is needed;
  confirmed none is (finding #3) — the check itself is the point.
- `engineering/observability` — does not exist (finding #2); not loaded, not drafted speculatively.

## 5. Assumptions & autonomous decisions

- **Three separate routes, one per report type** — not one combined "operational reports" endpoint
  with a `type` discriminator; each has a genuinely different shape/grouping, and KB-43's own
  "canned report catalog" framing treats them as distinct named reports, not variants of one query.
- **`from`/`to` are both required**, not optional like `order.controller.ts`'s own precedent — an
  unbounded aggregate scan (workload/TAT/rejection-rate with no date floor) is a real, different
  failure mode than an unbounded *list* query already guards against elsewhere; requiring both
  avoids ever needing to decide a default window.
- **TAT is scoped to `ordered_test`, not `order`** — matching every existing precedent in this
  schema (draft/finalize/verify/results-grid/report are all `ordered_test`-scoped, not
  order/accession-spanning), and KB-02's own already-resolved "chemistry = per panel" reporting
  unit, reused here rather than re-litigated.
- **Workload counts observations, not ordered_tests** — "workload by bench/analyst" is naturally
  per-result (one technologist finalizes N analytes, possibly across M panels), not per-panel.
- **No name resolution for `operatorUserId`/`verifierUserId`** — raw ids only, matching the
  established "no user table yet" convention this codebase already uses everywhere else that shows
  a user identity (e.g. `report-assembly.ts`'s own verifier block, TASK-057's results-grid).

## 6. Risks

- **Same over-scoping risk shape every prior feature this session named for itself**: "Analytics"
  (KB-44) reads as calling for the full warehouse/CDC/dimensional model. This proposal deliberately
  reads KB-44's own explicit scope-exclusion literally (finding #1) rather than building any of it.
- **An unindexed aggregate scan over `observation`/`ordered_test`/`specimen` for a wide date range
  could be a real, non-hypothetical performance concern at realistic data volume** — `ix_obs_trend`
  is indexed on `(tenant, patient, analyte, producedAt)`, not `(tenant, producedAt)` alone, so a
  tenant-wide workload query for a wide window doesn't get the same indexed-scan benefit
  `cumulative-report-assembly.ts` gets from its own narrower per-patient/analyte query. Worth an
  explicit `EXPLAIN`-checked test against a realistically-sized fixture (§8), not assumed fast from
  the query's own simplicity.
- **Whether these reports need a capability gate is a real, undecided question** (§10 Q1) —
  "workload by bench/analyst" is real, individual-staff-performance-shaped data, a different
  sensitivity class than a purely clinical read like `GET .../prior`.

## 7. Acceptance criteria

The issue's own literal AC, narrowed per findings #1–#5:
- [ ] `GET /v1/reports/operational/tat?from=...&to=...` returns mean/median TAT minutes and
  `% within SLA target`, grouped by priority and by test, for `ordered_test` rows completed
  (`verified`/`reported`) in the window — proven against real seeded orders/results with known,
  computable durations.
- [ ] `GET /v1/reports/operational/workload?from=...&to=...` returns per-user (operator and
  verifier, separately) observation counts in the window.
- [ ] `GET /v1/reports/operational/rejection-rate?from=...&to=...` returns rejected-specimen counts
  grouped by `rejectionReason`, plus the total specimen count in the window (a real rate, not just
  raw counts).
- [ ] All three reject a request missing `from` or `to` (400) rather than silently scanning
  unbounded history.
- [ ] All three render correctly against real seeded golden-dataset data (the issue's own literal
  wording), not just synthetic zero/one-row fixtures.
- [ ] RLS: each report reflects only the requesting tenant's own data (proven by a real e2e
  cross-tenant check, not just asserted from RLS being present elsewhere).

## 8. Testing plan

1. New unit tests for the aggregation logic (TAT mean/median computation, SLA-percentage math,
   rejection-rate denominator correctness) with hand-computable fixtures.
2. New e2e tests: a real multi-order/multi-analyte/multi-user fixture across a known date range,
   asserting exact computed TAT/workload/rejection-rate numbers (not just "some data came back");
   400 for missing `from`/`to`; RLS isolation for all three routes; an `EXPLAIN ANALYZE` sanity
   check against a realistically-sized fixture for §6's own performance risk (a real query-plan
   check, not just a passing-but-unverified-speed assertion).
3. Golden-dataset validation: run all three reports against the repo's own seeded chemistry/
   haematology catalog + a realistic order/result fixture, confirming the issue's own literal
   "render correctly against real seeded data" AC directly, not only against this proposal's own
   synthetic spec-local fixtures.
4. Repo-wide `pnpm typecheck`/`pnpm lint`/`pnpm build`, including `nest build`.
5. `openapi.json`/`packages/sdk/src/schema.ts` regeneration for the three new routes.

## 9. Rollback plan

Fully additive: one new domain schema file, one new controller, one new service, three new routes,
one new capability (if §10 Q1 resolves toward gating). Zero migration, zero modification to any
existing route/table/screen. Reverting the PR removes the entire feature cleanly.

## 10. Open questions — resolved 2026-08-10 via the native options-prompt

1. **Capability gate.** **Resolved: Option A.**
   - **Option A (recommended): gate behind a new `view_operational_reports` capability, granted to
     `qa`** — mirrors `manage_workflow`/`manage_report_templates`/`manage_catalog`'s own identical
     "lab-oversight, not day-to-day" reasoning; "workload by bench/analyst" is real,
     individual-staff-performance-shaped data, a different sensitivity class from a purely clinical
     read.
   - **Option B: ungated**, matching every other read in this repo's own default convention (`GET
     .../prior`, `GET /v1/catalog`, `GET /v1/reference-ranges`) — simpler, consistent with the
     read-routes-aren't-gated norm, at the cost of exposing per-analyst workload counts to every
     authenticated technologist/verifier session.

2. **The KB-doc-mismatch pattern itself (finding #1), now recurring a third time this session.**
   **Resolved: Option A.**
   - **Option A (recommended): flag it here, in this proposal, and move on** — matching how this
     session has already handled the first two instances (a documented finding in each feature's
     own proposal, not a process change).
   - **Option B: raise it as its own issue/retro finding** for the human to decide whether the
     backlog's own "Architecture documents to reference" fields need a review pass across the
     remaining M7-M10 issues, since a real, recurring pattern (not a one-off) is now visible across
     three consecutive features.

3. **TAT completion status.** **Resolved: Option A.**
   - **Option A (recommended): `status = 'verified'` only** — matches the "verified-only" bar this
     session has already applied twice (FEAT-016's own report, FEAT-033's own cumulative report) for
     "this result is real/final," consistent TAT semantics with every other feature that already
     drew this exact line.
   - **Option B: include `'reported'` too** — `ordered_test`'s own status vocabulary has a
     `'reported'` state past `'verified'`; including it would count TAT through to report
     generation/delivery, not just clinical verification, a genuinely different (and arguably more
     complete) definition of "done" for a *throughput* report specifically.
