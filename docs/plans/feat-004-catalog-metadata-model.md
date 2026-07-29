# Implementation Proposal: FEAT-004 Catalog metadata model
Status: APPROVED
ADR: adr-0004 (accepted 2026-07-30 — catalog reference tables are global, not tenant-scoped)    Date: 2026-07-30    Backlog ID: FEAT-004 (#13) / TASK-016 (#75) [first slice]

## 1. Goal

FEAT-004 (#13) is M1's foundational feature: "tests, analytes, units, and reference
ranges exist as data, not code." It has four tasks — TASK-016 (analyte/unit/code_system_value),
TASK-017 (test_definition/test_analyte/panel), TASK-018 (reference_range), TASK-019
(seed the design partner's real chemistry catalog) — each to be implemented and merged
as its own reviewed slice, but per FEAT-004's own Definition of Done, this one proposal
covers the feature as a whole so all four migrations share one consistent schema design
before any of them is built.

This proposal's immediate, concrete scope is **TASK-016**: the first migration this
repo has ever had, wiring up Drizzle (already named as the ORM in AGENTS.md) for real,
and retiring the "NOT YET IMPLEMENTED: migrate + seed" gap left deliberately open in
`scripts/db-reset.sh` by the prior session (PR #139). TASK-017–019 follow once TASK-016
merges, under this same approved proposal, unless something they surface warrants a
revision.

This is also the first migration to actually exercise the Constitution CI gate
(`constitution-gate.yml`, TASK-015/#74) against real content — #132 has been blocked on
exactly this for two sessions.

## 2. Affected files

- `db/migrations/0001_catalog_base.sql` (new) — raw SQL migration: `analyte`, `unit`,
  `code_system_value` tables, indexes, and RLS policies (pending Q1 in §10).
- `packages/db/` (new workspace package, pending confirmation in §10 Q3) — Drizzle
  schema (TypeScript) mirroring the SQL migration, plus `drizzle.config.ts` and the
  migration runner wiring.
- `apps/api/package.json` — add `drizzle-orm`, `drizzle-kit`, `pg` (or `postgres.js`)
  as dependencies (currently absent from every `package.json` in the repo — confirmed
  by grep).
- `scripts/db-reset.sh` — replace the `NOT YET IMPLEMENTED` line with an actual
  migrate step (`drizzle-kit migrate` or equivalent) — this is the concrete fix for
  the AC2 gap flagged in PR #139 and the current `docs/scope/current.md`.
- `.env` / `.env.example` — `DATABASE_URL` already present and correctly shaped
  (`postgresql://postgres:postgres@localhost:5432/lis`); no change expected.
- `docs/scope/current.md` — breadcrumb update once TASK-016 merges.

## 3. Architecture consulted

- **KB-02 Domain Model** — establishes the catalog/operational/reference three-layer
  split, the `AnalyteDefinition`/`TestDefinition`/`PanelDefinition`/`ReferenceRange`
  vocabulary, and the "snapshot on commit" rule (operational records reference catalog
  definitions by ID and snapshot the parts that must not change retroactively).
- **KB-06 Database Architecture** — PostgreSQL as engine of record; the
  Option-C (typed relational + narrow JSONB) decision; **"every operational/catalog
  row carries `tenant_id`"** and RLS as the isolation mechanism; catalog tables are
  **"versioned rows (never hard-updated after publish)"**; schema-per-bounded-context
  (`catalog` schema owns analyte/test/panel/method/reference_range).
- **KB-15 Reference Ranges** — the multi-dimensional range model and resolution
  algorithm (relevant to TASK-018, included here for full-feature context so TASK-016's
  `analyte`/`unit` shape doesn't box in TASK-018 later).
- **Constitution (`five-invariants.md`)** — Law #2 (append-only) and Law #4 (structural
  RLS) both bear directly on this migration's shape.
- **ADR-0001** (pnpm monorepo layout) — confirms `db/` at repo root is the right home
  for raw migrations; doesn't cover Drizzle's own package placement (see Q3).
- **No existing ADR** resolves whether catalog reference tables are tenant-scoped or
  global — this is genuinely undecided, not just unread. See §10 Q1.

## 4. Skills loaded

- `workflow/plan` (this proposal), `workflow/develop` (for the implementation step
  once approved).
- `engineering/docker-pnpm-monorepo-deploy` — relevant for adding new dependencies to
  the pnpm workspace without repeating M0's lockfile/`injectWorkspacePackages` issues.
- `domain/reference-ranges` and `engineering/database-design` — **both required by
  FEAT-004's own doc, and neither exists yet** (`lis-engineering/skills/domain/` and
  `skills/engineering/` currently contain no such Skill files). Noted as a gap, not a
  blocker — per the standing rule "every hard-won fix becomes a Skill the same day,"
  one or both should be authored once TASK-016 actually surfaces reusable lessons,
  rather than written speculatively now with nothing to generalize from yet.

## 5. Assumptions & autonomous decisions

- **Migration tool is Drizzle** — not treated as an open question, since AGENTS.md
  already states it explicitly ("DB: PostgreSQL 16 (Drizzle ORM + raw SQL)").
- Raw SQL migrations live in `db/migrations/*.sql`, matching TASK-016's own "Expected
  output" field verbatim and the existing (currently empty) `db/` directory at repo
  root. Drizzle's TypeScript schema mirrors these for type-safe querying from
  `apps/api`, consistent with the stack's stated "ORM + raw SQL" hybrid rather than
  picking one or the other.
- `code_system_value` is modeled as **one shared, system-agnostic lookup table**
  (columns: `system`, `code`, `version`, `display`) rather than a bespoke table per
  coding system, since TASK-016 groups all three tables in a single migration and
  KB-02's `CodedConcept {system, code, display}` value object is explicitly
  system-agnostic (LOINC now; UCUM, SNOMED, etc. later reuse the same shape).
- `unit` is its own reference table (UCUM-coded), not a text column inlined on
  `analyte`, so TASK-018's `reference_range` and the eventual `observation` table
  (KB-06, milestoned FEAT-005) both foreign-key to one validated unit list instead of
  each duplicating UCUM strings.
- No autonomous decision made on tenant-scoping of these three tables — routed to §10
  Q1, since it's genuinely load-bearing and the KB documents pull in different
  directions (see below).

## 6. Risks

- **Getting the tenant-scoping/versioning decision wrong now is expensive to unwind**
  — TASK-017/018/019, and eventually FEAT-005's `observation` table, all build on top
  of `analyte`/`unit`'s shape. This is the direct reason §10 asks rather than assumes.
- **First-time Drizzle setup** in a repo that has never had a working ORM or migration
  runner — connection pooling, wiring the migration runner into `db:reset` and CI, and
  getting `drizzle-kit`'s generated SQL to actually match what's committed in
  `db/migrations/` are all plausible first-time friction points, echoing the
  pnpm/Docker first-run pattern from M0.
- **The Constitution gate has never been exercised against real content.** Its RLS
  check (`constitution-gate.yml`) is a regex over the raw `git diff` looking for
  `CREATE TABLE \w+` and a matching `ENABLE ROW LEVEL SECURITY`/`ON <table>` line. If
  Drizzle-generated SQL formats these differently than the regex expects, the gate
  could either false-negative (miss a real gap — the worse failure mode) or
  false-positive (block a correct migration). Per the M0 lesson, a green Constitution
  Gate check on this PR should be treated as one data point, not proof — #132 exists
  to make this explicit and should be closed off the back of this PR, not assumed.

## 7. Acceptance criteria

TASK-016's (#75) stated AC, plus how it will be judged:
- [ ] A LOINC-coded analyte inserts and is queryable by its (system, code, version)
      tuple — judged by an actual `INSERT` + `SELECT` against a running Postgres
      instance via `pnpm db:reset` + a real query, not a schema read-through.

FEAT-004's feature-level AC, restated for full-feature context (not satisfied by
TASK-016 alone — tracked here so this proposal's scope is visible against the whole
feature it's approving):
- [ ] A CBC panel resolves to its constituent analytes in a single query — TASK-017
- [ ] Reference range resolves correctly for age/sex/method on a seeded case — TASK-018
- [ ] Design partner's real chemistry test menu is seeded and queryable — TASK-019

## 8. Testing plan

1. `pnpm db:reset` — drop, recreate, and (new capability) actually migrate; confirm a
   clean run with real output captured, not narrated.
2. Insert one real LOINC-coded analyte row (e.g., Hemoglobin, LOINC `718-7`) via a
   seed script or direct `psql`.
3. Query by the `(system, code, version)` tuple; confirm the exact row returned.
4. Per ADR-0004, none of `analyte`/`unit`/`code_system_value` are tenant-scoped, so
   there is no RLS negative case to test in this migration — the "test the negative
   case, not just the positive" standing rule applies instead to TASK-017/018, once
   their genuinely tenant-scoped tables land.
5. Confirm the Constitution gate passes on this migration PR without weakening any
   invariant to get there — noting per ADR-0004 that this does not resolve #132.
6. `docker compose down -v` for a clean teardown afterward.

## 9. Rollback plan

Purely additive — `db/` is currently empty, so this migration alters no existing
schema. Rollback is a Drizzle down-migration dropping the three new tables, or a
straight `git revert` of the migration file followed by `pnpm db:reset`. No production
data exists at this milestone, so there is no data-loss exposure from rolling back.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-30 — Option B.** `analyte`/`unit`/`code_system_value` are
   global, platform-shipped reference data with no `tenant_id` column at all;
   `reference_range` (TASK-018) and `test_definition`/`panel` (TASK-017) carry
   `tenant_id` + RLS. Recorded in **ADR-0004** (accepted), which also amends
   KB-06's multi-tenancy section with the cross-referenced exception in the
   same commit (`lis-engineering` `7ff2c4c`).
2. **RESOLVED 2026-07-30, via ADR-0004.** Confirmed: Law #4 constrains tables
   that *are* tenant-scoped; it does not mandate every table be tenant-scoped.
   A genuinely global table with no tenant column sits outside its scope. ADR-0004
   also states explicitly that this does **not** resolve #132 — a gate passing
   on correctly RLS-exempt tables proves nothing about whether it would catch a
   real violation; #132 stays open until TASK-017/018 land and the gate is
   tested against a deliberately-broken tenant-scoped table.
3. **Proceeding with the recommended option (new `packages/db`)** — not
   separately confirmed line-by-line, but not objected to when the proposal was
   approved. Noting this explicitly rather than treating silence as a stronger
   signal than it is: if this turns out to be the wrong call, it's a cheap
   package-boundary move at this stage, not a schema decision.
4. **Proceeding with the stated scope reading** (one proposal for all of
   FEAT-004; TASK-016 starts now; TASK-017–019 follow as separate reviewed PRs
   under this same approval) — same basis as above.

**Approved 2026-07-30.** Status moved to APPROVED once ADR-0004 was accepted
and committed; TASK-016 implementation begins from this point.
