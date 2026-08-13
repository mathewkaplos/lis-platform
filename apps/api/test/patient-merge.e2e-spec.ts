import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  careRelationship,
  createDb,
  invoice,
  observation,
  order,
  patient,
  patientAlert,
  patientPortalAccount,
} from '@lis/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

/**
 * FEAT-065 (ADR-0052, docs/plans/feat-065-patient-merge.md). Proves every
 * ADR-0052 acceptance criterion against a real Postgres instance: a full
 * merge physically re-points all six dependent tables, the loser's own row
 * survives tombstoned (not deleted), the survivor's read path surfaces the
 * merge, and the rejection cases (self-merge, already-merged, dual portal
 * accounts) are real 400/409s, not silently resolved.
 */
describe('Patient merge (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_patients
  let analyteId: string;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Merge', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrderFor(
    patientId: string,
  ): Promise<{ orderId: string; orderedTestId: string }> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const glu = (
      catalogRes.body as { tests: { id: string; code: string }[] }
    ).tests.find((t) => t.code === 'GLU');
    if (!glu) {
      throw new Error("expected db/seed/chemistry-catalog.sql fixture 'GLU'");
    }
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glu.id] })
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    return {
      orderId: body.resourceId,
      orderedTestId: body.after.orderedTests[0].id,
    };
  }

  /** A full fixture set across every one of the six dependent tables
   * (proposal §8): a real order (which itself denormalizes patientId), a
   * directly-inserted observation/alert/care_relationship (no create-route
   * exists for these, same precedent control-lot.e2e-spec.ts/
   * clinician-portal.e2e-spec.ts already established), and a real invoice
   * via its own route. */
  async function createFullFixture(): Promise<{
    patientId: string;
    orderId: string;
    orderedTestId: string;
    observationId: string;
    alertId: string;
    careRelationshipId: string;
    invoiceId: string;
  }> {
    const patientId = await createPatient();
    const { orderId, orderedTestId } = await createOrderFor(patientId);

    const [obsRow] = await db
      .insert(observation)
      .values({
        tenantId: TENANT_A,
        orderedTestId,
        analyteId,
        patientId,
        dataType: 'quantity',
        valueNum: '5.5',
        source: 'manual',
      })
      .returning();

    const [alertRow] = await db
      .insert(patientAlert)
      .values({
        tenantId: TENANT_A,
        patientId,
        alertType: 'allergy',
        severity: 'high',
        description: 'Fixture alert',
        addedByPrincipalId: '00000000-0000-0000-0000-0000000000aa',
      })
      .returning();

    const [careRow] = await db
      .insert(careRelationship)
      .values({
        tenantId: TENANT_A,
        clinicianUserId: '00000000-0000-0000-0000-0000000000bb',
        patientId,
      })
      .returning();

    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const invoiceId = (invoiceRes.body as { resourceId: string }).resourceId;

    return {
      patientId,
      orderId,
      orderedTestId,
      observationId: obsRow.id,
      alertId: alertRow.id,
      careRelationshipId: careRow.id,
      invoiceId,
    };
  }

  async function auditCount(): Promise<number> {
    const [{ value }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(auditEvent)
      .where(eq(auditEvent.tenantId, TENANT_A));
    return value;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [analyteRow] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .limit(1);
    if (!analyteRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    analyteId = analyteRow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC: a full merge re-points all six dependent tables onto the survivor, tombstones the loser, and writes exactly one audit_event', async () => {
    const survivorId = await createPatient();
    const loser = await createFullFixture();
    const before = await auditCount();

    const res = await request(app.getHttpServer())
      .post(`/v1/patients/${survivorId}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        loserPatientId: loser.patientId,
        reason: 'duplicate registration',
      })
      .expect(200);
    const body = res.body as {
      after: { movedCounts: Record<string, number> };
    };
    expect(body.after.movedCounts).toEqual({
      order: 1,
      observation: 1,
      patientAlert: 1,
      careRelationship: 1,
      patientPortalAccount: 0,
      invoice: 1,
    });

    const [orderRow] = await db
      .select({ patientId: order.patientId })
      .from(order)
      .where(eq(order.id, loser.orderId));
    expect(orderRow.patientId).toBe(survivorId);

    const [obsRow] = await db
      .select({ patientId: observation.patientId })
      .from(observation)
      .where(eq(observation.id, loser.observationId));
    expect(obsRow.patientId).toBe(survivorId);

    const [alertRow] = await db
      .select({ patientId: patientAlert.patientId })
      .from(patientAlert)
      .where(eq(patientAlert.id, loser.alertId));
    expect(alertRow.patientId).toBe(survivorId);

    const [careRow] = await db
      .select({ patientId: careRelationship.patientId })
      .from(careRelationship)
      .where(eq(careRelationship.id, loser.careRelationshipId));
    expect(careRow.patientId).toBe(survivorId);

    const [invoiceRow] = await db
      .select({ patientId: invoice.patientId })
      .from(invoice)
      .where(eq(invoice.id, loser.invoiceId));
    expect(invoiceRow.patientId).toBe(survivorId);

    // The loser's own row is preserved, tombstoned, never deleted.
    const [loserRow] = await db
      .select()
      .from(patient)
      .where(eq(patient.id, loser.patientId));
    expect(loserRow).toBeDefined();
    expect(loserRow.mergedInto).toBe(survivorId);
    expect(loserRow.firstName).toBe('Merge');

    const after = await auditCount();
    expect(after).toBe(before + 1);
  });

  it("GET on the loser's own id returns 200 with mergedInto set; GET on the survivor returns mergedFrom including the loser", async () => {
    const survivorId = await createPatient();
    const loserId = await createPatient();
    await request(app.getHttpServer())
      .post(`/v1/patients/${survivorId}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: loserId, reason: 'duplicate registration' })
      .expect(200);

    const loserRes = await request(app.getHttpServer())
      .get(`/v1/patients/${loserId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((loserRes.body as { mergedInto: string | null }).mergedInto).toBe(
      survivorId,
    );

    const survivorRes = await request(app.getHttpServer())
      .get(`/v1/patients/${survivorId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((survivorRes.body as { mergedFrom: string[] }).mergedFrom).toContain(
      loserId,
    );
  });

  it('a merged-away patient is excluded from free-text search by default, but still resolves directly by MRN', async () => {
    const survivorId = await createPatient();
    const loserId = await createPatient();
    const loserRes = await request(app.getHttpServer())
      .get(`/v1/patients/${loserId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const loserMrn = (loserRes.body as { mrn: string }).mrn;

    await request(app.getHttpServer())
      .post(`/v1/patients/${survivorId}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: loserId, reason: 'duplicate registration' })
      .expect(200);

    const searchRes = await request(app.getHttpServer())
      .get(`/v1/patients?q=Merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const ids = (searchRes.body as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(loserId);

    const mrnRes = await request(app.getHttpServer())
      .get(`/v1/patients?mrn=${loserMrn}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect((mrnRes.body as { id: string }[])[0]?.id).toBe(loserId);
  });

  it('rejects a self-merge (400)', async () => {
    const patientId = await createPatient();
    await request(app.getHttpServer())
      .post(`/v1/patients/${patientId}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: patientId, reason: 'nonsense' })
      .expect(400);
  });

  it('rejects merging into an already-merged-away patient, and rejects an already-merged-away patient as the loser (both 400)', async () => {
    const a = await createPatient();
    const b = await createPatient();
    const c = await createPatient();
    await request(app.getHttpServer())
      .post(`/v1/patients/${a}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: b, reason: 'first merge' })
      .expect(200);

    // b is now merged-away -- cannot merge into it.
    await request(app.getHttpServer())
      .post(`/v1/patients/${b}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: c, reason: 'should be rejected' })
      .expect(400);

    // b is now merged-away -- cannot use it as a loser either.
    await request(app.getHttpServer())
      .post(`/v1/patients/${c}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: b, reason: 'should be rejected' })
      .expect(400);
  });

  it('rejects a merge when both patients already have their own portal account (409)', async () => {
    const survivorId = await createPatient();
    const loserId = await createPatient();
    await db.insert(patientPortalAccount).values([
      {
        tenantId: TENANT_A,
        patientUserId: '00000000-0000-0000-0000-0000000000c1',
        patientId: survivorId,
      },
      {
        tenantId: TENANT_A,
        patientUserId: '00000000-0000-0000-0000-0000000000c2',
        patientId: loserId,
      },
    ]);

    await request(app.getHttpServer())
      .post(`/v1/patients/${survivorId}/merge`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ loserPatientId: loserId, reason: 'duplicate registration' })
      .expect(409);
  });
});
