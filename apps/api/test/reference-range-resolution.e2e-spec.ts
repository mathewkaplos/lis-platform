import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  analyte,
  codeSystemValue,
  createDb,
  referenceRange,
  resolveObservationRange,
  unit,
} from '@lis/db';

// Same fixed seed/demo tenant as accession.e2e-spec.ts's siblings
// (golden-dataset-check.ts, rls-isolation-check.ts).
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

/**
 * TASK-049 (FEAT-014): proves `resolveObservationRange`/`resolveReferenceRange`
 * (packages/db/src/reference-range.ts) against real Postgres. No HTTP
 * endpoint exists yet (this task's own scope is the service, not a
 * controller -- proposal §2) -- same direct-`@lis/db` pattern as
 * accession.e2e-spec.ts (TASK-045), living under apps/api/test/ so it runs
 * under CI's existing `pnpm --filter api test:e2e` step.
 *
 * Two describe blocks, per proposal §10 Q2's resolution:
 * - "golden dataset": proves sex/condition/critical resolution against the
 *   real, TASK-027-reviewed-pending `db/golden/chemistry-ranges-criticals.json`.
 * - "synthetic fixtures": proves age/method/tie-break/edge-case resolution
 *   against fixtures this spec inserts and deletes itself, against a
 *   dedicated synthetic analyte -- clearly non-clinical, never touching the
 *   shared seed or the golden file, since no real age- or method-
 *   differentiated reference range exists anywhere in this repo yet
 *   (`domain/reference-ranges` Skill entry #4).
 */
