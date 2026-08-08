import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { analyte, codeSystemValue, controlLot, createDb, unit } from '@lis/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-068 (FEAT-019 revision): proves `GET /v1/control-lots/:id/chart` --
 * the Levey-Jennings chart data endpoint. Real Nest app, real Keycloak
 * tokens, real Postgres, matching `control-lot.e2e-spec.ts`'s own standard
 * for this controller. Each test uses its own analyte (same discipline
 * `qc-westgard` Skill entry #8 established for `qc-westgard.e2e-spec.ts`'s
 * own R-4s tests) -- this file doesn't exercise R-4s itself, but reuses the
 * same isolation habit rather than assuming it doesn't matter here too.
 */
describe('Levey-Jennings chart data (e2e)', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let analyteIds: string[];
  let unitId: string;

  interface RecordResultResponse {
    resourceId: string;
  }
  interface ChartResponse {
    controlLotId: string;
    analyteId: string;
    level: string;
    targetMean: number;
    targetSd: number;
    points: {
      id: string;
      value: number;
      zScore: number;
      producedAt: string | null;
      violations: { ruleCode: string; severity: string }[];
    }[];
  }

  async function createLot(
    analyteId: string,
    targetMean: string,
    targetSd: string,
  ) {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [lot] = await db
      .insert(controlLot)
      .values({
        tenantId: TENANT_A,
        analyteId,
        level: 'normal',
        unitId,
        targetMean,
        targetSd,
        lotNumber: `QC-CHART-E2E-${Date.now()}-${Math.random()}`,
      })
      .returning();
    return lot.id;
  }

  async function postResult(
    lotId: string,
    valueNum: number,
  ): Promise<RecordResultResponse> {
    const res = await request(app.getHttpServer())
      .post(`/v1/control-lots/${lotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum })
      .expect(201);
    return res.body as RecordResultResponse;
  }

  function getChart(lotId: string, token = tokenA) {
    return request(app.getHttpServer())
      .get(`/v1/control-lots/${lotId}/chart`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');
    tokenB = await getKeycloakToken('test-user-2', 'test-password-2');

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const analyteRows = await db
      .select({ id: analyte.id })
      .from(analyte)
      .where(eq(analyte.dataType, 'quantity'))
      .limit(3);
    const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
    if (analyteRows.length < 3 || !unitRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    analyteIds = analyteRows.map((r) => r.id);
    unitId = unitRow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    const lotId = await createLot(analyteIds[0], '5.0', '0.2');
    await request(app.getHttpServer())
      .get(`/v1/control-lots/${lotId}/chart`)
      .expect(401);
  });

  it('404s on a control lot that does not exist', async () => {
    await getChart(randomUUID()).expect(404);
  });

  it("404s on another tenant's control lot -- cross-tenant existence is never leaked", async () => {
    const lotId = await createLot(analyteIds[0], '5.0', '0.2');
    await getChart(lotId, tokenB).expect(404);
  });

  it('returns the mean/SD band and an empty points array for a lot with no QC results yet', async () => {
    const lotId = await createLot(analyteIds[1], '5.0', '0.2');
    const res = await getChart(lotId).expect(200);
    const body = res.body as ChartResponse;

    expect(body.controlLotId).toBe(lotId);
    expect(body.analyteId).toBe(analyteIds[1]);
    expect(body.level).toBe('normal');
    expect(body.targetMean).toBe(5.0);
    expect(body.targetSd).toBe(0.2);
    expect(body.points).toEqual([]);
  });

  it('returns points oldest-first, each with its own z-score and any violations, matching the real HTTP response', async () => {
    const lotId = await createLot(analyteIds[2], '5.0', '0.2');
    const first = await postResult(lotId, 5.0); // z = 0
    const second = await postResult(lotId, 5.7); // z = 3.5, 1-3s rejection

    const res = await getChart(lotId).expect(200);
    const body = res.body as ChartResponse;

    expect(body.points).toHaveLength(2);
    expect(body.points[0].id).toBe(first.resourceId);
    expect(body.points[0].value).toBe(5.0);
    expect(body.points[0].zScore).toBe(0);
    expect(body.points[0].violations).toEqual([]);

    expect(body.points[1].id).toBe(second.resourceId);
    expect(body.points[1].value).toBe(5.7);
    expect(body.points[1].zScore).toBeCloseTo(3.5, 10);
    // Only ruleCode/severity asserted -- the full QcRuleViolationResult DTO
    // carries id/controlLotId/observationId/detectedAt too, real per-run data
    // (same fix `qc-westgard.e2e-spec.ts` already needed for this exact
    // assertion shape).
    expect(
      body.points[1].violations.map((v) => ({
        ruleCode: v.ruleCode,
        severity: v.severity,
      })),
    ).toEqual([{ ruleCode: '1_3s', severity: 'rejection' }]);
  });

  it('400s for a control lot whose analyte is not quantity-dataType', async () => {
    // chemistry-catalog.sql's own seed only ever inserts quantity-dataType
    // analytes (confirmed by inspection) -- a synthetic, explicitly
    // non-clinical coded analyte fixture, same discipline `qc-westgard`
    // Skill entry #6 and `reference-ranges` entry #4 already established for
    // "no real data exists for this case."
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [csv] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: `QC-CHART-CODED-${Date.now()}`,
        version: '1',
        display: 'Synthetic coded analyte (qc-chart.e2e-spec.ts fixture)',
      })
      .returning();
    const [codedAnalyte] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csv.id,
        display: 'Synthetic coded analyte (qc-chart.e2e-spec.ts fixture)',
        dataType: 'coded',
      })
      .returning();
    const lotId = await createLot(codedAnalyte.id, '0', '1');

    await getChart(lotId).expect(400);
  });
});
