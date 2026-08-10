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
import { Fhir } from 'fhir-tool';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/** `fhir-tool`'s own `Severities` enum is declared in its `.d.ts` but not
 * actually exported from its runtime `index.js` -- see
 * `observation-mapper.spec.ts`'s identical note. Compared as a plain
 * string, matching what `severity` actually is at runtime. */
function isHardFailure(severity: unknown): boolean {
  return severity === 'error' || severity === 'fatal';
}

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';
const GLUCOSE_LOINC = '2345-7';

/**
 * FEAT-037's one stated AC: proves `GET /fhir/Observation/:id` returns a
 * resource that validates against the R4 base profile -- run through the
 * real `fhir-tool` validator against the *actual HTTP response body*, not
 * just the mapper's own unit output (`observation-mapper.spec.ts` already
 * covers that). Builds a real verified Observation through the actual
 * draft -> finalize -> verify HTTP flow, same discipline
 * `interop-oru-data.e2e-spec.ts` already established.
 */
describe('FHIR Observation facade (e2e)', () => {
  let app: INestApplication<App>;
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

    [tokenA, verifierToken] = await Promise.all([
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

  async function createReceivedOrderedTest(): Promise<string> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `FHIR-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Fhir',
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
        accessionNumber: `FHIR-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });
    return ot.id;
  }

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

  it('rejects a request with no token — 401', async () => {
    const observationId = await createVerifiedObservation();
    await request(app.getHttpServer())
      .get(`/fhir/Observation/${observationId}`)
      .expect(401);
  });

  it('returns 404 for a nonexistent observation id', () => {
    return request(app.getHttpServer())
      .get(`/fhir/Observation/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('returns 409 for an observation that is not verified yet', async () => {
    const orderedTestId = await createReceivedOrderedTest();
    const draftRes = await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 90 })
      .expect(200);
    const draftBody = draftRes.body as { id: string };

    await request(app.getHttpServer())
      .get(`/fhir/Observation/${draftBody.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(409);
  });

  it('returns a real FHIR Observation that validates against the R4 base profile — the acceptance criterion', async () => {
    const observationId = await createVerifiedObservation();

    const res = await request(app.getHttpServer())
      .get(`/fhir/Observation/${observationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const resource = res.body as Record<string, unknown>;
    expect(resource.resourceType).toBe('Observation');
    expect(resource.status).toBe('final');
    expect(
      (resource.code as { coding: { code: string }[] }).coding[0].code,
    ).toBe(GLUCOSE_LOINC);

    // The actual acceptance criterion: run the real HTTP response body
    // through the real R4 validator, not just assert on its shape.
    const fhir = new Fhir();
    const result = fhir.validate(resource);
    const hardFailures = result.messages.filter((m) =>
      isHardFailure(m.severity),
    );
    expect(result.valid).toBe(true);
    expect(hardFailures).toEqual([]);
  });
});