describe('Reference-range resolution (e2e)', () => {
  // max: 1 -- a single physical connection for the whole spec, so the
  // session-level set_config() below (matching golden-dataset-check.ts's
  // own precedent) can't be silently dropped by a different pooled
  // connection picking up a later query (the exact pooling-leak class
  // TASK-030's own test exists to catch -- client.ts's CreateDbOptions).
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  describe('golden dataset (real, TASK-027-reviewed-pending data)', () => {
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

        // Group by dimensional key (sex, condition, rangeType) -- KB-15's
        // "either bound optional -> one-sided" allowance means a single
        // dimensional key can have more than one row (e.g. this file's own
        // critical-low + critical-high row pair per analyte), which
        // resolveReferenceRange merges into one ResolvedRange (reference-
        // range.ts's mergeTiedRows) -- so the expectation must be the
        // merged bounds, not any single entry's own low/high.
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
            // No entry in this golden file names a sex-wildcard row that
            // competes with a sex-specific row for the same analyte except
            // Creatinine (which specifies sex on every one of its rows) --
            // 'M' is a safe default patientSex whenever the row itself is
            // sex-wildcard.
            patientSex: (sample.sex as 'M' | 'F' | null) ?? 'M',
            patientBirthDate: new Date('1990-01-01T00:00:00Z'),
            condition: sample.condition,
            // Call-time "now", not a hardcoded date: db/seed/chemistry-catalog.sql's
            // reference_range rows default effectiveFrom to whenever the seed
            // actually ran (real insert time), which varies by environment (a
            // long-lived local Postgres seeded in the past vs. CI seeding fresh
            // at CI run time). A hardcoded cutoff can land before that real
            // effectiveFrom and wrongly exclude every row -- caught by a real
            // CI run failing where this same spec passed locally, exactly
            // because CI's fresh seed timestamp landed after the hardcoded date.
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

  describe('synthetic fixtures (non-clinical, spec-local only)', () => {
    let synthAnalyteId: string;
    let mgdlUnitId: string;
    let mmolUnitId: string;
    let synthCsvId: string;
    const insertedRangeIds: string[] = [];

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
          code: 'TASK-049-SYNTH',
          version: '1',
          display:
            'TASK-049 synthetic test analyte (non-clinical, spec-local only)',
        })
        .returning({ id: codeSystemValue.id });
      synthCsvId = csv.id;

      const [a] = await db
        .insert(analyte)
        .values({
          codeSystemValueId: synthCsvId,
          display: 'TASK-049 Synthetic Analyte (non-clinical)',
          dataType: 'quantity',
          defaultUnitId: mgdlUnitId,
        })
        .returning({ id: analyte.id });
      synthAnalyteId = a.id;
    });

    afterAll(async () => {
      if (insertedRangeIds.length > 0) {
        await db
          .delete(referenceRange)
          .where(inArray(referenceRange.id, insertedRangeIds));
      }
      if (synthAnalyteId)
        await db.delete(analyte).where(eq(analyte.id, synthAnalyteId));
      if (synthCsvId)
        await db
          .delete(codeSystemValue)
          .where(eq(codeSystemValue.id, synthCsvId));
    });

    async function insertRange(
      overrides: Partial<typeof referenceRange.$inferInsert>,
    ) {
      const [row] = await db
        .insert(referenceRange)
        .values({
          tenantId: TENANT_A,
          analyteId: synthAnalyteId,
          unitId: mgdlUnitId,
          rangeType: 'normal',
          effectiveFrom: new Date('2000-01-01T00:00:00Z'),
          ...overrides,
        })
        .returning();
      insertedRangeIds.push(row.id);
      return row;
    }

    it('age-banded ranges: boundary values resolve to the correct band, not the adjacent one', async () => {
      await insertRange({
        condition: 'synth-age-boundary',
        ageLowDays: 0,
        ageHighDays: 30,
        low: '1',
        high: '2',
      });
      await insertRange({
        condition: 'synth-age-boundary',
        ageLowDays: 31,
        ageHighDays: null,
        low: '10',
        high: '20',
      });

      const at = new Date('2026-08-05T00:00:00Z');
      const dayMs = 24 * 60 * 60 * 1000;
      const neonateBirthDate = new Date(at.getTime() - 30 * dayMs); // exactly 30 days old: last day of the neonate band
      const adultBirthDate = new Date(at.getTime() - 31 * dayMs); // exactly 31 days old: first day of the adult band

      const neonateResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: neonateBirthDate,
        condition: 'synth-age-boundary',
        at,
      });
      const adultResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: adultBirthDate,
        condition: 'synth-age-boundary',
        at,
      });

      expect(neonateResult.normal.matched && neonateResult.normal.low).toBe(
        '1',
      );
      expect(neonateResult.normal.matched && neonateResult.normal.high).toBe(
        '2',
      );
      expect(adultResult.normal.matched && adultResult.normal.low).toBe('10');
      expect(adultResult.normal.matched && adultResult.normal.high).toBe('20');
    });

    it('method-specific range outranks a method-wildcard range for the same analyte/sex/age', async () => {
      await insertRange({
        condition: 'synth-method',
        method: null,
        low: '5',
        high: '15',
      });
      await insertRange({
        condition: 'synth-method',
        method: 'enzymatic',
        low: '6',
        high: '16',
      });

      const specificMethodResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-method',
        method: 'enzymatic',
        at: new Date('2026-08-05T00:00:00Z'),
      });
      const otherMethodResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-method',
        method: 'colorimetric',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(
        specificMethodResult.normal.matched && specificMethodResult.normal.low,
      ).toBe('6');
      expect(
        otherMethodResult.normal.matched && otherMethodResult.normal.low,
      ).toBe('5');
    });

    it('tie-break: equally-specific, genuinely conflicting rows resolve by priority, then by most recent effectiveFrom', async () => {
      await insertRange({
        condition: 'synth-tiebreak',
        priority: 1,
        low: '100',
        high: null,
      });
      await insertRange({
        condition: 'synth-tiebreak',
        priority: 2,
        low: '200',
        high: null,
      });

      const priorityResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-tiebreak',
        at: new Date('2026-08-05T00:00:00Z'),
      });
      expect(priorityResult.normal.matched && priorityResult.normal.low).toBe(
        '200',
      );

      await insertRange({
        condition: 'synth-tiebreak-effective',
        priority: 1,
        low: '300',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
      });
      await insertRange({
        condition: 'synth-tiebreak-effective',
        priority: 1,
        low: '400',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      });

      const effectiveFromResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-tiebreak-effective',
        at: new Date('2026-08-05T00:00:00Z'),
      });
      expect(
        effectiveFromResult.normal.matched && effectiveFromResult.normal.low,
      ).toBe('400');
    });

    it("patient.sex = 'U' resolves only the sex-wildcard row, never a sex-specific row", async () => {
      await insertRange({
        condition: 'synth-sex-unknown',
        sex: null,
        low: '1',
        high: '2',
      });
      await insertRange({
        condition: 'synth-sex-unknown',
        sex: 'M',
        low: '3',
        high: '4',
      });

      const unknownSexResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'U',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-sex-unknown',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(
        unknownSexResult.normal.matched && unknownSexResult.normal.low,
      ).toBe('1');
    });

    it('a null patient.birthDate resolves only age-unbounded rows, never an age-bounded row', async () => {
      await insertRange({
        condition: 'synth-age-unknown',
        ageLowDays: null,
        ageHighDays: null,
        low: '7',
        high: '8',
      });
      await insertRange({
        condition: 'synth-age-unknown',
        ageLowDays: 0,
        ageHighDays: 100,
        low: '9',
        high: '10',
      });

      const unknownAgeResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: null,
        condition: 'synth-age-unknown',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(
        unknownAgeResult.normal.matched && unknownAgeResult.normal.low,
      ).toBe('7');
    });

    it('a unitId mismatch excludes the candidate row -> no_range, never silently applied', async () => {
      await insertRange({
        condition: 'synth-unit-mismatch',
        unitId: mgdlUnitId,
        low: '1',
        high: '2',
      });

      const mismatchResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mmolUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-unit-mismatch',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(mismatchResult.normal.matched).toBe(false);
    });

    // TASK-054 (FEAT-015 proposal §7/§10 Q4): the same unit-exclusion
    // discipline as the 'normal' case immediately above, proven for
    // `rangeType = 'critical'` too -- no existing test proved this before
    // TASK-054 (`domain/reference-ranges` entry #5's "no UCUM conversion"
    // finding applies identically to either rangeType, but `compatible()`
    // is exercised once per rangeType by `resolveObservationRange`, so it's
    // a real, separate code path to prove, not a re-statement of the
    // 'normal' case above). Synthetic fixture, not real golden-dataset data
    // (proposal §10 Q4) -- the golden dataset's four real critical analytes
    // have no incompatible-unit row to test against.
    it('a unitId mismatch excludes a critical-rangeType candidate row -> critical.matched === false, never silently applied', async () => {
      await insertRange({
        condition: 'synth-critical-unit-mismatch',
        rangeType: 'critical',
        unitId: mgdlUnitId,
        low: null,
        high: '40', // critical-low threshold under mg/dL, per the merge convention (entry #10)
      });

      const mismatchResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mmolUnitId, // a value that would be critical under mg/dL is submitted under a different unit
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-critical-unit-mismatch',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(mismatchResult.critical.matched).toBe(false);
    });

    it('no compatible candidate at all -> explicit no_range, never a thrown error or a fabricated match', async () => {
      const noCandidateResult = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-condition-with-no-rows-at-all',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(noCandidateResult.normal.matched).toBe(false);
      expect(noCandidateResult.critical.matched).toBe(false);
    });

    it('effectiveFrom/effectiveTo windowing excludes a row outside the effective window at the given `at`', async () => {
      await insertRange({
        condition: 'synth-effective-window',
        low: '1',
        high: '2',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        effectiveTo: new Date('2026-06-01T00:00:00Z'),
      });

      const beforeWindow = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-effective-window',
        at: new Date('2025-06-01T00:00:00Z'),
      });
      const withinWindow = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-effective-window',
        at: new Date('2026-03-01T00:00:00Z'),
      });
      const afterWindow = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-effective-window',
        at: new Date('2026-07-01T00:00:00Z'),
      });

      expect(beforeWindow.normal.matched).toBe(false);
      expect(withinWindow.normal.matched && withinWindow.normal.low).toBe('1');
      expect(afterWindow.normal.matched).toBe(false);
    });

    it('critical resolution: two one-sided rows (critical-low, critical-high) merge into one combined result', async () => {
      await insertRange({
        condition: 'synth-critical-merge',
        rangeType: 'critical',
        low: null,
        high: '40',
      });
      await insertRange({
        condition: 'synth-critical-merge',
        rangeType: 'critical',
        low: '500',
        high: null,
      });

      const result = await resolveObservationRange(db, {
        analyteId: synthAnalyteId,
        unitId: mgdlUnitId,
        patientSex: 'M',
        patientBirthDate: new Date('1990-01-01T00:00:00Z'),
        condition: 'synth-critical-merge',
        at: new Date('2026-08-05T00:00:00Z'),
      });

      expect(result.critical.matched && result.critical.low).toBe('500');
      expect(result.critical.matched && result.critical.high).toBe('40');
    });
  });
});
