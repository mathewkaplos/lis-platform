import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  createDb,
  instrumentAnalyteMapping,
  observation,
  order,
  orderedTest,
  patient,
  specimen,
  specimenFulfillment,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getGatewayToken } from './get-gateway-token';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-027 (ADR-0026/ADR-0027): proves the internal ingestion endpoint's
 * real pipeline -- auth (401/403, unchanged from FEAT-026), correlation
 * (a real accession -> specimen -> orderedTest match via a published
 * instrument_analyte_mapping row), the write itself going through
 * ObservationWriteService (same path a human draft() call uses), real
 * DB-enforced dedupe via observation_idempotency_key, and unmatched-result
 * handling (422, KB-29's "park, never drop").
 */
describe('Gateway ingest (e2e)', () => {
  let app: INestApplication<App>;
  let gatewayToken: string;
  let humanToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseAnalyteId: string;
  let glucoseUnitId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [gatewayToken, humanToken] = await Promise.all([
      getGatewayToken(),
      getKeycloakToken('test-user', 'test-password'),
    ]);

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [analyteRow] = await db
      .select({ id: analyte.id, defaultUnitId: analyte.defaultUnitId })
      .from(testAnalyte)
      .innerJoin(
        testDefinition,
        eq(testAnalyte.testDefinitionId, testDefinition.id),
      )
      .innerJoin(analyte, eq(testAnalyte.analyteId, analyte.id))
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, GLUCOSE_CODE),
        ),
      )
      .limit(1);
    if (!analyteRow?.defaultUnitId) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseAnalyteId = analyteRow.id;
    glucoseUnitId = analyteRow.defaultUnitId;
  });

  afterAll(async () => {
    await app.close();
  });

  /** A real, enterable ordered test for glucose, with a real specimen
   * fulfilling it -- exactly the shape a driver's correlation step must
   * find, matching `AnalyzerCorrelationService`'s own required chain
   * (specimen -> specimen_fulfillment -> ordered_test -> test_analyte). */
  async function createCorrelatableFixture(): Promise<{
    accessionNumber: string;
    orderedTestId: string;
  }> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `GW-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Gateway',
        lastName: 'Test',
        sex: 'U',
      })
      .returning();
    const [ord] = await db
      .insert(order)
      .values({ tenantId: TENANT_A, patientId: pat.id })
      .returning();
    const [testDefRow] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, GLUCOSE_CODE),
        ),
      )
      .limit(1);
    const [ot] = await db
      .insert(orderedTest)
      .values({
        tenantId: TENANT_A,
        orderId: ord.id,
        testDefinitionId: testDefRow.id,
        status: 'received',
      })
      .returning();
    const accessionNumber = `GW-E2E-ACC-${Date.now()}-${randomUUID()}`;
    const [sp] = await db
      .insert(specimen)
      .values({
        tenantId: TENANT_A,
        accessionNumber,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

    return { accessionNumber, orderedTestId: ot.id };
  }

  // Every test that needs a mapping generates its own unique
  // instrumentId/channelCode pair -- ux_instrument_mapping_published only
  // allows one *published* row per (tenant, instrument, channel) at a time,
  // so sharing one pair across tests would collide on the second insert.
  async function publishMapping(
    conversionFactor = '1',
  ): Promise<{ instrumentId: string; channelCode: string }> {
    const instrumentId = `TEST-ANALYZER-${randomUUID()}`;
    const channelCode = `GLU_CH-${randomUUID()}`;
    await db.insert(instrumentAnalyteMapping).values({
      tenantId: TENANT_A,
      instrumentId,
      channelCode,
      analyteId: glucoseAnalyteId,
      unitId: glucoseUnitId,
      conversionFactor,
      status: 'published',
    });
    return { instrumentId, channelCode };
  }

  function rawResult(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      instrumentId: 'UNMAPPED-INSTRUMENT',
      specimenId: 'UNKNOWN-ACCESSION',
      analyte: 'UNMAPPED-CHANNEL',
      runId: `RUN-${randomUUID()}`,
      value: 5.4,
      unit: 'mmol/L',
      flag: 'N',
      rawPayload: 'H|\\^&|||ANALYZER-1|...',
      ...overrides,
    };
  }

  it('rejects a request with no token — 401', () => {
    return request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .send(rawResult())
      .expect(401);
  });

  it('rejects a real human token — 403 (gateway_ingest is machine-only, ADR-0026)', () => {
    return request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${humanToken}`)
      .send(rawResult())
      .expect(403);
  });

  it('rejects a payload missing rawPayload — 400 (KB-29: raw retention is mandatory)', () => {
    const withoutRawPayload: Record<string, unknown> = rawResult();
    delete withoutRawPayload.rawPayload;
    return request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(withoutRawPayload)
      .expect(400);
  });

  it('returns 422 "unmatched" for an unknown accession number (KB-29: park, never drop)', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(rawResult({ specimenId: 'DOES-NOT-EXIST' }))
      .expect(422);
    expect((res.body as { reason: string }).reason).toBe('unknown_specimen');
  });

  it('returns 422 "unmatched" when no published mapping exists for the channel code', async () => {
    const { accessionNumber } = await createCorrelatableFixture();
    const res = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(
        rawResult({
          specimenId: accessionNumber,
          analyte: 'NEVER-MAPPED-CHANNEL',
        }),
      )
      .expect(422);
    expect((res.body as { reason: string }).reason).toBe(
      'no_published_mapping',
    );
  });

  it('correlates, maps, and writes a real Observation through ObservationWriteService (ADR-0027) — 202', async () => {
    const { instrumentId, channelCode } = await publishMapping();
    const { accessionNumber, orderedTestId } =
      await createCorrelatableFixture();

    const res = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(
        rawResult({
          instrumentId,
          analyte: channelCode,
          specimenId: accessionNumber,
          value: 5.4,
        }),
      )
      .expect(202);

    const body = res.body as {
      duplicate: boolean;
      observationId: string;
      idempotencyKey: string;
    };
    expect(body.duplicate).toBe(false);
    expect(
      body.idempotencyKey.startsWith(
        `${instrumentId}:${accessionNumber}:${channelCode}:`,
      ),
    ).toBe(true);

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, body.observationId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row.orderedTestId).toBe(orderedTestId);
    expect(row.analyteId).toBe(glucoseAnalyteId);
    expect(Number(row.valueNum)).toBe(5.4);
    expect(row.status).toBe('registered');
    expect(row.source).toBe('analyzer');
    expect(row.sourceIdempotencyKey).toBe(body.idempotencyKey);
  });

  it('applies the mapping conversionFactor before writing', async () => {
    const { instrumentId, channelCode } = await publishMapping('2');
    const { accessionNumber } = await createCorrelatableFixture();

    const res = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(
        rawResult({
          instrumentId,
          analyte: channelCode,
          specimenId: accessionNumber,
          value: 3,
        }),
      )
      .expect(202);

    const body = res.body as { observationId: string };
    const [row] = await db
      .select({ valueNum: observation.valueNum })
      .from(observation)
      .where(eq(observation.id, body.observationId))
      .limit(1);
    expect(Number(row.valueNum)).toBe(6); // 3 * conversionFactor(2)
  });

  it('flags a replay of the same idempotency key as a duplicate, returning the same observationId, not a new write', async () => {
    const { instrumentId, channelCode } = await publishMapping();
    const { accessionNumber } = await createCorrelatableFixture();
    const payload = rawResult({
      instrumentId,
      analyte: channelCode,
      specimenId: accessionNumber,
    });

    const first = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(payload)
      .expect(202);
    const firstBody = first.body as {
      duplicate: boolean;
      observationId: string;
    };
    expect(firstBody.duplicate).toBe(false);

    const replay = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(payload)
      .expect(202);
    const replayBody = replay.body as {
      duplicate: boolean;
      observationId: string;
    };
    expect(replayBody.duplicate).toBe(true);
    expect(replayBody.observationId).toBe(firstBody.observationId);
  });
});
