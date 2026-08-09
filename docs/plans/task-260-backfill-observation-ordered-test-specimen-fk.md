# Implementation Proposal: Backfill `observation.ordered_test_id`/`specimen_id` FK (issue #260)
Status: APPROVED
ADR: none (executes ADR-0005's own already-decided acceptance criteria — no new load-bearing decision)
Date: 2026-08-09    Backlog ID: issue #260

## 1. Goal

Close issue #260: `observation.ordered_test_id` and `observation.specimen_id` have been plain,
unenforced `uuid` columns since TASK-020, and ADR-0005 explicitly required TASK-023 (`order`,
`ordered_test`, `specimen`) to backfill their FK constraints in the same migration that created
those tables — TASK-023 merged without doing so, silently unmet since. `patient_id` got the
equivalent backfill correctly, in TASK-038 (`packages/db/src/schema/patient.ts`'s own
`.references()`). This proposal backfills the same for the other two columns, nothing else.

Not a new decision: ADR-0005 already specifies the shape (§Decision, §Acceptance criteria). This
proposal exists only because a schema/DB change still needs one per this repo's own workflow
(`develop`'s gate), not because anything here is undecided.

## 2. Affected files

- `packages/db/src/schema/observation.ts` — add `.references(() => orderedTest.id)` /
  `.references(() => specimen.id)` to the two existing column definitions (mirrors `patientId`'s
  own `.references(() => patient.id)` immediately below them), plus new imports of `orderedTest`
  (from `./order`) and `specimen` (from `./specimen`). Both columns stay nullable — ADR-0015
  already made them nullable for QC rows; this proposal only adds the FK, never touches
  nullability.
- New migration `db/migrations/0025_observation_ordered_test_specimen_fk.sql` — the actual `ALTER
  TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements, generated via `drizzle-kit generate` off
  the schema change above (confirmed below that the current snapshot baseline is clean, so
  `generate` should produce exactly these two statements and nothing extra — `database-design`
  Skill entry #5's hand-written-migration/stale-snapshot risk does not apply here since no
  hand-written migration since 0024 has left the snapshot out of sync; verified via a baseline
  `drizzle-kit generate` run this session, "No schema changes, nothing to migrate").
- `db/migrations/meta/0025_snapshot.json` + `_journal.json` entry — produced automatically by
  `drizzle-kit generate`, not hand-edited.
- No other files. Every real caller was checked (see §5) and none needs to change.

## 3. Architecture consulted

- **ADR-0005** (forward-referencing columns) — the decision this proposal executes; its
  acceptance criteria for these two columns specifically, unmet since TASK-023.
- **ADR-0015** (QC observations share the observation table via nullable subject columns) —
  confirms both columns must stay nullable; a plain FK (not `NOT NULL`) permits `NULL` rows
  through unchanged (Postgres FK checks apply only to non-null values under the default `MATCH
  SIMPLE`), so this is fully compatible with ADR-0015's QC-row shape without any `MATCH FULL`
  complication (unlike the composite `previous_observation_id`/`amendment_of` FKs migration 0011
  fixed — those are two-column composite FKs with a real partial-null hazard; these two are plain
  single-column FKs referencing a single-column PK, no equivalent risk).
- **`engineering/database-design` Skill, entry #4** ("Backfilling a forward-reference FK can
  silently break existing fixture/demo code that used a fake id for that column") — directly
  applicable; see §5 for the grep this entry mandates before considering the fix done.
- **`engineering/database-design` Skill, entry #5** ("Hand-written migrations need a manually
  reconciled drizzle-kit snapshot") — checked; not applicable, baseline is clean (see §2).
- Issue #260 itself — states the exact fix (the two `ALTER TABLE` statements) and the exact
  verification bar ("confirming Postgres actually rejects an insert with a non-existent
  `ordered_test_id`/`specimen_id`, not just that the migration file contains the statement").

## 4. Skills loaded

- `engineering/database-design` — entries #2 (why the columns were unenforced originally), #4, #5
  as above.
- `engineering/testing` — for the RLS-check/e2e verification convention.

## 5. Assumptions & autonomous decisions

- **Grep for every `.insert(observation)` call site across the whole repo, per Skill entry #4's
  explicit rule, done during this proposal's own research** (not deferred to implementation):
  found 12 call sites (`apps/api/test/control-lot.e2e-spec.ts` ×4, `apps/api/test/qc-westgard.e2e-spec.ts`,
  `apps/api/test/delta-check.e2e-spec.ts`, `apps/api/test/observation.e2e-spec.ts`,
  `apps/api/src/observation/observation.controller.ts`, `apps/api/src/control-lot/control-lot.controller.ts`,
  `packages/db/src/rls-isolation-check.ts` ×3). Every one either (a) is a QC-shaped row
  (`isControl: true`), which never sets `orderedTestId`/`specimenId` at all — nullable FK is a
  no-op for these, or (b) uses a real, already-inserted `orderedTest`/`specimen` row's id (traced
  each one: `rls-isolation-check.ts` creates real `ot`/`sp` rows first; `control-lot.e2e-spec.ts`'s
  `createPatientFlowFixtures()` helper does the same; `observation.controller.ts`/
  `control-lot.controller.ts` pass through caller-validated `params.orderedTestId`/`specimenId`;
  `observation.e2e-spec.ts`'s amendment test reads `predecessorBefore.specimenId` off an existing
  row). **No call site uses a fake/sentinel id for either column** — unlike `patient_id`'s
  historical sentinel-UUID breakage (Skill entry #4's own origin story), already fixed by TASK-038
  before this repo's current state. Nothing needs to change in any caller.
- Migration generated via `drizzle-kit generate`, not hand-written — the schema-file change is
  fully within drizzle's own vocabulary (a plain `.references()`), no hand-editing expected; will
  diff the generated SQL against the two statements issue #260 itself specifies before accepting
  it.

## 6. Risks

- Low. The grep in §5 is the one genuine risk this class of change carries (Skill entry #4), and
  it came back clean. The only remaining risk is a real row somewhere in a long-running local dev
  or staging database that predates TASK-023/038 and still carries a stale, non-existent
  `ordered_test_id`/`specimen_id` — the migration's `ADD CONSTRAINT` would fail outright against
  such a row, loudly, at migration time (not silently). No production data exists yet at this
  milestone (same accepted-gap framing ADR-0005 itself already uses), so this is theoretical for
  local/CI but a real thing to watch when this reaches a real staging/production dataset later.

## 7. Acceptance criteria

(from issue #260, verified per its own stated bar)

- [ ] `packages/db/src/schema/observation.ts`'s `orderedTestId`/`specimenId` columns carry
      `.references(() => orderedTest.id)` / `.references(() => specimen.id)`.
- [ ] The generated migration adds `observation_ordered_test_id_fk` and
      `observation_specimen_id_fk` FK constraints, and nothing else.
- [ ] A direct insert with a non-existent `ordered_test_id` (or `specimen_id`) is **rejected by
      Postgres** (a real FK violation, not just a passing test that never exercises the bad path) —
      verified with a real `INSERT ... ON CONFLICT` style negative test, not just re-running the
      existing positive-path suite.
- [ ] Every existing `.insert(observation)` call site (§5's list) still passes unchanged.

## 8. Testing plan

- `pnpm --filter @lis/db generate` — confirm the diff is exactly the two `ADD CONSTRAINT`
  statements, nothing else (baseline confirmed clean this session).
- `pnpm db:reset` (fresh migrate + seed) — confirms the migration applies cleanly to a clean DB.
- New negative test (either a small standalone script or added to
  `packages/db/src/rls-isolation-check.ts`'s own style of direct-DB proof) asserting a raw insert
  with `orderedTestId: randomUUID()` (a real, freshly-generated, guaranteed-nonexistent id) against
  a real `ordered_test`/`specimen`-free value throws a Postgres FK violation — this is the literal
  bar issue #260 sets, not assumed from the migration file's own text.
- Full `apps/api` e2e suite (`pnpm --filter api test:e2e`) on the freshly reset DB — confirms every
  real call site in §5 still passes.
- `pnpm run-golden-datasets` — unrelated but cheap, confirms no incidental drift.

## 9. Rollback plan

A `DROP CONSTRAINT` migration reverses this cleanly — no data is modified, only a constraint is
added. If the constraint fails to apply against real data (see §6), the fix is to identify and
correct the offending row(s), not to abandon the constraint (per ADR-0005's own "mandatory, not
optional cleanup" framing of this exact backfill).

## 10. Questions requiring human approval

None — this executes an already-accepted ADR's own stated, unambiguous acceptance criteria; no new
judgment call surfaced during this proposal's own research.
