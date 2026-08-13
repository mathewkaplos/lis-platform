import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb } from '@lis/db';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

/**
 * FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md).
 * Proves the proposal's §4 verification plan against a real Postgres
 * instance: patient contact-field round-trip, referring-facility create/
 * list/tenant-isolation, order attribution to a real vs. cross-tenant
 * facility, and invoice payerType defaulting/validation.
 */
describe('Patient contact fields + referring facility (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_patients/manage_billing
  let tokenB: string; // test-user-2: tenant B

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Contact', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createReferringFacility(
    token: string = tokenA,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/referring-facilities')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Radiocare Diagnostics', phone: '0700111222' })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrderFor(
    patientId: string,
    extra: Record<string, unknown> = {},
    expectedStatus = 201,
  ) {
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
    return request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glu.id], ...extra })
      .expect(expectedStatus);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');
    tokenB = await getKeycloakToken('test-user-2', 'test-password-2');

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC: patient create/response round-trips all 5 new contact fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Ann',
        lastName: 'Muthoni',
        sex: 'F',
        phone: '0722000111',
        email: 'ann@example.test',
        address: 'Eldoret, Kenya',
        nextOfKinName: 'Peter Muthoni',
        nextOfKinPhone: '0733000222',
      })
      .expect(201);
    const body = res.body as {
      after: {
        phone: string;
        email: string;
        address: string;
        nextOfKinName: string;
        nextOfKinPhone: string;
      };
    };
    expect(body.after.phone).toBe('0722000111');
    expect(body.after.email).toBe('ann@example.test');
    expect(body.after.address).toBe('Eldoret, Kenya');
    expect(body.after.nextOfKinName).toBe('Peter Muthoni');
    expect(body.after.nextOfKinPhone).toBe('0733000222');
  });

  it('AC: referring-facility create + list is tenant-isolated', async () => {
    const facilityId = await createReferringFacility(tokenA);

    const listResA = await request(app.getHttpServer())
      .get('/v1/referring-facilities')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const namesA = (listResA.body as { name: string }[]).map((f) => f.name);
    expect(namesA).toContain('Radiocare Diagnostics');

    const listResB = await request(app.getHttpServer())
      .get('/v1/referring-facilities')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const idsB = (listResB.body as { id: string }[]).map((f) => f.id);
    expect(idsB).not.toContain(facilityId);
  });

  it('AC: order create with a valid referringFacilityId succeeds and persists orderingProviderName', async () => {
    const patientId = await createPatient();
    const facilityId = await createReferringFacility();

    const res = await createOrderFor(patientId, {
      referringFacilityId: facilityId,
      orderingProviderName: 'Dr. Otieno',
    });
    const body = res.body as {
      after: { referringFacilityId: string; orderingProviderName: string };
    };
    expect(body.after.referringFacilityId).toBe(facilityId);
    expect(body.after.orderingProviderName).toBe('Dr. Otieno');
  });

  it('AC: order create with a cross-tenant referringFacilityId 400s', async () => {
    const patientId = await createPatient();
    const crossTenantFacilityId = await createReferringFacility(tokenB);

    await createOrderFor(
      patientId,
      { referringFacilityId: crossTenantFacilityId },
      400,
    );
  });

  it('AC: invoice generation defaults to payerType cash / referringFacilityId null when omitted (regression)', async () => {
    const patientId = await createPatient();
    const orderRes = await createOrderFor(patientId);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const body = invoiceRes.body as {
      after: { payerType: string; referringFacilityId: string | null };
    };
    expect(body.after.payerType).toBe('cash');
    expect(body.after.referringFacilityId).toBeNull();
  });

  it("AC: invoice generation with payerType 'corporate' and no referringFacilityId 400s", async () => {
    const patientId = await createPatient();
    const orderRes = await createOrderFor(patientId);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ payerType: 'corporate' })
      .expect(400);
  });

  it("AC: invoice generation with payerType 'corporate' and a valid referringFacilityId succeeds", async () => {
    const patientId = await createPatient();
    const facilityId = await createReferringFacility();
    const orderRes = await createOrderFor(patientId);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ payerType: 'corporate', referringFacilityId: facilityId })
      .expect(201);
    const body = invoiceRes.body as {
      after: { payerType: string; referringFacilityId: string };
    };
    expect(body.after.payerType).toBe('corporate');
    expect(body.after.referringFacilityId).toBe(facilityId);
  });
});
