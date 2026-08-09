import { eq, inArray, sql } from 'drizzle-orm';
import {
  analyte,
  codeSystemValue,
  createDb,
  deltaCheckRule,
  observation,
  patient,
  resolveDeltaCheck,
} from '@lis/db';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-025 (ADR-0023): proves `resolveDeltaCheck` (packages/db/src/delta-
 * check.ts) directly against real Postgres -- same "no HTTP endpoint owns
 * this logic in isolation, test the resolver directly" pattern as
 * flagging.e2e-spec.ts/reference-range-resolution.e2e-spec.ts (TASK-049/
 * 050). The full HTTP write-path proof (a real 'D' in a real finalize
 * response, `previousObservationId` set on the real row) lives in
 * observation.e2e-spec.ts's own "Delta check (FEAT-025, ADR-0023)" describe
 * block -- this file isolates the resolver's own branches, each on a
 * dedicated synthetic (non-clinical) analyte so one scenario's fixture data
 * can never shift another's "most recent prior" result.
 */
describe('Delta check resolver (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
  let patientId: string;
  const createdAnalyteIds: string[] = [];
  const createdCsvIds: string[] = [];

  async function makeSyntheticAnalyte(label: string): Promise<string> {
    const [csv] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: `FEAT-025-SYNTH-${label}-${Date.now()}`,
        version: '1',
        display: `FEAT-025 synthetic test analyte (non-clinical, spec-local only) -- ${label}`,
      })
      .returning({ id: codeSystemValue.id });
    createdCsvIds.push(csv.id);

    const [a] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csv.id,
        display: `FEAT-025 Synthetic Analyte ${label} (non-clinical)`,
        dataType: 'quantity',
      })
      .returning({ id: analyte.id });
    createdAnalyteIds.push(a.id);
    return a.id;
  }

  async function insertVerifiedObservation(
    analyteId: string,
    valueNum: number,
    producedAt: Date,
  ): Promise<string> {
    const [row] = await db
      .insert(observation)
      .values({
        tenantId: TENANT_A,
        analyteId,
        patientId,
        dataType: 'quantity',
        valueNum: String(valueNum),
        status: 'verified',
        source: 'manual',
        producedAt,
      })
      .returning({ id: observation.id });
    return row.id;
  }

  beforeAll(async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `FEAT-025-DELTA-CHECK-${Date.now()}`,
        firstName: 'DeltaCheck',
        lastName: 'Resolver',
        sex: 'F',
      })
      .returning({ id: patient.id });
    patientId = pat.id;
  });

  afterAll(async () => {
    if (createdAnalyteIds.length > 0) {
      await db
        .delete(observation)
        .where(inArray(observation.analyteId, createdAnalyteIds));
      await db
        .delete(deltaCheckRule)
        .where(inArray(deltaCheckRule.analyteId, createdAnalyteIds));
      for (const id of createdAnalyteIds) {
        await db.delete(analyte).where(eq(analyte.id, id));
      }
    }
    for (const id of createdCsvIds) {
      await db.delete(codeSystemValue).where(eq(codeSystemValue.id, id));
    }
    if (patientId) {
      await db.delete(patient).where(eq(patient.id, patientId));
    }
  });

  it('no prior observation for this patient/analyte: not flagged, previousObservationId/priorValue/percentChange all null', async () => {
    const analyteId = await makeSyntheticAnalyte('NO-PRIOR');
    await db
      .insert(deltaCheckRule)
      .values({ tenantId: TENANT_A, analyteId, thresholdPercent: '20' });

    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 5.0,
    });

    expect(result).toEqual({
      flagged: false,
      previousObservationId: null,
      priorValue: null,
      percentChange: null,
    });
  });

  it('a prior exists but no delta_check_rule is configured for the analyte: never a fabricated flag, but previousObservationId still links the trend chain', async () => {
    const analyteId = await makeSyntheticAnalyte('NO-RULE');
    const priorId = await insertVerifiedObservation(
      analyteId,
      100,
      new Date('2026-01-01T00:00:00Z'),
    );

    // A huge jump -- would flag under almost any real threshold -- proves
    // the absence of a rule, not the size of the change, is what prevents D.
    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 400,
    });

    expect(result.flagged).toBe(false);
    expect(result.previousObservationId).toBe(priorId);
    expect(result.priorValue).toBe(100);
    expect(result.percentChange).toBeCloseTo(300, 5); // (400 - 100) / |100| * 100
  });

  it('a change strictly under the configured threshold is not flagged', async () => {
    const analyteId = await makeSyntheticAnalyte('UNDER-THRESHOLD');
    await db
      .insert(deltaCheckRule)
      .values({ tenantId: TENANT_A, analyteId, thresholdPercent: '20' });
    await insertVerifiedObservation(
      analyteId,
      100,
      new Date('2026-01-01T00:00:00Z'),
    );

    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 115, // +15%, under the 20% threshold
    });

    expect(result.flagged).toBe(false);
    expect(result.percentChange).toBeCloseTo(15, 5);
  });

  it('a change exactly at the configured threshold is flagged (inclusive boundary, mirrors flagging.ts precedent)', async () => {
    const analyteId = await makeSyntheticAnalyte('BOUNDARY-EXACT');
    await db
      .insert(deltaCheckRule)
      .values({ tenantId: TENANT_A, analyteId, thresholdPercent: '20' });
    await insertVerifiedObservation(
      analyteId,
      100,
      new Date('2026-01-01T00:00:00Z'),
    );

    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 120, // exactly +20%
    });

    expect(result.flagged).toBe(true);
    expect(result.percentChange).toBeCloseTo(20, 5);
  });

  it('a negative (decreasing) change past the threshold is flagged on magnitude, not direction', async () => {
    const analyteId = await makeSyntheticAnalyte('NEGATIVE-DIRECTION');
    await db
      .insert(deltaCheckRule)
      .values({ tenantId: TENANT_A, analyteId, thresholdPercent: '20' });
    await insertVerifiedObservation(
      analyteId,
      100,
      new Date('2026-01-01T00:00:00Z'),
    );

    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 70, // -30%
    });

    expect(result.flagged).toBe(true);
    expect(result.percentChange).toBeCloseTo(-30, 5);
  });

  it('only the most recent verified observation is used as the prior, not an older one', async () => {
    const analyteId = await makeSyntheticAnalyte('MOST-RECENT');
    await db
      .insert(deltaCheckRule)
      .values({ tenantId: TENANT_A, analyteId, thresholdPercent: '20' });
    await insertVerifiedObservation(
      analyteId,
      100,
      new Date('2026-01-01T00:00:00Z'),
    );
    const mostRecentId = await insertVerifiedObservation(
      analyteId,
      50,
      new Date('2026-02-01T00:00:00Z'),
    );

    // +20% from the older (100) prior would NOT flag; +20% from the more
    // recent (50) prior WOULD -- proves ordering, not just presence.
    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 60,
    });

    expect(result.previousObservationId).toBe(mostRecentId);
    expect(result.flagged).toBe(true);
    expect(result.percentChange).toBeCloseTo(20, 5);
  });

  it('a prior value of exactly 0 yields a null percentChange (no divide-by-zero) and is never flagged', async () => {
    const analyteId = await makeSyntheticAnalyte('ZERO-PRIOR');
    await db
      .insert(deltaCheckRule)
      .values({ tenantId: TENANT_A, analyteId, thresholdPercent: '20' });
    const priorId = await insertVerifiedObservation(
      analyteId,
      0,
      new Date('2026-01-01T00:00:00Z'),
    );

    const result = await resolveDeltaCheck(db, {
      patientId,
      analyteId,
      valueNum: 5,
    });

    expect(result.flagged).toBe(false);
    expect(result.percentChange).toBeNull();
    expect(result.previousObservationId).toBe(priorId);
  });
});
