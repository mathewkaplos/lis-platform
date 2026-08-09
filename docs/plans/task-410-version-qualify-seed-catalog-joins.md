# Implementation Proposal: Version-qualify every code_system_value join in the discipline seed files
Status: APPROVED
ADR: none (defensive bug fix, no architectural decision)    Date: 2026-08-09    Backlog ID: #410

## 1. Goal
Fix #410: the eGFR/LDL analyte INSERT in `db/seed/chemistry-catalog.sql` hit a real
`duplicate key value violates unique constraint "analyte_code_system_value_id_unique"`
error on staging (deploy run 31295900821, 2026-08-09T05:04:23Z) — the first time
that statement ever ran against real staging data, since #397's fix removed the
gate that had been silently skipping it forever. The statement's `WHERE NOT
EXISTS` guard only checks already-committed rows; it cannot prevent a unique-
constraint violation between two rows generated within the same `INSERT ...
SELECT`'s own result set. Root cause: the statement's JOINs match
`code_system_value` by `(system, code)` only, with no `version` filter —
`JOIN code_system_value ucsv ON ucsv.system = 'UCUM' AND ucsv.code = a.ucum_code`.
If more than one `code_system_value` row exists for `('UCUM','mg/dL')` on
staging (or more than one `unit` row for that same `code_system_value_id` —
`unit.code_system_value_id` has no unique constraint), this JOIN fans out,
producing two source rows sharing the same `csv.id` for one of the four
`mg/dL`-unit analytes.

Fix: every `code_system_value` join in both discipline seed files gets an
explicit `version` predicate matching the literal version string that file's
own `INSERT` already uses for that code system (`'2.78'` for every LOINC row,
`'2.2'` for every UCUM row, confirmed identical across both files). This turns
an implicit "assume exactly one row" assumption into an explicit guarantee —
closes the whole class of fan-out bug regardless of which table actually holds
the duplicate on staging today, since I have no direct DB access to confirm
that from this session.

## 2. Affected files
- `db/seed/chemistry-catalog.sql` — 6 unversioned `JOIN code_system_value`
  occurrences (lines 78-79, 112, 223-224, 247 as of `2556ae3`), each gets its
  matching `version` predicate added.
- `db/seed/haematology-catalog.sql` — 3 unversioned occurrences (lines 105-106,
  125), same treatment, for consistency and because it's exposed to the exact
  same latent-duplicate risk even though it hasn't hit the bug yet.

## 3. Architecture consulted
- Issue #410's own filed text (this session's incident investigation) — full
  root-cause hypothesis and evidence.
- `db/migrations/0000_catalog_base.sql` — confirms `analyte` has a real
  `UNIQUE(code_system_value_id)` constraint (the one that fired) and `unit` has
  none on `code_system_value_id` (already known from haematology-catalog.sql's
  own step-2 comment, reused here as further evidence for the fan-out
  hypothesis).
- `docs/plans/task-397-staging-seed-idempotent-discipline-files.md` /
  ADR-0022 — the change that exposed this latent bug; this proposal doesn't
  revisit that decision, only fixes what it uncovered.

## 4. Skills loaded
- `engineering/database-design` — idempotent-seed conventions, same one
  task-397 used.

## 5. Assumptions & autonomous decisions
- The exact literal version string to pin is unambiguous: every LOINC row in
  both files uses `'2.78'`, every UCUM row uses `'2.2'` (confirmed via grep
  across both files, no exceptions). No judgment call needed on which version
  to pick.
- This fix does not attempt to identify or clean up whatever duplicate row(s)
  actually exist on staging today (unconfirmed, no DB access) — it only
  prevents the *join* from being ambiguous going forward. If a genuinely
  duplicate/stray `code_system_value` or `unit` row exists on staging, it will
  simply become unreferenced by any future seed run rather than being deleted
  by this change — cleanup of pre-existing stray rows, if needed, is a
  separate, DB-access-requiring task, not blocking this fix.
- Not attempting to add a real `UNIQUE` constraint on `unit.code_system_value_id`
  in this proposal — that's a schema change (a new migration) with broader
  implications worth its own decision, out of scope for an urgent seed-file fix.

## 6. Risks
- **Cannot be verified against the actual staging duplicate without DB access**
  from this session — local verification (fresh DB, no drift) cannot reproduce
  the fan-out bug at all, since a fresh DB never has the duplicate row in the
  first place. Verification here is necessarily "the fix is defensively
  correct by construction" (an explicit version-pinned join cannot fan out),
  not "reproduced and confirmed fixed" the way task-397's idempotency was
  verified locally.
- If the true root cause is something other than a duplicate `code_system_value`/
  `unit` row (unconfirmed hypothesis), this fix would not resolve the next
  deploy's seed attempt, and the same error could recur — the human should
  watch the next `Deploy to Staging` run's seed step specifically after this
  merges, not assume success from green CI alone (CI's fresh containers can't
  catch this class of bug, as this incident itself demonstrates).

## 7. Acceptance criteria
- Every `JOIN code_system_value` in both seed files includes an explicit
  `version` predicate.
- Local fresh-seed + re-seed idempotency check (same method task-397 used)
  still passes — this fix must not regress the idempotency work #397 just
  landed.
- `pnpm typecheck`/CI green (no code changes outside SQL, but confirms nothing
  else broke).

## 8. Testing plan
- Local: `scripts/db-reset.sh` (fresh seed), then re-run both seed files a
  second time against the now-seeded DB — same idempotency check task-397's
  PR used, to confirm this fix doesn't reintroduce a regression there.
- Cannot locally reproduce the actual fan-out bug (requires the specific
  duplicate row state only staging has) — acknowledged in §6, not something
  this testing plan can close before merge.
- After merge and the next automatic staging deploy: human confirms the seed
  step's specific log output (not just overall run conclusion) shows the
  eGFR/LDL analyte statement succeeding, not just that the run went green.

## 9. Rollback plan
- Purely additive `AND version = '...'` predicates on existing JOINs — no
  schema change, no data deletion. Reverting the PR restores the exact
  previous (bugged) behavior; no cleanup needed either direction.

## 10. Questions requiring human approval
1. **Scope: chemistry-catalog.sql only, or both files?** Proposal defaults to
   both (haematology-catalog.sql has the identical unversioned-join pattern,
   even though it hasn't hit the bug yet) — confirm, or scope down to only the
   file that actually failed.
2. **Timing:** this is a real fix to a currently-broken pipeline. Once
   approved and merged, the next push to `main` will trigger another automatic
   staging deploy attempt (same mechanism that caused today's outage) — worth
   being present to watch that specific run, not just assuming green CI means
   staging is healthy again.
