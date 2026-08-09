# Implementation Proposal: Dedupe analyte-insert SELECTs against duplicate `unit` rows (task-410 follow-up)
Status: APPROVED
ADR: none (defensive bug fix, no architectural decision)    Date: 2026-08-09    Backlog ID: #410

## 1. Goal
task-410's first fix (PR #411, version-qualifying every `code_system_value` join)
did not resolve the outage — the second live deploy (run 31297473668,
2026-08-09T05:48:02Z) failed identically, same statement, same error class,
different UUID.

**Root cause now CONFIRMED, not hypothesized** — the human ran a direct
read-only query against the real staging `unit` table:

```sql
SELECT id, code_system_value_id FROM unit
WHERE code_system_value_id = (
  SELECT id FROM code_system_value WHERE system='UCUM' AND code='mg/dL' AND version='2.2'
);
```
```
                  id                  |         code_system_value_id
--------------------------------------+--------------------------------------
 ea8f08e8-29d6-4cd0-b3df-0b9a2c6f65ae | 674a3288-a860-4e1d-a057-7e18675a22cb
 5d3cc9d1-3374-4a6b-a80f-3b6924e6df0b | 674a3288-a860-4e1d-a057-7e18675a22cb
(2 rows)
```

Two `unit` rows genuinely reference the same `code_system_value_id` for
`mg/dL`. `unit.code_system_value_id` has no unique constraint
(`db/migrations/0000_catalog_base.sql`), so this is a real, pre-existing data
duplication — task-410's version-pin fix addressed a different table
(`code_system_value`) than the one that's actually duplicated (`unit`), which
is why it didn't help. The eGFR/LDL analyte insert's
`JOIN unit u ON u.code_system_value_id = ucsv.id` fans out against these two
rows for each of the four `mg/dL`-based analytes (LDL/Total Cholesterol/HDL/
Triglycerides), producing two source rows with the same `csv.id` within one
`INSERT`'s own result set — exactly the failure observed, twice.

## 2. Affected files
- `db/seed/chemistry-catalog.sql` — the eGFR/LDL analyte INSERT (currently
  the only one of the three analyte-insert statements in either file that is
  actively exercised — see §5) gets `SELECT DISTINCT ON (csv.id)` and a
  matching `ORDER BY csv.id, u.id`, so it can never emit more than one row
  per intended analyte regardless of how many `unit` rows match on the JOIN
  side. Applying the identical treatment to the file's other two
  analyte-insert statements (the original 14-analyte insert, and the same
  pattern in `haematology-catalog.sql`) for consistency and to close the same
  latent class of bug before it's ever exercised there too — not because
  either is currently failing.

## 3. Architecture consulted
- The confirmed query result above — this is the first fix in this incident
  verified against real staging state rather than a hypothesis.
