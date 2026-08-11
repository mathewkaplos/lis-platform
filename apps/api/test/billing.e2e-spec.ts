import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, testDefinition } from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-046 (ADR-0041): proves the thin invoice + payment-status edge
 * through the live API -- real Keycloak tokens, real Postgres, matching
 * order.e2e-spec.ts's own standard. `db/seed/chemistry-catalog.sql`'s
 * GLU/BUN tests have no billing metadata yet (task-22's own seed backfill
 * is separate, real seed-data work, not this test's job) -- set directly
 * here via the migrations-role `db`, the same fixture-setup pattern
 * order.e2e-spec.ts already uses for its own panel/test fixtures.
 */
describe('Billing & payments (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let patientId: string;
  let glucoseId: string;
  let bunId: string;
  const GLUCOSE_PRICE_CENTS = 500;
  const BUN_PRICE_CENTS = 700;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenB] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-2', 'test-password-2'),
    ]);

    const db = createDb();
    const [glucose] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, 'GLU'),
        ),
      );
    const [bun] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, 'BUN'),
        ),
      );
    if (!glucose || !bun) {
      throw new Error(
        'expected db/seed/chemistry-catalog.sql fixtures (GLU, BUN) to exist under TENANT_A',
      );
    }
    glucoseId = glucose.id;
    bunId = bun.id;
    await db
      .update(testDefinition)
      .set({ billingCode: 'GLU-CPT', priceCents: GLUCOSE_PRICE_CENTS })
      .where(eq(testDefinition.id, glucoseId));
    await db
      .update(testDefinition)
      .set({ billingCode: 'BUN-CPT', priceCents: BUN_PRICE_CENTS })
      .where(eq(testDefinition.id, bunId));

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Billing', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOrder(testDefinitionIds: string[]): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  it('generates an invoice from an order, snapshotting billing code/price at generation time', async () => {
    const orderId = await createOrder([glucoseId, bunId]);

    const res = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: {
        totalCents: number;
        status: string;
        lineItems: { billingCode: string; unitPriceCents: number }[];
      };
    };
    if (body.after.totalCents !== GLUCOSE_PRICE_CENTS + BUN_PRICE_CENTS) {
      throw new Error(
        `expected totalCents ${GLUCOSE_PRICE_CENTS + BUN_PRICE_CENTS}, got ${body.after.totalCents}`,
      );
    }
    if (body.after.status !== 'unpaid') {
      throw new Error(
        `expected a fresh invoice to be unpaid, got ${body.after.status}`,
      );
    }
    if (body.after.lineItems.length !== 2) {
      throw new Error(
        `expected 2 line items, got ${body.after.lineItems.length}`,
      );
    }

    // Mutating the catalog price *after* generation must not alter the
    // already-generated invoice -- the snapshot-write discipline this
    // feature exists to prove.
    const db = createDb();
    await db
      .update(testDefinition)
      .set({ priceCents: 999999 })
      .where(eq(testDefinition.id, glucoseId));
    const reread = await request(app.getHttpServer())
      .get(`/v1/invoices/${body.resourceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    if (
      (reread.body as { totalCents: number }).totalCents !==
      GLUCOSE_PRICE_CENTS + BUN_PRICE_CENTS
    ) {
      throw new Error(
        'invoice total changed after a later catalog price change -- snapshot discipline violated',
      );
    }
    await db
      .update(testDefinition)
      .set({ priceCents: GLUCOSE_PRICE_CENTS })
      .where(eq(testDefinition.id, glucoseId));
  });

  it('rejects invoicing an order containing a test with no price configured (400, not a silent $0)', async () => {
    const db = createDb();
    const [unpriced] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: `NOPRICE-${Date.now()}`,
        displayName: 'No Price Test',
      })
      .returning();
    const orderId = await createOrder([unpriced.id]);

    await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it('records payments and transitions invoice status unpaid -> partial -> paid, via the stub mobile-money provider', async () => {
    const orderId = await createOrder([glucoseId, bunId]);
    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const invoiceId = (invoiceRes.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: GLUCOSE_PRICE_CENTS })
      .expect(201);
    const afterPartial = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    if ((afterPartial.body as { status: string }).status !== 'partial') {
      throw new Error(
        `expected partial after a partial cash payment, got ${(afterPartial.body as { status: string }).status}`,
      );
    }

    const mobileMoneyRes = await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        method: 'mobile_money',
        amountCents: BUN_PRICE_CENTS,
        reference: '+254700000000',
      })
      .expect(201);
    const paymentBody = mobileMoneyRes.body as {
      after: { status: string; providerReference: string; method: string };
    };
    if (paymentBody.after.status !== 'succeeded') {
      throw new Error(
        `expected the stub provider to succeed, got ${paymentBody.after.status}`,
      );
    }
    if (!paymentBody.after.providerReference) {
      throw new Error('expected a providerReference from the stub provider');
    }

    const afterPaid = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    if ((afterPaid.body as { status: string }).status !== 'paid') {
      throw new Error(
        `expected paid after full payment, got ${(afterPaid.body as { status: string }).status}`,
      );
    }

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: 100 })
      .expect(400);
  });

  it('is fully tenant-isolated: a different tenant cannot see the invoice, its line items, or its payments (404, not a leak)', async () => {
    const orderId = await createOrder([glucoseId]);
    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const invoiceId = (invoiceRes.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });
});
