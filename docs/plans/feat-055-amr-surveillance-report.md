# Implementation Proposal: FEAT-055 AMR surveillance report
Status: DRAFT
ADR: none needed (see §3)    Date: 2026-08-11    Backlog ID: FEAT-055 (#508)

## 1. Goal
Organism × antimicrobial × S/I/R rates over a date range, as a real, on-demand report — the
literal KB-44 AMR-surveillance example, narrowed to reuse `FEAT-034` (operational reports)'s own
proven shape (`computeTatReport`/`computeWorkloadReport`/`computeRejectionRateReport`: a pure,
directly-unit-testable aggregation function over real Postgres rows, no warehouse, no CDC).

**This proposal is more speculative than FEAT-053 was, and says so plainly.** FEAT-053 depends on
FEAT-051's own still-provisional schema conceptually (its query logic references analytes/
observations that already exist in this codebase today). FEAT-055 depends on FEAT-051's *and*
FEAT-053's own schemas **structurally** — its own aggregation query joins directly against
`organism`/`antimicrobial` (FEAT-051, not yet migrated) and `antimicrobial.analyteId` (FEAT-053's
own proposed extension, not yet migrated either). **Neither table exists in this codebase today.**
This proposal cannot be implemented — not even scaffolded — until both FEAT-051 and FEAT-053 are
actually built, not merely approved. §10 Q1 asks explicitly whether to approve this design now on
that basis.

## 2. Affected files
- `packages/domain/src/amr-surveillance.ts` (new) — `amrSurveillanceEntrySchema`/
  `amrSurveillanceReportSchema`, reusing `operationalReportQuerySchema` directly (identical
  `from`/`to`-required shape, `packages/domain/src/operational-reports.ts`) rather than duplicating
  it.
- `apps/api/src/report/amr-surveillance.service.ts` (new) — `computeAmrSurveillanceReport(tx,
  params)`, mirroring `operational-reports.service.ts`'s exact shape: a pure, directly-unit-testable
  aggregation function.
- `apps/api/src/report/amr-surveillance.controller.ts` (new, or a new route on the existing
  `OperationalReportsController` — TBD at implementation time, see §10 Q2) — `GET
  /v1/reports/amr-surveillance`, same `view_operational_reports` capability gate as every other
  report in this controller family.

