import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
  analyte,
  computeFlags,
  createDb,
  resolveObservationRange,
} from '@lis/db';

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
    '../../../db/golden/chemistry-ranges-criticals.json',
  );
  const raw = readFileSync(path, 'utf-8');
  return (JSON.parse(raw) as { entries: GoldenEntry[] }).entries;
}

// A value strictly between `floor` (exclusive) and `x` (exclusive), or 1
// below `x` when there's no floor to stay clear of.
function justBelow(x: number, floor: number | null): number {
  const gap = floor === null ? 2 : x - floor;
  return x - Math.min(1, gap / 2);
}

// A value strictly between `x` (exclusive) and `ceiling` (exclusive), or 1
// above `x` when there's no ceiling to stay clear of.
function justAbove(x: number, ceiling: number | null): number {
  const gap = ceiling === null ? 2 : ceiling - x;
  return x + Math.min(1, gap / 2);
}

/**
 * TASK-050 (FEAT-014): proves `computeFlags` (packages/db/src/flagging.ts)
 * against every real boundary in `db/golden/chemistry-ranges-criticals.json`
 * -- the AC's own literal "exactly-at-threshold" wording -- plus the pure
 * no_range/critical-without-normal edge cases, which need no DB access at
 * all. Same direct-`@lis/db` pattern as reference-range-resolution.e2e-spec.ts
 * (TASK-049): no HTTP endpoint exists yet (TASK-051's own scope).
 */
describe('Flagging (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  describe('golden-dataset boundaries (real, TASK-027-reviewed-pending data)', () => {
    const entries = loadGoldenEntries();
    const analyteNames = [...new Set(entries.map((e) => e.analyte))];

    it.each(analyteNames)(
      '%s: every real boundary flags correctly, inclusive on both sides',
      async (analyteName) => {
        const analyteEntries = entries.filter((e) => e.analyte === analyteName);
        const normalEntry = analyteEntries.find(
          (e) => e.rangeType === 'normal',
        );
        if (!normalEntry) {
          throw new Error(
            `expected a 'normal' golden entry for '${analyteName}'`,
          );
        }
        const criticalEntries = analyteEntries.filter(
          (e) => e.rangeType === 'critical',
        );

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

        const low = normalEntry.low as number;
        const high = normalEntry.high as number;
        // Per the seed's own documented convention (proposal §1): a
        // critical-low row stores its threshold in `high`, a critical-high
        // row stores its threshold in `low`.
        const criticalLowThreshold =
          criticalEntries.find((e) => e.high !== null)?.high ?? null;
        const criticalHighThreshold =
          criticalEntries.find((e) => e.low !== null)?.low ?? null;

        // Extracted as primitives before the closure below: TS narrows
        // `analyteRow.defaultUnitId`/`normalEntry` in this scope from the
        // guards above, but that narrowing doesn't carry into a nested
        // function's body.
        const analyteId = analyteRow.id;
        const unitId = analyteRow.defaultUnitId;
        const patientSex = (normalEntry.sex as 'M' | 'F' | null) ?? 'M';
        const condition = normalEntry.condition;

        async function flagsFor(value: number): Promise<string[]> {
          const result = await resolveObservationRange(db, {
            analyteId,
            unitId,
            patientSex,
            patientBirthDate: new Date('1990-01-01T00:00:00Z'),
            condition,
            at: new Date(),
          });
          return computeFlags(value, result.normal, result.critical);
        }

        expect(await flagsFor(low)).toEqual(['N']);
        expect(await flagsFor(high)).toEqual(['N']);
        expect(await flagsFor((low + high) / 2)).toEqual(['N']);
        expect(await flagsFor(justBelow(low, criticalLowThreshold))).toEqual([
          'L',
        ]);
        expect(await flagsFor(justAbove(high, criticalHighThreshold))).toEqual([
          'H',
        ]);

        if (criticalLowThreshold !== null) {
          expect(await flagsFor(criticalLowThreshold)).toEqual(['LL']);
          expect(await flagsFor(justAbove(criticalLowThreshold, low))).toEqual([
            'L',
          ]);
        }
        if (criticalHighThreshold !== null) {
          expect(await flagsFor(criticalHighThreshold)).toEqual(['HH']);
          expect(
            await flagsFor(justBelow(criticalHighThreshold, high)),
          ).toEqual(['H']);
        }
      },
    );
  });

  describe('pure edge cases (no DB dependency)', () => {
    it('no_range (normal never resolved) returns [] -- never a fabricated N', () => {
      const flags = computeFlags(100, { matched: false }, { matched: false });
      expect(flags).toEqual([]);
    });

    it('a critical match with no matching normal range still flags HH/LL -- not gated on a normal range existing', () => {
      const critical = {
        matched: true as const,
        rangeRowIds: ['synthetic'],
        low: '500',
        high: '40',
        textualRange: null,
        condition: null,
        source: null,
        interpretationWhenIn: null,
      };
      expect(computeFlags(600, { matched: false }, critical)).toEqual(['HH']);
      expect(computeFlags(10, { matched: false }, critical)).toEqual(['LL']);
      expect(computeFlags(100, { matched: false }, critical)).toEqual([]);
    });
  });
});
