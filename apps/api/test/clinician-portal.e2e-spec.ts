import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDb,
  observation,
  patient,
  resultReleasePolicy,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const CLINICIAN_LOGIN_USER = 'test-user-7';
// Same real, seeded critical-low threshold (120/160) the existing
// critical-notification e2e spec already uses (domain/critical-values
// Skill entry #3) -- reused rather than re-derived.
const SODIUM_CODE = 'NA';
const SODIUM_CRITICAL_LOW_VALUE = 115;
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-038 (docs/plans/feat-038-clinician-portal.md). The one stated AC: a
 * clinician can place an order, view a result, and acknowledge a critical
 * for their own patients, without lab-staff involvement in that loop.
 * `care_relationship` rows come from the new
 * `POST /v1/patients/:id/care-relationships` staff-assign endpoint (proposal
 * §10 Q1) -- not a direct DB insert, unlike `clinician-scope.e2e-spec.ts`'s
 * own precedent (that spec predates this endpoint existing at all).
 */
describe('Clinician portal (e2e)', () => {
  let app: INestApplication<App>;
  let staffToken: string; // test-user, TENANT_A -- manage_patients/manage_orders/manage_specimens/enter_result
  let verifierToken: string; // test-user-4, TENANT_A -- verify
  let clinicianToken: string;
  let clinicianSub: string;
  let db: ReturnType<typeof createDb>;
  let glucoseTestDefinitionId: string;
  let sodiumTestDefinitionId: string;
  let sodiumAnalyteId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [staffToken, verifierToken, clinicianToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
      getKeycloakToken(CLINICIAN_LOGIN_USER, 'test-password-7'),
    ]);
    const payload = clinicianToken.split('.')[1];
    clinicianSub = (
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
        sub: string;
      }
    ).sub;

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [glucose] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, GLUCOSE_CODE),
        ),
      )
      .limit(1);
    const [sodium] = await db
      .select({
        testDefId: testDefinition.id,
        analyteId: testAnalyte.analyteId,
      })
      .from(testAnalyte)
      .innerJoin(
        testDefinition,
        eq(testAnalyte.testDefinitionId, testDefinition.id),
      )
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, SODIUM_CODE),
        ),
      )
      .limit(1);
    if (!glucose || !sodium) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseTestDefinitionId = glucose.id;
    sodiumTestDefinitionId = sodium.testDefId;
    sodiumAnalyteId = sodium.analyteId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createPatient(lastName: string): Promise<string> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `CLIN-PORTAL-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'ClinicianPortal',
        lastName,
        sex: 'U',
      })
      .returning();
    return pat.id;
  }

  async function assignClinician(patientId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/v1/patients/${patientId}/care-relationships`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ clinicianUserId: clinicianSub })
      .expect(201);
  }

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

  describe('POST /v1/patients/:id/care-relationships (staff-assign)', () => {
    it('a manage_patients caller can assign a clinician to a patient', async () => {
      const patientId = await createPatient(`Assign-${randomUUID()}`);
      const res = await request(app.getHttpServer())
        .post(`/v1/patients/${patientId}/care-relationships`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ clinicianUserId: randomUUID() })
        .expect(201);
      const body = res.body as { after: { patientId: string } };
      expect(body.after.patientId).toBe(patientId);
    });

    it('rejects a clinician-only caller -- wrong capability', async () => {
      const patientId = await createPatient(`AssignDenied-${randomUUID()}`);
      await request(app.getHttpServer())
        .post(`/v1/patients/${patientId}/care-relationships`)
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ clinicianUserId: randomUUID() })
        .expect(403);
    });

    it('409s on assigning the same clinician to the same patient twice', async () => {
      const patientId = await createPatient(`AssignDup-${randomUUID()}`);
      const sameClinicianUserId = randomUUID();
      await request(app.getHttpServer())
        .post(`/v1/patients/${patientId}/care-relationships`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ clinicianUserId: sameClinicianUserId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/patients/${patientId}/care-relationships`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ clinicianUserId: sameClinicianUserId })
        .expect(409);
    });

    it('404s on a nonexistent patient id', async () => {
      await request(app.getHttpServer())
        .post(`/v1/patients/${randomUUID()}/care-relationships`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ clinicianUserId: randomUUID() })
        .expect(404);
    });
  });

  describe('GET /v1/clinician/patients', () => {
    it("lists only the clinician's own related patients, never an unrelated same-tenant one", async () => {
      const relatedId = await createPatient(`ListMine-${randomUUID()}`);
      await assignClinician(relatedId);
      const unrelatedId = await createPatient(`ListNotMine-${randomUUID()}`);

      const res = await request(app.getHttpServer())
        .get('/v1/clinician/patients')
        .set('Authorization', `Bearer ${clinicianToken}`)
        .expect(200);
      const ids = (res.body as { id: string }[]).map((p) => p.id);
      expect(ids).toContain(relatedId);
      expect(ids).not.toContain(unrelatedId);
    });
  });

  describe('POST /v1/clinician/orders', () => {
    it('places an order for a related patient', async () => {
      const patientId = await createPatient(`Order-${randomUUID()}`);
      await assignClinician(patientId);

      const res = await request(app.getHttpServer())
        .post('/v1/clinician/orders')
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ patientId, testDefinitionIds: [glucoseTestDefinitionId] })
        .expect(201);
      const body = res.body as {
        after: { patientId: string; orderedTests: { id: string }[] };
      };
      expect(body.after.patientId).toBe(patientId);
      expect(body.after.orderedTests).toHaveLength(1);
    });

    it('404s placing an order for an unrelated patient -- never a leaked 400/403', async () => {
      const patientId = await createPatient(`OrderDenied-${randomUUID()}`);
      // No care_relationship assigned.
      await request(app.getHttpServer())
        .post('/v1/clinician/orders')
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ patientId, testDefinitionIds: [glucoseTestDefinitionId] })
        .expect(404);
    });
  });

  describe('GET /v1/clinician/patients/:patientId/results', () => {
    async function createVerifiedGlucose(
      patientId: string,
      value: number,
    ): Promise<void> {
      const orderRes = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ patientId, testDefinitionIds: [glucoseTestDefinitionId] })
        .expect(201);
      const orderBody = orderRes.body as {
        resourceId: string;
        after: { orderedTests: { id: string }[] };
      };
      const orderedTestId = orderBody.after.orderedTests[0].id;
      await request(app.getHttpServer())
        .post('/v1/specimens')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ orderId: orderBody.resourceId, specimenType: 'serum' })
        .expect(201);

      const [analyteRow] = await db
        .select({ analyteId: testAnalyte.analyteId })
        .from(testAnalyte)
        .where(eq(testAnalyte.testDefinitionId, glucoseTestDefinitionId))
        .limit(1);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${analyteRow.analyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ dataType: 'quantity', valueNum: value })
        .expect(200);
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${analyteRow.analyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({})
        .expect(200);
    }

    it('a clinician sees a verified result for a related patient immediately, even under a delayed release policy -- bypass proven', async () => {
      await setReleasePolicy('delayed', 24);
      const patientId = await createPatient(`Results-${randomUUID()}`);
      await assignClinician(patientId);
      await createVerifiedGlucose(patientId, 90);

      const res = await request(app.getHttpServer())
        .get(`/v1/clinician/patients/${patientId}/results`)
        .set('Authorization', `Bearer ${clinicianToken}`)
        .expect(200);
      const body = res.body as {
        analytes: { analyteDisplay: string; latest: { value: string } }[];
      };
      const glucose = body.analytes.find((a) => a.analyteDisplay === 'Glucose');
      expect(glucose?.latest.value).toBe('90');
    });

    it("404s viewing an unrelated patient's results", async () => {
      const patientId = await createPatient(`ResultsDenied-${randomUUID()}`);
      await request(app.getHttpServer())
        .get(`/v1/clinician/patients/${patientId}/results`)
        .set('Authorization', `Bearer ${clinicianToken}`)
        .expect(404);
    });
  });

  describe('critical acknowledgement', () => {
    async function createPendingSodiumCritical(
      patientId: string,
    ): Promise<{ notificationId: string; observationId: string }> {
      const orderRes = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ patientId, testDefinitionIds: [sodiumTestDefinitionId] })
        .expect(201);
      const orderBody = orderRes.body as {
        resourceId: string;
        after: { orderedTests: { id: string }[] };
      };
      const orderedTestId = orderBody.after.orderedTests[0].id;
      await request(app.getHttpServer())
        .post('/v1/specimens')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ orderId: orderBody.resourceId, specimenType: 'serum' })
        .expect(201);

      // Always 409s (TASK-056: a single-analyte ordered_test's finalize
      // trips FinalizationRollupInterceptor's unacknowledged-critical hold
      // on its own first call) -- the observation/notification writes still
      // commit underneath it, same established pattern
      // `critical-notification.e2e-spec.ts` already uses.
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ dataType: 'quantity', valueNum: SODIUM_CRITICAL_LOW_VALUE })
        .expect(409);

      const [obsRow] = await db
        .select({ id: observation.id })
        .from(observation)
        .where(
          and(
            eq(observation.orderedTestId, orderedTestId),
            eq(observation.analyteId, sodiumAnalyteId),
          ),
        )
        .limit(1);

      const listRes = await request(app.getHttpServer())
        .get('/v1/critical-notifications')
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);
      const notification = (
        listRes.body as { id: string; observationId: string }[]
      ).find((n) => n.observationId === obsRow.id);
      if (!notification) {
        throw new Error('expected a pending critical notification to exist');
      }
      return { notificationId: notification.id, observationId: obsRow.id };
    }

    it('a clinician can acknowledge a critical on their own related patient', async () => {
      const patientId = await createPatient(`CritAck-${randomUUID()}`);
      await assignClinician(patientId);
      const { notificationId } = await createPendingSodiumCritical(patientId);

      const res = await request(app.getHttpServer())
        .post(
          `/v1/clinician/critical-notifications/${notificationId}/acknowledge`,
        )
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ readBack: 'Read back to Dr. Smith, confirmed 115 mmol/L.' })
        .expect(200);
      const body = res.body as { after: { status: string } };
      expect(body.after.status).toBe('acknowledged');
    });

    it("404s acknowledging an unrelated patient's critical", async () => {
      const patientId = await createPatient(`CritAckDenied-${randomUUID()}`);
      // No care_relationship assigned.
      const { notificationId } = await createPendingSodiumCritical(patientId);

      await request(app.getHttpServer())
        .post(
          `/v1/clinician/critical-notifications/${notificationId}/acknowledge`,
        )
        .set('Authorization', `Bearer ${clinicianToken}`)
        .send({ readBack: 'Should never be recorded.' })
        .expect(404);
    });

    it("GET /v1/critical-notifications only returns the clinician's own related patients' criticals", async () => {
      const relatedPatientId = await createPatient(
        `ListRelated-${randomUUID()}`,
      );
      await assignClinician(relatedPatientId);
      const unrelatedPatientId = await createPatient(
        `ListUnrelated-${randomUUID()}`,
      );
      const { notificationId: relatedId } =
        await createPendingSodiumCritical(relatedPatientId);
      const { notificationId: unrelatedId } =
        await createPendingSodiumCritical(unrelatedPatientId);

      const res = await request(app.getHttpServer())
        .get('/v1/critical-notifications')
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${clinicianToken}`)
        .expect(200);
      const ids = (res.body as { id: string }[]).map((n) => n.id);
      expect(ids).toContain(relatedId);
      expect(ids).not.toContain(unrelatedId);
    });
  });
});
