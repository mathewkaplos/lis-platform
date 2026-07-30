# Implementation Proposal: FEAT-005 Observation store
Status: APPROVED
ADR: adr-0005 (accepted 2026-07-30 — forward-referencing columns), adr-0006 (accepted
2026-07-30 — observation.data_type is a native Postgres ENUM)    Date: 2026-07-30
Backlog ID: FEAT-005 (#14) / TASK-020 (#79) [first slice]

## 1. Goal

FEAT-005 (#14) is M1's next feature after FEAT-004: "the heart of the product: the
type-partitioned, structured result store." Per KB-14, this is described as *the* core
of the whole system — if everything else is built well but this is built wrong, the
project has failed. It has three tasks — TASK-020 (`observation` migration),
TASK-021 (append-only enforcement + `result_history`), TASK-022 (partitioning + trend
indexes) — covered together by this one proposal, following FEAT-004's precedent of one
proposal per feature so all three tasks share a consistent schema before any is built.

This proposal's immediate, concrete scope is **TASK-020**: the `observation` table
itself, the polymorphic value-type discriminator, and its foreign keys into the
FEAT-004 catalog tables (`analyte`, `unit`) that now exist. TASK-021/022 follow once
TASK-020 merges, under this same approved proposal, unless something they surface
warrants a revision.

This is also the first migration to exercise Constitution Law #1 (structured
Observations, not free text) and Law #2 (append-only, `superseded_by`/`amendment_of`)
against real content — TASK-016–018 exercised Law #4 (RLS); this is where #1 and #2
get their first real test.

## 2. Affected files

- `db/migrations/0004_observation.sql` (new) — raw SQL migration: `observation` table,
  indexes, RLS policy (tenant-scoped per the pattern established in TASK-017/018).
- `packages/db/src/schema/observation.ts` (new) — Drizzle schema mirroring the SQL
  migration, following the existing `reference-range.ts`/`test-catalog.ts` pattern
  (`pgTable` + `tenantIsolation()` policy + `.enableRLS()`).
- `packages/db/src/schema/index.ts` — export the new schema module (same pattern as
  the three existing schema files).
- `docs/scope/current.md` — breadcrumb update once TASK-020 merges.

TASK-021/022 will additionally touch:
- `db/migrations/0005_*.sql` — append-only trigger/constraint + `result_history` table.
- `db/migrations/0006_*.sql` — partitioning + trend indexes on `observation`.

## 3. Architecture consulted

- **KB-14 Result Engine** — the Observation model in full: polymorphic `dataType`
  (quantity/coded/ordinal/boolean/text/table/structured/attachment/ratio/datetime),
  the state machine (`registered → preliminary → verified → reported`, with
  `amended`/`corrected` branches), the "snapshot, never recompute" rule for
  unit/reference-range at result time, and the "one Observation per analyte" grain.
- **KB-06 Database Architecture** — the concrete canonical `observation` DDL (§"The
  observation table"), the Option-C decision (typed relational backbone, not
  EAV/pure-JSONB) that this table is the direct embodiment of, the trend index
  (`tenant_id, patient_id, analyte_definition_id, produced_at`), and "observations:
  immutable after verified; corrections insert new rows linked via `amendment_of`."
- **KB-15 Reference Ranges** (already loaded for TASK-018) — the snapshot fields
  (`ref_low`, `ref_high`, `ref_condition`, `ref_source`) this table captures onto each
  observation at write time, per FEAT-005's own AC.
- **Constitution (`five-invariants.md`)** — Law #1 (no clinical value as free text —
  the entire reason this table's `data_type` discriminator + typed columns exist)
  and Law #2 (append-only — directly TASK-021's scope, but the column shape
  `previous_observation_id`/`amendment_of` must exist from TASK-020 so TASK-021 has
  something to enforce against).
- **ADR-0004** — precedent for versioned/snapshotted catalog data; `observation`
  extends the same snapshot discipline to the *result* layer (snapshot the range/unit
  used at result time, never recompute it later even if the catalog range changes).

## 4. Skills loaded

- `workflow/plan` (this proposal), `workflow/develop` (for the implementation step
  once approved).
- `engineering/database-design` and `domain/result-verification` — **both required by
  FEAT-005's own issue, and neither exists yet** (same gap FEAT-004 hit with
  `domain/reference-ranges`/`engineering/database-design` and deferred). Noted again,
  not a blocker: author once TASK-020 surfaces real reusable lessons.

## 5. Assumptions & autonomous decisions

- **Table name and column set follow KB-06's canonical DDL directly** (§"The
  observation table"), translated to this repo's existing naming conventions
  (snake_case, `uuid` PK via `gen_random_uuid()`, `timestamptz` columns) rather than
  re-derived from scratch — KB-06 is explicit and was written for exactly this table.
