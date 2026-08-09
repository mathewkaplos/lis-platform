# Implementation Proposal: Staging seed step runs every discipline file unconditionally (idempotent per-file guards)
Status: APPROVED
ADR: adr-0022    Date: 2026-08-09    Backlog ID: #397

## 1. Goal
Fix #397: `.github/workflows/deploy-staging.yml`'s seed step gates `chemistry-catalog.sql` on
`SELECT count(*) FROM analyte` — "any seed data exists, skip." `db/seed/haematology-catalog.sql`
(TASK-071/FEAT-023, already merged) is never referenced by the workflow at all, and even once wired
in, this gate would skip it forever on any staging box that already has chemistry's rows (which is
every staging box, today). Per ADR-0022: delete the `analyte`-count gate, give `chemistry-catalog.sql`
the same `WHERE NOT EXISTS` idempotency guards `haematology-catalog.sql` already uses, and run both
seed files unconditionally, every deploy. Also close the second still-open piece of #397: copy
`haematology-catalog.sql` to the droplet and reference it in the seed step at all (today it isn't
copied or run, independent of the gating bug).

## 2. Affected files
- `db/seed/chemistry-catalog.sql` — add `WHERE NOT EXISTS` guards to every `INSERT` that lacks one,
  matching the exact pattern already established in `db/seed/haematology-catalog.sql` (e.g. L108:
  `WHERE NOT EXISTS (SELECT 1 FROM analyte existing WHERE existing.code_system_value_id = csv.id)`
  for the `analyte` insert; same shape for `test_definition`, `test_analyte`, `reference_range`
  inserts). No guard needed on the two `code_system_value` inserts if `code_system_value` itself has
  a unique constraint the `INSERT` already relies on without conflicting — confirmed during
  implementation, not assumed here (see §5).
- `.github/workflows/deploy-staging.yml` (~L300-313) — delete the `seed_count`
  check/if/else entirely; run `chemistry-catalog.sql` then `haematology-catalog.sql` unconditionally,
  each via the existing `-f - < seed/<file>.sql` pattern.
- `.github/workflows/deploy-staging.yml` "Copy compose file and realm config to droplet" step
  (~L131-144) — add a fourth `scp` copying `db/seed/haematology-catalog.sql` to
  `/opt/lis/seed/haematology-catalog.sql`, matching chemistry's existing copy line exactly.

## 3. Architecture consulted
- ADR-0022 (this proposal's own driver) — full decision and rejected-alternative reasoning.
- `db/seed/haematology-catalog.sql` itself — the guard pattern to replicate, already proven working
  in CI/local (TASK-071's own PR) and implicitly on staging once wired in.
- Issue #397's own filed text (TASK-071) — names run 30637495583 as the concrete duplicate-key
  failure the original `seed_count` gate was built to avoid; this proposal must not reintroduce it.
- `docs/plans/task-198-staging-db-migration-bootstrap.md` — precedent for how a staging-deploy-workflow
  change in this repo gets proposed (structure this document borrows from) and verified (dispatch +
  human console check, not just "the pipeline said success").

## 4. Skills loaded
- `engineering/docker-pnpm-monorepo-deploy` — deploy workflow structure and staging-specific
  constraints (no data wipe between deploys, 1 vCPU/1GB droplet memory pressure already documented
  from TASK-198's incident).
- `engineering/database-design` — idempotent-seed / `WHERE NOT EXISTS` pattern conventions.

## 5. Assumptions & autonomous decisions
- `chemistry-catalog.sql`'s two `code_system_value` inserts (LOINC/UCUM code rows) may already be
  protected by a unique constraint on `(system, code, version)` or equivalent, in which case a bare
  re-run either no-ops via `ON CONFLICT DO NOTHING` (if one exists) or needs the same `WHERE NOT
  EXISTS` treatment as the other inserts — this proposal does not assume which without checking the
  table's actual constraints first during implementation; whichever is true, the fix applies the same
  `WHERE NOT EXISTS` pattern haematology already uses for consistency rather than introducing
  `ON CONFLICT` as a second idiom in the same file.
- Running both seed files in the same deploy step, in sequence (chemistry then haematology), is
  sufficient — no need for them to run in parallel or as separate workflow steps; ADR-0022 doesn't
  specify ordering and the two disciplines' catalog data don't reference each other.
- No migration is required — this only touches seed data and the seeding step itself, not schema.

## 6. Risks
- **Reintroducing the original duplicate-key failure (run 30637495583) if any `chemistry-catalog.sql`
  insert is missed when adding guards.** Mitigated by matching haematology's already-proven pattern
  insert-by-insert rather than writing new guard logic, and by the acceptance criteria below requiring
  a second consecutive dispatch to prove true idempotency, not just a first successful run.
- **First real run against staging's already-seeded chemistry data** (unlike CI/local, which always
  starts empty) is the first time these specific guards are exercised against non-empty state for
  chemistry — closest precedent is haematology's own guards, which have only ever run against empty
  CI/local containers so far, never against pre-existing haematology data either. Still a first for
  both files in that sense.
- **Every future discipline seed file must remember to add its own guards** — this proposal doesn't
  add any enforcement (e.g. a CI check) for that; ADR-0022's Consequences section already flags this
  as a follow-up documentation callout, not something this task's scope covers.

## 7. Acceptance criteria
- A staging deploy dispatch with chemistry data already present (today's real state) also successfully
  inserts haematology's catalog rows — confirmed via `SELECT count(*) FROM analyte` before/after,
  and spot-checking a known haematology analyte code (e.g. a CBC LOINC code) exists post-deploy.
- A **second** consecutive dispatch, immediately after the first, completes with zero errors and zero
  duplicate rows (row counts unchanged from the first run) — proves both files are truly idempotent,
  not just "worked once."
- No `ON_ERROR_STOP=1` failure from either seed file in either run.

## 8. Testing plan
- Dispatch `deploy-staging.yml` manually (`workflow_dispatch`), watch the run, then have the human
  confirm row counts on the droplet directly via `psql` (same verify-by-console pattern task-198 used)
  — not just "the pipeline said success."
- Immediately re-dispatch and repeat the same row-count check to prove idempotency (the acceptance
  criterion above) before considering this done.

## 9. Rollback plan
- Both seed files are additive-only `INSERT`s; nothing here drops or alters existing rows. Reverting
  the PR restores the old (broken-for-haematology, but not actively harmful) gate — no data cleanup
  needed either direction.

## 10. Questions requiring human approval — ANSWERED 2026-08-09
1. **Guard style for `chemistry-catalog.sql`'s `code_system_value` inserts** — APPROVED: match
   haematology's `WHERE NOT EXISTS` idiom throughout, not `ON CONFLICT DO NOTHING`, even if a unique
   constraint turns out to already exist on that table.
2. **Timing of the verification dispatch** — APPROVED: deferred. PR goes up first; the manual
   `workflow_dispatch` verification runs only once the human is available to review it directly on
   the droplet, same pattern task-198/task-188 used. Not triggered automatically via a bare merge to
   `main`.
