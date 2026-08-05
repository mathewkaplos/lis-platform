import { createDb, generateAccessionNumber } from '@lis/db';

/**
 * TASK-045 (FEAT-013): proves the accession-number generator's literal AC
 * ("Concurrent requests never produce a duplicate accession number")
 * directly against real Postgres. No HTTP endpoint exists yet to test
 * through (TASK-045's own scope is the generator, not a controller —
 * proposal §5) — this connects via `@lis/db` the same way
 * `rls-isolation-check.ts` does, but lives under `apps/api/test/` so it
 * runs automatically under CI's existing `pnpm --filter api test:e2e` step
 * (`packages/db` has no vitest suite of its own).
 *
 * Connects as `lis_app` (APP_DATABASE_URL), not the migration/superuser
 * role — independently re-verifies the migration's
 * `GRANT USAGE, SELECT ON SEQUENCE` actually took effect, not assumed from
 * the migration file's text (0010_audit_event.sql's own precedent: this
 * exact class of gap was only ever caught by a real reproduced permission
 * failure).
 */
describe('Accession number generation (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL);

  it('returns a well-formed YYMMDD-NNNNNN accession number (FEAT-013 proposal §10 Q2)', async () => {
    const accessionNumber = await generateAccessionNumber(db);
    if (!/^\d{6}-\d{6}$/.test(accessionNumber)) {
      throw new Error(
        `expected an accession number matching YYMMDD-NNNNNN, got ${accessionNumber}`,
      );
    }
  });

  it('two sequential calls return strictly increasing sequence components', async () => {
    const first = await generateAccessionNumber(db);
    const second = await generateAccessionNumber(db);
    const firstSeq = Number(first.split('-')[1]);
    const secondSeq = Number(second.split('-')[1]);
    if (secondSeq <= firstSeq) {
      throw new Error(
        `expected a strictly increasing sequence, got ${first} then ${second}`,
      );
    }
  });

  it('200 concurrent calls never produce a duplicate accession number (the literal TASK-045 AC)', async () => {
    const CONCURRENT_CALLS = 200;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () =>
        generateAccessionNumber(db),
      ),
    );
    const unique = new Set(results);
    if (unique.size !== CONCURRENT_CALLS) {
      throw new Error(
        `expected ${CONCURRENT_CALLS} unique accession numbers, got ${unique.size} unique out of ${results.length}`,
      );
    }
  });
});
