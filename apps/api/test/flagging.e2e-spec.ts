import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import {
  analyte,
  codeSystemValue,
  computeFlags,
  createDb,
  referenceRange,
  resolveObservationRange,
  unit,
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

  /**
   * TASK-054 (FEAT-015 proposal §2/§7/§10 Q4): the companion, full-pipeline
   * (`resolveObservationRange` -> `computeFlags`) proof for
   * reference-range-resolution.e2e-spec.ts's own unit-mismatch-on-critical
   * case -- that test proves `critical.matched === false` at the resolver
   * level; this one proves the practical consequence downstream, that
   * `computeFlags` therefore never fabricates `HH`/`LL` for a value that
   * would be critical under the matching unit. Synthetic fixture (proposal
   * §10 Q4), self-contained, mirroring reference-range-resolution.e2e-
   * spec.ts's own synthetic-analyte setup, scoped to only what this one
   * case needs.
   */
  describe('critical-rangeType unit mismatch (synthetic, spec-local only)', () => {
    let synthAnalyteId: string;
    let synthCsvId: string;
    let mgdlUnitId: string;
    let mmolUnitId: string;
    let criticalRowId: string;

    beforeAll(async () => {
      const [mgdl] = await db
        .select({ id: unit.id })
        .from(unit)
        .innerJoin(
          codeSystemValue,
          eq(unit.codeSystemValueId, codeSystemValue.id),
        )
        .where(
          and(
            eq(codeSystemValue.system, 'UCUM'),
            eq(codeSystemValue.code, 'mg/dL'),
          ),
        )
        .limit(1);
      const [mmol] = await db
        .select({ id: unit.id })
        .from(unit)
        .innerJoin(
          codeSystemValue,
          eq(unit.codeSystemValueId, codeSystemValue.id),
        )
        .where(
          and(
            eq(codeSystemValue.system, 'UCUM'),
            eq(codeSystemValue.code, 'mmol/L'),
          ),
        )
        .limit(1);
      if (!mgdl || !mmol) {
        throw new Error(
          'expected mg/dL and mmol/L UCUM units -- run `pnpm db:reset` first',
        );
      }
      mgdlUnitId = mgdl.id;
      mmolUnitId = mmol.id;

      const [csv] = await db
        .insert(codeSystemValue)
        .values({
          system: 'TEST',
          code: 'TASK-054-SYNTH',
          version: '1',
          display:
            'TASK-054 synthetic test analyte (non-clinical, spec-local only)',
        })
        .returning({ id: codeSystemValue.id });
      synthCsvId = csv.id;

      const [a] = await db
        .insert(analyte)
        .values({
          codeSystemValueId: synthCsvId,
          display: 'TASK-054 Synthetic Analyte (non-clinical)',
          dataType: 'quantity',
          defaultUnitId: mgdlUnitId,
        })
        .returning({ id: analyte.id });
      synthAnalyteId = a.id;

      // A critical-low row (per the seed's own convention: `high` carries
      // the critical-low threshold), seeded under mg/dL only.
      const [range] = await db
        .insert(referenceRange)
        .values({
          tenantId: TENANT_A,
          analyteId: synthAnalyteId,
          unitId: mgdlUnitId,
          rangeType: 'critical',
          low: null,
          high: '40',
          effectiveFrom: new Date('2000-01-01T00:00:00Z'),
        })
        .returning();
      criticalRowId = range.id;
    });

    afterAll(async () => {
      if (criticalRowId) {
        await db
          .delete(referenceRange)
          .where(eq(referenceRange.id, criticalRowId));
      }
      if (synthAnalyteId)
        await db.delete(analyte).where(eq(analyte.id, synthAnalyteId));
      if (synthCsvId)
        await db
          .delete(codeSystemValue)
          .where(eq(codeSystemValue.id, synthCsvId));
    });

    it('a value that would be LL under the matching unit is not fabricated as LL (or any flag) under a mismatched unit', async () => {
      const matchingUnitResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        at: new Date('2026-08-06T00:00:00Z'),
      });
      // Sanity check: this value genuinely is LL under the matching unit --
      // otherwise the "not fabricated" assertion below would be vacuous.
      expect(
        computeFlags(
          10,
          matchingUnitResult.normal,
          matchingUnitResult.critical,
        ),
      ).toEqual(['LL']);

      const mismatchedUnitResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mmolUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        at: new Date('2026-08-06T00:00:00Z'),
      });
      expect(mismatchedUnitResult.critical.matched).toBe(false);
      expect(
        computeFlags(
          10,
          mismatchedUnitResult.normal,
          mismatchedUnitResult.critical,
        ),
      ).toEqual([]);
    });
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
