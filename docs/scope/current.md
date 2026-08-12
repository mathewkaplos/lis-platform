# Status — 2026-08-12 (session 35)

Last commit on main: `0e93321` (`lis-platform`) / `c6715b1` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already
be one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M11 (EPIC-010, Microbiology) + M12 (EPIC-011, Analytics & AMR Surveillance) both completed this session — all 6 features shipped, both epics formally closed

Session 34 left M11/M12 unstarted. This session planned and shipped all six features across both
milestones in sequence (FEAT-051 → FEAT-052 → FEAT-053 → FEAT-054 → FEAT-055 → FEAT-056), then
closed both epic tracking issues (#500, #517) once every feature under them was done. **M11 and M12
are both now fully complete.**

### FEAT-051 (Microbiology organism & breakpoint catalog) — merged PR #523 (+ #524 retro), issue #501 closed, ADR-0045

The session's single hardest blocker: no real, citable clinical breakpoint data existed anywhere in
this codebase or KB. Resolved via genuine online research (WebFetch/WebSearch), not fabrication —
found the official EUCAST v16.0 PDF, extracted real S/I/R breakpoints via `pdftotext` (poppler-utils
installed root-free via `apt-get download` + `dpkg-deb -x`, same technique already used for
Chromium), cross-verified organism/antimicrobial SNOMED/ATC codes independently, presented findings
with page citations before use — explicitly approved by the human before implementing. New global,
RLS-exempt tables (`organism`/`antimicrobial`/`breakpoint_table`/`breakpoint`, ADR-0045, same
precedent as `analyte`/`unit`/`code_system_value`). **Real Constitution Gate CI failure found and
fixed**: the 4 new tables were correctly designed with no RLS but lacked the required
`-- RLS-exempt per ADR-NNNN` marker comment the gate's own grep looks for — fixed, verified locally
by simulating the gate's own logic first, logged as `engineering/database-design` Skill entry #16
(PR #524).

### FEAT-052 (Culture workflow & reflex cascade) — merged PR #512 (+ #513 retro), ADR-0046

Culture → organism-ID reflex pair (CULT/ORGID), `culture_read` workflow state. **A second
Constitution Gate false-positive class found and logged as retro**: the "block free-text clinical
value columns" check's naive regex flagged `culture_read.result` purely because the SQL column name
contained "result", despite being a real, bounded, CHECK-constrained enum (`'no_growth'|'growth'`).
Worked around by renaming the column to `outcome` (zero API/domain ripple, Drizzle's TS-field-vs-
SQL-column mapping absorbed it) — the check itself still has no real exclusion mechanism, so any
future bounded-enum column with a clinical-sounding name will trip it again.

### FEAT-053 (Susceptibility interpretation & antibiogram) — merged PR #525, issue #503 closed

`resolveSusceptibility()`/`interpretMic()` (mirrors `resolveReferenceRange()`'s pure-resolver shape,
effective-dated, never fabricates a match). Dual-emission Observation pattern (KB-21): one
`table`-typed Observation (readable grid) + N discrete `coded`-typed Observations (queryable atoms,
one per antimicrobial), written in one transaction. Deliberately does **not** link the 4 discrete
antimicrobial-susceptibility analytes onto ORGID's `test_analyte` (antibiotic panels vary by
organism) — but confirmed via reading `observation.controller.ts`'s `verify()` directly that it only
requires a `'preliminary'` row for `(orderedTestId, analyteId)`, never `test_analyte` membership, so
these are still independently verifiable via the existing generic endpoint. Manually verified
end-to-end against a real session (real E. coli identification, real MIC values, correct R/S
interpretation, confirmed dual-emission rows in Postgres) before shipping.

### FEAT-054 (Culture report template & preliminary/final lifecycle) — mechanism merged PR #516 (ADR-0047), remaining scope merged PR #528, issue #504 closed

Shipped in two parts, deliberately: the preliminary/final lifecycle **mechanism** itself has no
hard dependency on FEAT-051/052/053 (`report.reportType`, `assembleAndPersistPreliminaryReport()`,
proven against chemistry fixtures) and shipped mid-session, independent of the breakpoint-data
chain. Issue #504 stayed open afterward — its own AC #1 (author a real culture/antibiogram layout)
was genuinely blocked until FEAT-051/053 shipped. Once they did, a `/close` walkthrough picked this
back up:
- **Real gap found and fixed** (human sign-off on the approach, not a silent fix): `format
  ObservationValue()` only ever rendered `quantity`/`coded`/text observations — the antibiogram's
  own `table`-typed Observation (`valueJson` grid) silently fell through to a blank cell, never an
  error. Fixed with a small, additive formatter branch (a compact readable summary string, e.g.
  `"Escherichia coli — Ampicillin: R (MIC 16); Meropenem: S (MIC 1)"`) — deliberately not a new
  nested-grid rendering path, a real, separate architecture change out of this fix's own scope.
  Unit-tested directly (`report-assembly.spec.ts`).
- A genuine two-section culture report template (Organism Identification + Antibiogram) authored
  for real through the existing report-template API (`POST .../versions` + `.../publish`, the exact
  calls the FEAT-047 designer UI itself makes), proven in `culture-report-lifecycle.e2e-spec.ts`
  alongside a real preliminary → final lifecycle on a genuine culture panel. Persisted as durable
  seed data (`culture-report-template.sql`, wired into both `db-reset.sh` and `pr.yml`) so a fresh
  `pnpm db:reset` is demo-ready out of the box.
- **A test-file bug found only by a genuinely clean full-suite run**: the new e2e spec's own
  `beforeAll` queried tenant-scoped tables without first calling `set_config('app.tenant_id', ...)`,
  unlike every other spec file's own convention — an earlier run had (probably) masked this by
  running immediately after another spec file had already set it, since a broken vitest filter
  (see Skill entry below) silently ran the full suite every time a single-file run was intended.
  Fixed; confirmed via a real clean `pnpm db:reset` + full suite pass (53 files / 432 tests).

### FEAT-055 (AMR surveillance report) — merged PR #526, issue #508 closed

`GET /v1/reports/amr-surveillance`, `qa`-gated, organism × antimicrobial S/I/R rates over a
`from`/`to` window, mirrors `computeTatReport`'s own proven aggregation shape (FEAT-034). Only
`'verified'` susceptibility Observations count. e2e fixture spans two real organisms (E. coli,
S. aureus) against real EUCAST breakpoints, proves verified-only filtering (a deliberately-
unverified result is excluded).

### FEAT-056 (Cross-tenant de-identified AMR surveillance aggregation) — merged PR #527, issue #518 closed, ADR-0048

The first feature in this codebase that deliberately crosses tenant isolation, even de-identified.
Per-tenant iteration (not one cross-tenant SQL query — a `dedicated_schema` tenant's rows live in a
different Postgres schema entirely, invisible to a single query against the shared one), explicit
per-tenant opt-in (`tenant.amrSurveillanceOptIn`), `dedicated_db`-tier tenants skipped/logged (not
thrown), n<5 minimum-cell-size suppression + monthly time-bucketing minimum, no tenant/facility
identifier anywhere in the response shape, one real `audit_event` row per contributing tenant
(itself tenant-scoped, so no single cross-tenant audit row exists — a shared `requestId` correlates
them). New machine-only `platform-analytics` Keycloak client/capability (`lis-platform-analytics`,
same precedent as `gateway_ingest`/`interop_ingest`). e2e fixture spans all three isolation tiers
(one `shared`, one `dedicated_schema` with its own minimal cloned tables, one opted-out), synthetic
global catalog rows to guarantee zero collision with any other spec's real fixture data.

### `/close` cycle (walkthrough format, per the human's explicit request)

Per `~/work/lis-engineering/session-close-reports/2026-08-12-0008-pre.md`'s four pending items, all
addressed as a walkthrough of individual approve/defer decisions:
1. **FEAT-054's remaining scope shipped** — PR #528 (see above).
2. **Breadcrumb refresh** — this file.
3. **`engineering/testing` Skill entry #19 approved and shipped** — the `pnpm --filter api
   test:e2e -- <pattern>` filter does not actually filter to a single spec file in this repo (ran
   the full suite regardless, at least 4 separate times this session); confirmed working
   alternative documented: `pnpm --filter api exec vitest run --config
   ./test/vitest.e2e.config.ts test/<file>.e2e-spec.ts`. A related, smaller finding folded into the
   same entry: a background-task output capture on one of those full-suite runs was truncated at
   its own start, and a claim ("spec X passed, not among the 9 failed files") was stated to the
   human from an incomplete accounting (3 of 9 failures actually visible) — harmless that time, but
   flagged as its own practice note.
4. **Manual Verification Checklist items filed as follow-up issues**, not done in-session:
   #529 (real antibiogram S/I/R rendering in `apps/web`), #530 (real culture-report PDF appearance,
   specifically the new antibiogram summary string inside a real rendered table cell), #531 (rotate
   the `lis-platform-analytics` Keycloak client's checked-in dev-only secret before any real
   deployment).

Additionally, once every FEAT-* issue under both epics was confirmed closed, the human approved
closing **EPIC-010 (#500)** and **EPIC-011 (#517)** themselves — both closed with a comment noting
their own remaining open items (#506/507/509/510 under M11, #519/520 under M12) are deliberately-
deferred follow-ups, tracked independently, not blocking either epic's own closure.

## Carried into next session

- **New this session:** issues #529, #530, #531 (this session's own Manual Verification Checklist
  items, filed not done — see above).
- **New this session:** `engineering/testing` Skill entry #19 (broken `test:e2e -- <pattern>`
  filter) — worth any future session actually using the documented working alternative rather than
  rediscovering the broken filter again.
- EPIC-009 (#9, M10/Commercial Readiness) is still open despite M10 being 6/6 feature-complete
  since session 34 — carried forward twice now, still not formally closed. Worth resolving alongside
  or right after this session's own EPIC-010/011 closures, same reasoning.
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds screens) remains
  open, unstarted, unchanged.
- Issue #430 (rls-isolation-check.ts fixture-coverage gap) — this session added 4 new global,
  RLS-exempt tables (FEAT-051) and one new tenant-scoped column (FEAT-056's
  `tenant.amrSurveillanceOptIn`, on an already-covered table) — worth confirming neither needs a
  fixture-coverage update, not assumed.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted, unchanged.
- Issues #427 (backfill missing M1-M5 retrospectives), #267 (pnpm-workspace config ignored in CI)
  both remain open, untouched since filed.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- The staging droplet's `restore-drill.sh` cron job still has no active alerting beyond its own log
  file — unchanged, still worth a periodic human spot-check until real alerting exists.
- Manual verification still owed by a human, carried forward unchanged: FEAT-047's JSON-mode
  `visibilityCondition` editor (mechanically verified, not yet a live lab-admin pass); FEAT-048's
  shipped French translations (not yet a native-speaker review); FEAT-049's `/signup` UX + confirming
  `lis-onboarding`'s dev secret gets rotated before any real deploy; FEAT-046's take-payment UX +
  confirming the placeholder billing metadata reads unambiguously as placeholder; FEAT-045's
  Constitution-gate marker-recognition logic; a live technologist pass on FEAT-024's notes-textarea/
  grade-button spacing; a live pass confirming FEAT-022's SLA amber/red badges read clearly at a
  glance.
- **No open M11/M12 exploratory scope beyond the deliberately-deferred follow-up issues** (#506,
  #507, #509, #510, #519, #520) — pathology/histology-cytology was discussed as a possible future
  milestone (KB-16) but explicitly not started or scoped this session, purely exploratory.