- **`data_type` values are the ten from KB-14's table** (`quantity`, `ordinal`,
  `coded`, `boolean`, `text`, `ratio`, `datetime`, `table`, `structured`,
  `attachment`), stored as a native Postgres `ENUM` (`observation_data_type`), not
  `text` — a deliberate, scoped deviation from `reference_range`'s `range_type`/`sex`
  text-column convention. See §10 Q3 / ADR-0006 for the full reasoning.
- **RLS/tenant-scoping:** `observation` carries `tenant_id` + a `tenant_isolation`
  policy, same shape as `test_definition`/`panel`/`reference_range` (TASK-017/018) —
  this is squarely operational, tenant-varying clinical data, not global reference
  data like `analyte`/`unit`, so ADR-0004's Option-B/global carve-out does not apply
  here. Not routed to §10 as a question; the precedent is unambiguous.
- **`analyte_definition_id` in KB-06's DDL maps to this repo's existing `analyte.id`**
  (TASK-016) — KB-06 predates this repo's actual table-naming decisions; `analyte` is
  the table that exists, so the FK targets it directly rather than a table named
  `analyte_definition` that was never created.
- **Snapshot columns (`ref_low`, `ref_high`, `ref_condition`, `ref_source`, `unit`)
  are plain columns, not FKs** — by design, per KB-06/KB-14's explicit "snapshot,
  never recompute" rule: an observation must keep reading correctly even if the
  `reference_range` row it was resolved from is later superseded or the `unit` row's
  display changes. `unit_id` (FK) is *additionally* kept alongside the snapshotted
  `unit` text so the canonical unit is still traceable, mirroring `reference_range`'s
  own `unit_id` FK.

## 6. Risks

- **A real FK-sequencing gap exists between KB-06's canonical DDL and this repo's
  actual task order — routed to §10 Q1, not silently resolved.** KB-06's `observation`
  DDL FKs to `ordered_test(id)`, `specimen(id)`, and denormalizes `patient_id`. But in
  this repo's actual GitHub backlog: `ordered_test`/`specimen` don't exist until
  TASK-023 (FEAT-006, which *depends on* FEAT-005 per #15's own Dependencies field —
  i.e., comes after this task by design), and `patient` doesn't exist until TASK-038,
  which is **milestone M3**, two milestones after this one. TASK-020's own stated
  "Expected output" (`db/migrations/000X_observation.sql`) and AC ("numeric, coded,
  and text results all persist correctly") say nothing about these FKs being enforced
  yet, which is consistent with deferring them — but this needs an explicit decision,
  not an assumption, because it affects the column shape now and every later
  migration that adds the constraint.
- **Partitioning strategy (TASK-022) is downstream of TASK-020's shape.** KB-06 flags
  "exact partitioning key (time vs. tenant vs. composite)" as an open question at the
  KB level too — TASK-020 should not foreclose options TASK-022 will need (e.g.,
  `produced_at` must be part of the partition key if time-partitioned, which affects
  whether it can be nullable).
- **Append-only enforcement (TASK-021) needs the right column shape from TASK-020.**
  `previous_observation_id` and `amendment_of` must exist as of this migration even
  though the enforcement trigger/guard lands in TASK-021, or TASK-021 has nothing to
  build against.
- **First real test of Law #1/#2 against a wide polymorphic table.** The CHECK
  constraint pattern KB-06 shows (`(data_type='quantity') = (value_num IS NOT NULL) OR
  data_type <> 'quantity'`) needs one clause per `data_type`, which is more surface
  area for a mistake than TASK-016–018's narrower tables — worth deliberate,
  reviewed testing per value type, not just the one AC-cited case (numeric/coded/text).

## 7. Acceptance criteria

TASK-020's (#79) stated AC, plus how it will be judged:
- [ ] Numeric, coded, and text results all persist correctly via the `data_type`
      discriminator — judged by real `INSERT`s of at least one row per those three
      types against a running Postgres instance via `pnpm db:reset`, then `SELECT`
      back and confirm the correct typed column is populated and the others are null.

FEAT-005's feature-level AC, restated for full-feature context (not satisfied by
TASK-020 alone):
- [ ] An attempted `UPDATE` of a verified observation row fails — TASK-021
- [ ] A 5-year patient/analyte trend query returns correct results in under 100ms on
      seeded volume — TASK-022
- [ ] `reference_range_snapshot` is captured immutably on every observation at write
      time — TASK-020 provides the columns; a seed/insert test proves the snapshot
      values differ correctly from whatever the *current* `reference_range` row says
      after a deliberate post-insert range change, same "prove the negative case"
      standard TASK-018 used for RLS.

