# Implementation Proposal: Wire the RLS isolation check into CI
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-22    Backlog ID: n/a (coverage-improvement follow-up)

## 1. Goal

Per the user's request to keep improving automated test coverage:
`packages/db/src/rls-isolation-check.ts` (a real, live cross-tenant RLS
leak check across all 45 tenant-scoped tables) existed but was manual-only
— its own header comment explained this was because CI had no
DATABASE_URL/migration step at the time it was written (TASK-024). That
caveat is stale: `pr.yml`'s `build-and-test` job has since grown a real
migrated/seeded Postgres (TASK-026) that every e2e suite already runs
against. This is real, security-relevant coverage that was one missed
`pnpm --filter @lis/db rls-check` away from silently rotting.

## 2. Findings (three real bugs, found by actually running this in CI —
not by reasoning about it)

1. **A real gap in the check's own fixtures.** Running locally against a
   freshly reset DB surfaced that `case_narrative` (FEAT-057/ADR-0049)
   never got a fixture row in `insertFixtures()`, so the leak check had
   nothing to prove isolation against for that table. Fixed by adding the
   missing insert.
2. **A design flaw, only visible in CI's real sequence.** First attempt:
   wired `rls-check` into `build-and-test`'s own job, placed after every
   e2e suite (reasoning: a leak check shouldn't depend on what real data
   already exists). This failed in CI — but not locally — on exactly 8
   tables (`audit_event`, `control_lot`, `observation`, `order`,
   `patient`, `qc_rule_violation`, `referring_facility`,
   `test_definition`), with row counts matching real data those specs are
   known to create. Root cause: `liveLeakCheck()`'s own design assumes
   "TENANT_B is deliberately never written to by anything" (its own header
   comment) — true against a freshly-seeded-only database, false the
   moment any of the dozens of real e2e specs that legitimately exercise
   cross-tenant isolation (`test-user-2` = TENANT_B) have run first. Their
   own real writes under TENANT_B are indistinguishable, to a blind
   `count(*) != 0`, from an actual leak.
3. **A red herring, investigated and correctly ruled out.** Before landing
   on (2), suspected a connection-pool GUC-bleed bug (`setTenant()`'s
   session-level `set_config` sticking to the wrong physical connection
   under a multi-connection pool) and added `{ max: 1 }` to `createDb()`.
   Verified this did *not* fix the CI failure (re-ran, identical failure)
   — correctly rejected as the cause. Kept the fix anyway as correct, cheap
   hygiene (matches `tenant-catalog-seed-check.ts`'s own identical
   precedent), with the comment corrected to not misattribute the real bug.

## 3. Affected files

- `packages/db/src/rls-isolation-check.ts` — added the missing
  `case_narrative` fixture insert; `{ max: 1 }` connection-pool hygiene;
  `onConflictDoNothing` on `result_release_policy` (defensive, in case a
  real row already exists for TENANT_A from elsewhere); corrected header
  comments to describe the real, final design and not the two intermediate
  wrong theories.
- `.github/workflows/pr.yml` — new dedicated `rls-isolation-check` job
  (own fresh Postgres service, own migrate + chemistry-catalog-only seed),
  not inside `build-and-test`. The `build-and-test` job never got a
  permanent `rls-check` step — the first attempt was added and then
  removed once (2) above was diagnosed.

## 4. Architecture consulted

`storybook-a11y`'s own existing job (same principle: a check testing
something orthogonal to functional e2e correctness gets its own isolated
job, not shoehorned into `build-and-test`); `test/vitest.e2e.config.ts`'s
`fileParallelism: false` comment (informed, then superseded, the original
placement reasoning); `tenant-catalog-seed-check.ts` (the `{ max: 1 }`
precedent).

## 5. Assumptions & autonomous decisions

- Ran `bash scripts/db-reset.sh` against the local dev Postgres multiple
  times to validate this before trusting it in CI — destroys local dev DB
  state, judged safe since every table's contents this session were
  disposable manual-test/demo fixtures, and `db-reset.sh` is this repo's
  own normal, expected dev workflow command.
- Chose a dedicated CI job over trying to find a "safe" placement inside
  `build-and-test`'s shared Postgres — the shared job's Postgres
  fundamentally cannot offer "TENANT_B untouched by anything else" once
  any cross-tenant e2e spec has run, at any point in that job's sequence.
  A separate job with its own service container is the only placement
  where the check's own design assumption is actually true, not just
  probably true.
- Only seeded `chemistry-catalog.sql` in the new job (not haematology/
  microbiology/synoptic/AP-catalog) — confirmed by reading the check's own
  fixture code that it only reuses that one seed's tenant's
  `test_definition`/`analyte`/`unit` rows.

## 6. Risks

Low once isolated in its own job — a dedicated, single-purpose Postgres
with nothing else ever writing to it removes the entire class of false
positive found in §2.2. If this check ever fails in its own job now,
that's exactly the point: a real, previously-invisible RLS gap.

## 7. Testing plan

- `pnpm --filter @lis/db build` clean.
- **Live-verified, real Postgres, multiple times, not just reviewed:** ran
  the check against three separate freshly-reset local databases across
  this debugging pass — caught and fixed the `case_narrative` gap, then
  confirmed clean; separately reproduced the exact `result_release_policy`
  collision locally (pre-inserted a conflicting row, then ran the check)
  to prove that specific fix before ever trusting it in CI.
- CI itself was the actual proof for finding (2) above — the local-only
  environment could not have surfaced it, since it requires the exact
  shared-Postgres sequence CI runs and local testing didn't reproduce.
  Watched via `gh pr checks` across three CI iterations until green.

## 8. Rollback plan

Revert both files. No schema/migration change — this is a verification
script and a CI workflow addition only.
