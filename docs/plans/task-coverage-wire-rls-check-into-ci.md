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

## 2. Finding (real, not hypothetical)

Running the check locally against a freshly reset DB (`bash
scripts/db-reset.sh`, needed since this script's own fixtures are
insert-only and require a clean slate) surfaced a real gap in the check
itself, not the app: `case_narrative` — a real tenant-scoped table
(FEAT-057/ADR-0049) — was never seeded a fixture row in
`insertFixtures()`, so the live leak check had nothing to prove isolation
against for that one table and failed with "cannot prove isolation
without fixture data." Every other one of the 45 tables passed clean on
the first run. Fixed by adding the missing fixture insert; re-ran against
another fresh reset and confirmed clean: "All checks passed across 45
tenant-scoped tables."

## 3. Affected files

- `packages/db/src/rls-isolation-check.ts` — added the missing
  `case_narrative` fixture insert; updated the fixture-summary log line;
  corrected the now-stale "not wired into CI" header comment.
- `.github/workflows/pr.yml` — added `pnpm --filter @lis/db rls-check` to
  the `build-and-test` job, placed after every e2e suite (`api`/`gateway`/
  `interop`) rather than interleaved with them.

## 4. Architecture consulted

`test/vitest.e2e.config.ts`'s own documented reason for
`fileParallelism: false` (exact-count/hash-chain audit assertions across
e2e specs sharing one live tenant) — informed the placement decision:
this check's own fixtures are insert-only and would risk perturbing an
e2e spec's own exact count assertion if run earlier/interleaved. A
cross-tenant leak check's correctness doesn't depend on what real data
already exists in either tenant, only on TENANT_B never seeing TENANT_A's
rows — safe to run last, after every e2e suite has already written
whatever real data it writes.

## 5. Assumptions & autonomous decisions

- Ran `bash scripts/db-reset.sh` against the local dev Postgres to
  validate this before trusting it in CI — this destroys local dev DB
  state, judged safe here since every table's contents this session were
  disposable manual-test/demo fixtures (already individually cleaned up
  where they mattered), and `db-reset.sh` is this repo's own normal,
  expected dev workflow command, not an unusual or destructive action in
  context.
- Placed the new CI step after all three e2e suites (not before/between),
  per §4's reasoning — a deliberate ordering decision, not arbitrary.

## 6. Risks

Low — this is a read-mostly verification step (its own fixture writes are
additive, never touching anything an e2e suite already wrote) added at
the very end of an already-passing job. If it ever fails in CI, that's
exactly the point: it means a real, previously-invisible RLS gap exists.

## 7. Testing plan

- `pnpm --filter @lis/db build` clean.
- **Live-verified, real Postgres, not just review:** ran the check twice
  against two separate freshly-reset local databases — first run caught
  and this PR fixed the `case_narrative` fixture gap; second run passed
  clean across all 45 tenant-scoped tables, including the newly-added
  fixture.
- CI itself is the final proof this actually works end-to-end in the
  environment it's now wired into — watched via `gh pr checks`.

## 8. Rollback plan

Revert both files. No schema/migration change — this is a verification
script and a CI workflow addition only.