## 8. Testing plan

1. `pnpm db:reset` — confirm a clean migrate run with real output captured.
2. Insert one observation per `data_type` under test (quantity, coded, text at
   minimum, per TASK-020's literal AC) referencing a real seeded analyte/unit from
   TASK-016/#150's chemistry catalog seed.
3. Query each back; confirm the correct typed column is populated and CHECK
   constraints reject a mismatched combination (e.g., `data_type='quantity'` with
   `value_num` null).
4. RLS negative case: connected as `lis_app` (never `postgres`, per the TASK-017
   lesson), confirm a wrong/no-data tenant sees 0 rows.
5. Confirm the Constitution gate passes on this migration PR without weakening any
   invariant to get there.
6. `docker compose down -v` for a clean teardown afterward.

## 9. Rollback plan

Purely additive — `observation` is a new table with no existing data depending on it.
Rollback is a Drizzle down-migration dropping the table, or a straight `git revert` of
the migration file followed by `pnpm db:reset`. No production data exists at this
milestone, so there is no data-loss exposure from rolling back.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-30 — Option (a)+(b) combined.** `ordered_test_id`,
   `specimen_id`, and `patient_id` are required (`NOT NULL`) plain `uuid` columns
   with no FK constraint in TASK-020's migration; the FK constraints are backfilled
   via `ALTER TABLE` in the migration that creates each referenced table (TASK-023
   for `ordered_test`/`specimen`; the M3 patient migration, TASK-038, for
   `patient_id`). Recorded in **ADR-0005** (accepted), which is named generally
   ("forward-referencing columns") so it can be cited by any future table hitting
   the same cross-milestone-dependency shape, not just this one. Forward-linking
   comments citing ADR-0005 have been posted on TASK-023 (#82) and TASK-038 (#97)
   so the backfill step doesn't rely on anyone remembering it unprompted months
   from now.
   - ADR-0005 also records a known, deliberate open question surfaced during
     review, not discovered later: `patient_id NOT NULL` will conflict with
     FEAT-018 (#27, milestone M5 — QC results as Observations linked to a control
     lot, not a patient, per KB-27). Not a blocker for TASK-020; to be resolved
     when FEAT-018 is actually planned, per ADR-0005's Consequences section.
2. **RESOLVED 2026-07-30 — yes, drafted as ADR-0005** (see above). Kept separate
   from the `data_type`/ENUM decision (Q3) rather than combined into one ADR, since
   the two are unrelated decisions with different future citers — TASK-023/TASK-038
   only need the forward-reference pattern, not an opinion on enum usage.
3. **RESOLVED 2026-07-30 — Postgres `ENUM`, not `text`.** `observation.data_type`
   uses a native `observation_data_type` ENUM (the ten KB-14 values), a deliberate,
   scoped deviation from the `reference_range` text-column convention, justified by
   this column's centrality (every read/write path on the system's highest-volume
   table branches on it) and blast radius, not a general license to enum other
   discriminator columns. Recorded in **ADR-0006** (accepted).
4. **RESOLVED 2026-07-30 — confirmed.** One proposal for all of FEAT-005;
   TASK-020 starts now; TASK-021–022 follow as separate reviewed PRs under this
   same approval — same basis as FEAT-004's proposal.
5. **RESOLVED 2026-07-30 — additive: keep `amendment_of`, add `superseded_by`.**
   Constitution Law #2 says `superseded_by` links old to new; `observation` (as
   merged in TASK-020) has `amendment_of`, which links new to old — the
   structural inverse, not a synonym. Found on a direct line-by-line review of
   the merged migration against the Constitution's literal text, not during
   TASK-020's own review.
   - `amendment_of` (new→old, already merged, unchanged) stays as the O(1)
     "what did this row correct" lookup. `superseded_by` (old→new) is added by
     TASK-021, set on the predecessor row in the same transaction/trigger that
     inserts the new row and sets its `amendment_of` — giving `superseded_by IS
     NULL` as the cheap, single-column "current observations only" filter the
     Constitution's wording implies, without reworking TASK-020's already-shipped
     code.
   - Full analysis and the rejected alternatives (rewrite the Constitution;
     replace `amendment_of` entirely) are in **ADR-0007** (accepted).

**Approved 2026-07-30** — full FEAT-005 scope. TASK-020 was approved and merged
(PR #153, #155) once ADR-0005/0006 were accepted; TASK-021/022 were additionally
gated on Q5 above pending ADR-0007, which is now accepted. TASK-021 may proceed.