- task-410's original proposal (`docs/plans/task-410-version-qualify-seed-
  catalog-joins.md`) — this is an explicit follow-up, not a revision of that
  one; that fix stands on its own merits (version-pinning is still correct
  and worth keeping) but was insufficient alone.

## 4. Skills loaded
- `engineering/database-design` — same one both prior task-410 work and
  task-397 used.

## 5. Assumptions & autonomous decisions
- **Why only the eGFR/LDL statement is currently at risk in practice:** the
  original 14-analyte insert (chemistry step 3) and haematology's 20-analyte
  insert both already have all their target rows committed from the very
  first successful historical seed (before the duplicate `unit` row
  presumably arose) — their own `WHERE NOT EXISTS` guards now filter
  everything out (`INSERT 0 0` every run, confirmed in both failed runs'
  logs), so a JOIN fan-out there currently produces zero output rows
  regardless. They are still fixed here defensively (same latent risk if a
  row were ever deleted and re-seeded, or a new LOINC code sharing an
  existing duplicated unit were added later), not because either is
  presently broken.
- **Picking a deterministic winner among duplicate `unit` rows is safe
  either way** — both existing rows share the same `code_system_value_id`
  and neither has a distinguishing `display_override` (the file's own `unit`
  INSERT never sets one; not independently verified against the live rows
  from this session, but not load-bearing either way since
  `default_unit_id` only needs to resolve to *a* valid unit for the correct
  `code_system_value_id`, which either duplicate satisfies identically).
  `ORDER BY csv.id, u.id` picks the lexicographically-first `u.id` — an
  arbitrary but stable, deterministic choice.
- **Not deleting the stray duplicate `unit` row** — the defensive query
  fix makes it harmless going forward without requiring a live DELETE this
  session. Left as an optional cleanup the human can do directly on the
  droplet later if desired; not blocking this fix.

## 6. Risks
- **This is the third fix attempt for the same incident.** Unlike the first
  attempt, this one is grounded in a confirmed query result, not a
  hypothesis — but it will still trigger a third automatic staging deploy on
  merge. Verified locally against the exact confirmed shape before asking
  for approval (see §8) specifically to avoid a third blind guess.
- If some *other*, still-undiscovered duplicate exists elsewhere in the
  catalog data (a different shared unit, a different code_system_value),
  this fix would not address it — but `DISTINCT ON` at the analyte-insert
  level is a structural guarantee against fan-out from *any* upstream
  duplication in this specific JOIN chain, not just the confirmed `mg/dL`
  case, so it's robust against variants of the same failure mode even if the
  exact duplicate differs from what was confirmed.

## 7. Acceptance criteria
- The eGFR/LDL analyte insert (and the other two analyte-insert statements,
  defensively) can never emit two rows for the same `code_system_value_id`
  regardless of upstream `unit`/`code_system_value` duplication.
- Local reproduction of the CONFIRMED failure shape (two `unit` rows for the
  same `code_system_value_id`) succeeds with zero errors.
- task-397's idempotency check (fresh seed, then re-seed) still passes.

## 8. Testing plan — already executed before requesting approval, given this is attempt 3

**Results (all before requesting approval):**
1. **Reproduced the exact confirmed staging failure locally, against the
   currently-merged (version-pinned-only) code**: fresh DB, seeded, then
   inserted a second `unit` row referencing the same `code_system_value_id`
   as the existing `mg/dL` row (matching the real staging query result
   exactly — two rows, same `code_system_value_id`), deleted the eGFR/LDL
   analytes to re-expose the insert, re-ran the seed file — got the
   **identical error**: same statement, same line, same
   `duplicate key value violates unique constraint
   "analyte_code_system_value_id_unique"`, same 12x `INSERT 0 0` pattern
   preceding it as the real staging logs. Confirms the reproduction
   genuinely matches reality, not just a plausible-looking guess (attempt
   1's mistake).
2. **Applied the `DISTINCT ON` fix and re-ran against that exact same
   corrupted state, no reset in between** — all 17 statements succeeded,
   zero errors, `INSERT 0 5` for the analyte insert. Verified all 5 analytes
   have distinct `code_system_value_id`s and the four `mg/dL`-based ones all
   consistently reference the same `default_unit_id` (deterministic
   tie-breaking confirmed, not arbitrary-per-row).
3. **Stress-tested haematology's identical fix** the same way: injected a
   duplicate `g/dL` unit row, deleted Hemoglobin/MCHC, re-ran
   `haematology-catalog.sql` — zero errors, both analytes re-inserted
   cleanly (`INSERT 0 2`).
4. **Re-ran task-397's own idempotency check** (fresh full seed via
   `db-reset.sh`, then re-run both files against the now-seeded DB) — zero
   errors, zero new rows, confirming no regression to that work.
5. Local dev DB reset back to a clean state afterward.

## 9. Rollback plan
- Purely additive `DISTINCT ON`/`ORDER BY` on existing `SELECT`s — no schema
  change, no data deletion, no behavior change for the non-duplicated case.
  Reverting restores the previous (still-broken) behavior; no cleanup needed
  either direction.

## 10. Questions requiring human approval
1. **Approve implementing and merging this fix?** Given this is a third
   attempt on a live incident, and unlike attempts 1 this one is grounded in
   your own confirmed query result and was verified locally against that
   exact reproduced shape before this proposal was written — see §8's actual
   results below once filled in.
2. **The stray duplicate `unit` row itself** — leave it in place (harmless
   once this fix lands) or delete it directly on the droplet as a one-time
   cleanup? Not required for correctness either way.