## 3. Architecture consulted
- KB-44 Analytics — the literal AMR-surveillance example this feature implements a narrowed slice
  of (organism × antibiotic × S/I/R atoms, de-identified/time-trended in KB-44's own fuller vision;
  this feature's v1 is tenant-scoped only, no de-identification or cross-tenant work — that's
  `FEAT-056`'s own separate, harder problem).
- `apps/api/src/report/operational-reports.service.ts`/`.controller.ts` — read in full, the direct
  implementation precedent this proposal's own §2 follows exactly: pure aggregation function +
  thin capability-gated controller, no new architectural pattern.
- `docs/plans/feat-053-susceptibility-interpretation-antibiogram.md` — the schema this feature's
  own query joins against (`antimicrobial.analyteId`, discrete coded S/I/R Observations on the
  ORGID `ordered_test`). Explicitly provisional (that proposal's own §1 finding), so this feature's
  own query shape is provisional right along with it.
- No ADR needed — this is a read-only aggregation report over an already-structured dataset, the
  same shape `FEAT-034` already established with no new ADR of its own.

## 4. Skills loaded
- `engineering/database-design`.
- `engineering/api-design`.

## 5. Assumptions & autonomous decisions
- **Reuse `operationalReportQuerySchema` directly** (not a new AMR-specific query schema) — not
  treated as an open question; it's the identical `from`/`to`-required shape with no AMR-specific
  parameter this feature's own AC needs yet.
- **Only `'verified'` susceptibility observations count** (matching the "verified is the completion
  bar" convention `computeTatReport`/`report-assembly.ts`/`SlaBreachDetectorService` all already
  established) — a preliminary or in-process susceptibility result is not yet a clinical fact worth
  surveillance-counting.
- **Aggregated in application code, not SQL `GROUP BY`** — `computeTatReport`'s own explicit
  precedent (its header comment: "simpler and more directly testable for a first version"), reused
  here rather than re-litigated; the same real "unindexed date-range scan at real volume" risk that
  function's own §6 already named applies here too, checked the same way (§8).
- **Tenant-scoped only, no cross-tenant/de-identified aggregation** — `FEAT-056`'s own explicit,
  separate scope (EPIC-011's own issue text); this feature's own RLS-scoped query needs no new
  privacy mechanism.

## 6. Risks
- **Cannot be implemented until FEAT-051 AND FEAT-053 both actually ship** (§1) — this is the
  dominant risk, named once, not repeated per section. Everything else below is secondary to it.
- **FEAT-053's own schema is itself provisional** (that proposal's own §6 risk) — if
  `antimicrobial.analyteId` or the dual-emission Observation shape changes once FEAT-051/053 are
  really built, this proposal's own §2 query design may need real revision, not just a mechanical
  adjustment.
- **Real AMR surveillance conventionally reports "first isolate per patient per period"** (repeat
  cultures from the same patient can inflate resistance rates if double-counted) — this proposal's
  own v1 does not implement that dedup logic, since it's a real clinical-epidemiology convention
  this proposal hasn't independently verified against a real published methodology; flagged as
  §10 Q3 rather than silently assumed either way.

## 7. Acceptance criteria
(unchanged from issue #508/FEAT-055, restated for traceability)
- [ ] A real, on-demand report shows S/I/R rates per organism-antimicrobial pair over a specified
      date range, computed directly from `observation` rows (no new storage, no warehouse)
- [ ] Gated behind an appropriate capability
- [ ] Tenant-scoped by default; cross-tenant aggregation is explicitly `FEAT-056`'s own concern

## 8. Testing plan
- Unit: `computeAmrSurveillanceReport`'s own aggregation math, directly testable against
  synthetic in-memory rows (mirrors `mean()`/`median()`'s own unit-test shape) — buildable
  independent of FEAT-051/053 landing, since the *function's own logic* can be unit-tested with
  hand-constructed row shapes even before real tables exist, the same way this proposal's own
  design can be reviewed now.
- Integration (real Postgres): blocked until FEAT-051/053 ship real tables — cannot write a real
  e2e spec against tables that don't exist.
- `EXPLAIN` check on the real query once implemented, matching `computeTatReport`'s own §6 risk
  note about unindexed date-range scans at real volume.

## 9. Rollback plan
Additive: one new domain file, one new service function, one new (or extended) controller route.
No existing table, function, or endpoint is touched. Rollback is removing the new files.

## 10. Questions requiring human approval
1. **This proposal designs against FEAT-051's and FEAT-053's own still-unbuilt, provisional
   schemas** — a real table-level dependency, not just a conceptual one (§1). Approve this design
   now, understanding implementation cannot begin until both ship for real and this proposal's own
   §2 may need real revision at that point — or hold FEAT-055's approval until FEAT-051/053 are
   actually built?
2. **New standalone `AmrSurveillanceController`, or a fourth route on the existing
   `OperationalReportsController`?** The latter keeps every capability-gated report under one
   controller (matching KB-43's own "canned report catalog" framing); the former keeps
   microbiology-specific code out of the generic operational-reports module. Recommend the latter
   (new controller) since this report is discipline-specific in a way TAT/workload/rejection-rate
   are not — but a real, not-yet-made call.
3. **First-isolate-per-patient-per-period deduplication** (§6) — in scope for v1 (a real, if
   complex, epidemiological convention), or explicitly deferred to a named follow-up issue, with
   v1's own report caveat that repeat cultures from the same patient are not deduplicated?
