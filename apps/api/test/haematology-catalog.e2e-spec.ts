import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  analyte,
  createDb,
  resolveObservationRange,
  testAnalyte,
  testDefinition,
} from '@lis/db';

// Same fixed seed/demo tenant as every other e2e spec in this file
// (golden-dataset-check.ts, reference-range-resolution.e2e-spec.ts).
const TENANT_A = '00000000-0000-0000-0000-000000000001';

interface GoldenEntry {
  analyte: string;
  sex: string | null;
  condition: string | null;
  rangeType: string;
  low: number | null;
  high: number | null;
}

function loadGoldenEntries(): GoldenEntry[] {
  const path = join(
    __dirname,
    '../../../db/golden/haematology-ranges-criticals.json',
  );
  const raw = readFileSync(path, 'utf-8');
  return (JSON.parse(raw) as { entries: GoldenEntry[] }).entries;
}

/**
 * TASK-071 (FEAT-023): proves `db/seed/haematology-catalog.sql` against real
 * Postgres, same "golden dataset (real, TASK-027-reviewed-pending data)"
 * pattern `reference-range-resolution.e2e-spec.ts` already established for
 * chemistry (TASK-049) -- a new file rather than a describe block appended
 * to that spec, since it exercises a fully independent seed/golden pair
 * (per the Implementation Proposal's own §2 file list).
 *
 * A second describe block proves this file's own new catalog-shape decision
 * -- one 'CBC' test_definition with 20 linked analytes (no per-analyte test,
 * no panel wrapper), unlike chemistry's 14-separate-tests-plus-panel shape
 * -- since no existing spec asserts a test_definition with more than a
 * couple of test_analyte rows.
 */
describe('Haematology catalog (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  describe('golden dataset (real, TASK-071-seeded, sign-off-pending data)', () => {
    const entries = loadGoldenEntries();
    const analyteNames = [...new Set(entries.map((e) => e.analyte))];

    it.each(analyteNames)(
      '%s: every real golden-dataset row resolves to its exact (merged) bounds',
      async (analyteName) => {
        const analyteEntries = entries.filter((e) => e.analyte === analyteName);
        const [analyteRow] = await db
          .select({ id: analyte.id, defaultUnitId: analyte.defaultUnitId })
          .from(analyte)
          .where(eq(analyte.display, analyteName))
          .limit(1);
        if (!analyteRow?.defaultUnitId) {
          throw new Error(
            `no analyte/unit found for '${analyteName}' -- run \`pnpm db:reset\` first`,
          );
        }

        // Group by dimensional key (sex, condition, rangeType) -- same
        // one-sided-critical-pair merge as chemistry's own spec.
        const groups = new Map<string, GoldenEntry[]>();
        for (const e of analyteEntries) {
          const key = `${e.sex ?? 'null'}|${e.condition ?? 'null'}|${e.rangeType}`;
          groups.set(key, [...(groups.get(key) ?? []), e]);
        }

        for (const group of groups.values()) {
          const sample = group[0];
          const expectedLow = [
            ...new Set(
              group.map((g) => g.low).filter((v): v is number => v !== null),
            ),
          ];
          const expectedHigh = [
            ...new Set(
              group.map((g) => g.high).filter((v): v is number => v !== null),
            ),
          ];
          expect(expectedLow.length).toBeLessThanOrEqual(1);
          expect(expectedHigh.length).toBeLessThanOrEqual(1);

          const result = await resolveObservationRange(db, {
            analyteId: analyteRow.id,
            unitId: analyteRow.defaultUnitId,
            // Every sex-specific row in this golden file (Hemoglobin, RBC
            // Count, Hematocrit) is paired with the opposite sex's own row,
            // never competing against a sex-wildcard row for the same
            // analyte -- 'M' is a safe default whenever the sample row
            // itself is sex-wildcard, same precedent as the chemistry spec.
            patientSex: (sample.sex as 'M' | 'F' | null) ?? 'M',
            patientBirthDate: new Date('1990-01-01T00:00:00Z'),
            condition: sample.condition,
            // Call-time "now", not a hardcoded date -- same reason as
            // reference-range-resolution.e2e-spec.ts's own precedent
            // (reference_range.effectiveFrom defaults to real seed-insert
            // time, which varies by environment).
            at: new Date(),
          });

          const resolved =
            sample.rangeType === 'critical' ? result.critical : result.normal;
          if (!resolved.matched) {
            throw new Error(
              `expected a match for ${analyteName} [${sample.rangeType}, sex=${sample.sex}, condition=${sample.condition}], got no_range`,
            );
          }
          expect(resolved.low === null ? null : Number(resolved.low)).toBe(
            expectedLow[0] ?? null,
          );
          expect(resolved.high === null ? null : Number(resolved.high)).toBe(
            expectedHigh[0] ?? null,
          );
        }
      },
    );
  });

  describe('CBC test_definition shape', () => {
    it('links exactly the 20 seeded analytes to one CBC test_definition, not per-analyte tests', async () => {
      const [cbc] = await db
        .select({ id: testDefinition.id })
        .from(testDefinition)
        .where(eq(testDefinition.code, 'CBC'))
        .limit(1);
      if (!cbc) {
        throw new Error(
          "no 'CBC' test_definition found -- run `pnpm db:reset` first",
        );
      }

      const links = await db
        .select({ analyteId: testAnalyte.analyteId })
        .from(testAnalyte)
        .where(eq(testAnalyte.testDefinitionId, cbc.id));

      expect(links.length).toBe(20);
      expect(new Set(links.map((l) => l.analyteId)).size).toBe(20);
    });
  });
});
