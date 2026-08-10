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
  patientPortalAccount,
  resultReleasePolicy,
  specimen,
  specimenFulfillment,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-039's one stated AC: a patient can view their own verified results
 * and trends, gated by the configured release policy. `patient_portal_account`
 * rows are inserted directly via `@lis/db` (proposal §5 -- no assignment
 * endpoint exists yet), mirroring `clinician-scope.e2e-spec.ts`'s own
 * established precedent.
 */
describe('Patient portal results (e2e)', () => {
  let app: INestApplication<App>;
  let patientToken: string;
  let patientSub: string;
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

    [patientToken, tokenA, verifierToken] = await Promise.all([
      getKeycloakToken('test-user-8', 'test-password-8'),
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
    ]);
    const payload = patientToken.split('.')[1];
    patientSub = (
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
        sub: string;
      }
    ).sub;

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

  async function setReleasePolicy(
    mode: 'immediate' | 'delayed',
    delayHours = 0,
  ): Promise<void> {
    await db
      .delete(resultReleasePolicy)
      .where(eq(resultReleasePolicy.tenantId, TENANT_A));
    await db
      .insert(resultReleasePolicy)
      .values({ tenantId: TENANT_A, mode, delayHours });
  }

  /** `patient_portal_account` is 1:1 per `patientUserId` (proposal §5) --
   * each test that needs its own isolated patient re-links the single
   * seeded `patientSub` to a fresh patient rather than accumulating
   * multiple accounts (which the unique index would reject outright) or
   * letting observations pile up across tests on a shared one. */
  async function createEnrolledPatient(): Promise<string> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `PORTAL-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Portal',
        lastName: 'Test',
        sex: 'U',
      })
      .returning();
    await db
      .delete(patientPortalAccount)
      .where(eq(patientPortalAccount.patientUserId, patientSub));
    await db.insert(patientPortalAccount).values({
      tenantId: TENANT_A,
      patientUserId: patientSub,
      patientId: pat.id,
    });
    return pat.id;
  }

  async function createVerifiedObservation(
    patientId: string,
    value: number,
  ): Promise<string> {
    const [ord] = await db
      .insert(order)
      .values({ tenantId: TENANT_A, patientId })
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
        accessionNumber: `PORTAL-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${ot.id}/results/${glucoseAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: value })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${ot.id}/results/${glucoseAnalyteId}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: value })
      .expect(200);
    const verifyRes = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${ot.id}/results/${glucoseAnalyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({})
      .expect(200);

    const body = verifyRes.body as { after: { observation: { id: string } } };
    return body.after.observation.id;
  }

  it('rejects a non-patient role — 403 (view_own_results is patient-only)', async () => {
    await setReleasePolicy('immediate');
    await request(app.getHttpServer())
      .get('/v1/portal/results')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });

  it('returns an empty list (not an error) for a freshly-enrolled patient with zero eligible results', async () => {
    await setReleasePolicy('immediate');
    await createEnrolledPatient();

    const res = await request(app.getHttpServer())
      .get('/v1/portal/results')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    expect(res.body).toEqual({ analytes: [] });
  });

  it('an immediate-policy result is visible as soon as it is verified, with the correct value/trend shape', async () => {
    await setReleasePolicy('immediate');
    const patientId = await createEnrolledPatient();
    await createVerifiedObservation(patientId, 90);

    const res = await request(app.getHttpServer())
      .get('/v1/portal/results')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const body = res.body as {
      analytes: {
        analyteId: string;
        analyteDisplay: string;
        latest: { value: string; unit: string };
        trend: { value: string }[];
      }[];
    };
    const glucose = body.analytes.find((a) => a.analyteId === glucoseAnalyteId);
    expect(glucose).toBeDefined();
    expect(glucose?.analyteDisplay).toBe('Glucose');
    expect(glucose?.latest.value).toBe('90');
    expect(glucose?.trend).toHaveLength(1);
  });

  it('a second result on the same analyte extends the trend, latest reflects the most recent', async () => {
    await setReleasePolicy('immediate');
    const patientId = await createEnrolledPatient();
    await createVerifiedObservation(patientId, 85);
    await createVerifiedObservation(patientId, 95);

    const res = await request(app.getHttpServer())
      .get('/v1/portal/results')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const body = res.body as {
      analytes: {
        analyteId: string;
        latest: { value: string };
        trend: unknown[];
      }[];
    };
    const glucose = body.analytes.find((a) => a.analyteId === glucoseAnalyteId);
    expect(glucose?.trend).toHaveLength(2);
    expect(glucose?.latest.value).toBe('95');
  });

  it('a delayed-policy result is NOT visible until the delay has passed', async () => {
    await setReleasePolicy('delayed', 24);
    const patientId = await createEnrolledPatient();
    await createVerifiedObservation(patientId, 90);

    const res = await request(app.getHttpServer())
      .get('/v1/portal/results')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const body = res.body as { analytes: { analyteId: string }[] };
    expect(body.analytes.some((a) => a.analyteId === glucoseAnalyteId)).toBe(
      false,
    );
  });

  it('a zero-hour delayed policy is visible immediately, exercising the delayed code path at its own boundary', async () => {
    // Real "becomes visible once the delay elapses" state-transition proof
    // lives in `release-policy.spec.ts` (`isReleased`, deterministic
    // Date inputs) -- `observation.verified_at` cannot be backdated after
    // the fact here to simulate elapsed time: it's append-only-protected by
    // a real DB trigger (Constitution Law #2, confirmed directly: an
    // UPDATE attempt raises "is verified and append-only"), unlike
    // `sla_breach`'s own backdatable fixture columns. This test instead
    // proves the `delayed` mode's own date-math path at its zero-length
    // boundary against a real, freshly-verified observation.
    await setReleasePolicy('delayed', 0);
    const patientId = await createEnrolledPatient();
    await createVerifiedObservation(patientId, 90);

    const res = await request(app.getHttpServer())
      .get('/v1/portal/results')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(200);

    const body = res.body as { analytes: { analyteId: string }[] };
    expect(body.analytes.some((a) => a.analyteId === glucoseAnalyteId)).toBe(
      true,
    );
  });
});
