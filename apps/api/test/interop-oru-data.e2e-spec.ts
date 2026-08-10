import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  createDb,
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
import { getInteropToken } from './get-interop-token';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';
const GLUCOSE_LOINC = '2345-7';

/**
 * FEAT-036 AC #2: proves `GET /internal/interop/observations/:id/oru-data`
 * -- the read side `apps/interop`'s `OruBuilderService` calls to build a
 * real ORU^R01. Builds a real verified Observation through the actual
 * draft -> finalize -> verify HTTP flow (same discipline
 * `observation.e2e-spec.ts` already established), not a direct DB insert,
 * so this proves the route against exactly the shape a real verified
 * result has.
 */
describe('Interop ORU data (e2e)', () => {
  let app: INestApplication<App>;
  let interopToken: string;
  let tokenA: string;
  let verifierToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseAnalyteId: string;
  let glucoseTestDefinitionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [interopToken, tokenA, verifierToken] = await Promise.all([
      getInteropToken(),
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
    ]);

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [row] = await db
      .select({ analyteId: analyte.id, testDefinitionId: testDefinition.id })
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
    if (!row) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseAnalyteId = row.analyteId;
    glucoseTestDefinitionId = row.testDefinitionId;
  });

  afterAll(async () => {
    await app.close();
  });

  /** A real, enterable ordered test for glucose, with a real specimen
   * fulfilling it -- `loadWriteContext`'s own precondition (an ordered_test
   * with 'received'/'in_process' status must have a real
   * specimen_fulfillment row, or draft() 409s: "no associated specimen
   * despite its status"). Mirrors gateway-ingest.e2e-spec.ts's own
   * identical fixture shape. */
  async function createReceivedOrderedTest(): Promise<string> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `ORU-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Oru',
        lastName: 'Test',
        sex: 'U',
      })
      .returning();
    const [ord] = await db
      .insert(order)
      .values({ tenantId: TENANT_A, patientId: pat.id })
      .returning();
    const [ot] = await db
      .insert(orderedTest)
      .values({
        tenantId: TENANT_A,
        orderId: ord.id,
        testDefinitionId: glucoseTestDefinitionId,
        status: 'received',
      })
      .returning();
    const [sp] = await db
      .insert(specimen)
      .values({
        tenantId: TENANT_A,
        accessionNumber: `ORU-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });
    return ot.id;
  }

  /** Real draft -> finalize -> verify flow through the actual HTTP stack --
   * returns the verified observation id. */
  async function createVerifiedObservation(): Promise<string> {
    const orderedTestId = await createReceivedOrderedTest();

    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 90 })
      .expect(200);

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 90 })
      .expect(200);

    const verifyRes = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({})
      .expect(200);

    const body = verifyRes.body as { after: { observation: { id: string } } };
    return body.after.observation.id;
  }

  it('returns 404 for a nonexistent observation id', () => {
    return request(app.getHttpServer())
      .get(`/internal/interop/observations/${randomUUID()}/oru-data`)
      .set('Authorization', `Bearer ${interopToken}`)
      .expect(404);
  });

  it('returns 409 for an observation that is not verified yet', async () => {
    const orderedTestId = await createReceivedOrderedTest();

    const draftRes = await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 5.4 })
      .expect(200);
    const draftBody = draftRes.body as { id: string };

    await request(app.getHttpServer())
      .get(`/internal/interop/observations/${draftBody.id}/oru-data`)
      .set('Authorization', `Bearer ${interopToken}`)
      .expect(409);
  });

  it('returns the real LOINC code, value, unit, range, and flags for a verified observation — 200', async () => {
    const observationId = await createVerifiedObservation();

    const res = await request(app.getHttpServer())
      .get(`/internal/interop/observations/${observationId}/oru-data`)
      .set('Authorization', `Bearer ${interopToken}`)
      .expect(200);

    const body = res.body as {
      patientMrn: string;
      analyteCode: string;
      analyteDisplay: string;
      value: string;
      unit: string | null;
      refLow: number | null;
      refHigh: number | null;
      flags: string[];
      verifiedAt: string;
    };
    expect(body.analyteCode).toBe(GLUCOSE_LOINC);
    expect(body.analyteDisplay).toBe('Glucose');
    expect(body.value).toBe('90');
    expect(typeof body.patientMrn).toBe('string');
    expect(body.patientMrn.length).toBeGreaterThan(0);
    expect(Array.isArray(body.flags)).toBe(true);
    expect(new Date(body.verifiedAt).toString()).not.toBe('Invalid Date');
  });

  it('rejects a real human token — 403 (interop_ingest is machine-only)', async () => {
    const observationId = await createVerifiedObservation();
    return request(app.getHttpServer())
      .get(`/internal/interop/observations/${observationId}/oru-data`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });
});
