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
    const totalCents = GLUCOSE_PRICE_CENTS + BUN_PRICE_CENTS;

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: GLUCOSE_PRICE_CENTS })
      .expect(201);
    const afterPartial = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const partialBody = afterPartial.body as {
      status: string;
      amountPaidCents: number;
      balanceDueCents: number;
    };
    if (partialBody.status !== 'partial') {
      throw new Error(
        `expected partial after a partial cash payment, got ${partialBody.status}`,
      );
    }
    if (partialBody.amountPaidCents !== GLUCOSE_PRICE_CENTS) {
      throw new Error(
        `expected amountPaidCents ${GLUCOSE_PRICE_CENTS}, got ${partialBody.amountPaidCents}`,
      );
    }
    if (partialBody.balanceDueCents !== totalCents - GLUCOSE_PRICE_CENTS) {
      throw new Error(
        `expected balanceDueCents ${totalCents - GLUCOSE_PRICE_CENTS}, got ${partialBody.balanceDueCents}`,
      );
    }

    const mobileMoneyRes = await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        method: 'mobile_money',
        // Pays exactly the remaining balance, not just "the BUN price" --
        // proves "pay the exact remaining balance after a partial payment"
        // as its own assertion, not merely a coincidence of this fixture's
        // two-line-item total.
        amountCents: totalCents - GLUCOSE_PRICE_CENTS,
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
    const paidBody = afterPaid.body as {
      status: string;
      amountPaidCents: number;
      balanceDueCents: number;
    };
    if (paidBody.status !== 'paid') {
      throw new Error(`expected paid after full payment, got ${paidBody.status}`);
    }
    if (paidBody.amountPaidCents !== totalCents) {
      throw new Error(
        `expected amountPaidCents ${totalCents}, got ${paidBody.amountPaidCents}`,
      );
    }
    if (paidBody.balanceDueCents !== 0) {
      throw new Error(`expected balanceDueCents 0, got ${paidBody.balanceDueCents}`);
    }

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: 100 })
      .expect(400);
  });

  it('pays an unpaid invoice in full in one payment', async () => {
    const orderId = await createOrder([glucoseId]);
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

    const res = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as {
      status: string;
      amountPaidCents: number;
      balanceDueCents: number;
    };
    if (
      body.status !== 'paid' ||
      body.amountPaidCents !== GLUCOSE_PRICE_CENTS ||
      body.balanceDueCents !== 0
    ) {
      throw new Error(`unexpected invoice state after full payment: ${JSON.stringify(body)}`);
    }
  });

  /**
   * Regression test for the real, confirmed overpayment bug: a $210
   * invoice ($GLUCOSE + $BUN, this fixture's own prices, see the two
   * `testDefinition.priceCents` values set in `beforeAll`) took a $100
   * partial payment, then the take-payment form defaulted to the *full*
   * $210 again (not the real $110 remaining) with nothing server-side
   * stopping that amount from being accepted -- confirmed live,
   * 2026-08-18, ending in $310 collected against a $210 invoice. This test
   * reproduces the exact scenario end-to-end against the fix.
   */
  it('rejects a payment that would exceed the remaining balance -- the original overpayment regression', async () => {
    const orderId = await createOrder([glucoseId, bunId]);
    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const invoiceId = (invoiceRes.body as { resourceId: string }).resourceId;
    const totalCents = GLUCOSE_PRICE_CENTS + BUN_PRICE_CENTS; // 1200 ("$210" in the human-reported scenario)
    const partialCents = 400; // "$100" in the human-reported scenario
    const remainingCents = totalCents - partialCents; // "$110"

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: partialCents })
      .expect(201);

    const afterPartial = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const partialBody = afterPartial.body as {
      status: string;
      balanceDueCents: number;
    };
    // "reload invoice -> payment form should show $110 remaining"
    if (partialBody.balanceDueCents !== remainingCents) {
      throw new Error(
        `expected balanceDueCents ${remainingCents}, got ${partialBody.balanceDueCents}`,
      );
    }

    // "attempt $210 payment -> server must reject it"
    const overpayRes = await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: totalCents })
      .expect(400);
    if (
      !(overpayRes.body as { detail?: string }).detail
        ?.toLowerCase()
        .includes('exceeds the remaining balance')
    ) {
      throw new Error(
        `expected a clear "exceeds the remaining balance" error, got ${JSON.stringify(overpayRes.body)}`,
      );
    }

    // "invoice must remain partially paid with $110 outstanding"
    const stillPartial = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const stillPartialBody = stillPartial.body as {
      status: string;
      amountPaidCents: number;
      balanceDueCents: number;
    };
    if (
      stillPartialBody.status !== 'partial' ||
      stillPartialBody.amountPaidCents !== partialCents ||
      stillPartialBody.balanceDueCents !== remainingCents
    ) {
      throw new Error(
        `expected the rejected overpayment to leave the invoice unchanged, got ${JSON.stringify(stillPartialBody)}`,
      );
    }

    // "pay $110 -> invoice should become paid"
    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: remainingCents })
      .expect(201);

    const afterFull = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const finalBody = afterFull.body as {
      status: string;
      amountPaidCents: number;
      balanceDueCents: number;
    };
    // "total successful payments must equal exactly $210"
    if (
      finalBody.status !== 'paid' ||
      finalBody.amountPaidCents !== totalCents ||
      finalBody.balanceDueCents !== 0
    ) {
      throw new Error(
        `expected the invoice fully paid at exactly ${totalCents} cents, got ${JSON.stringify(finalBody)}`,
      );
    }
  });

  it('rejects any payment on an already-fully-paid invoice, even a small one', async () => {
    const orderId = await createOrder([glucoseId]);
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

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ method: 'cash', amountCents: 1 })
      .expect(400);
  });

  /**
   * Concurrency proof for the `FOR UPDATE` row lock (payment.service.ts):
   * fires two payment requests at the same invoice simultaneously, each
   * individually valid (each <= the total) but which together would
   * overpay it. Without the lock, both `recordPayment` calls could read
   * "nothing paid yet" before either writes, and both would succeed --
   * the exact shape of the original bug, just via a race instead of a
   * stale frontend default. With the lock, the second call blocks until
   * the first commits, then correctly sees the updated remaining balance
   * and rejects.
   */
  it('does not allow two concurrent payments to together overpay an invoice', async () => {
    const orderId = await createOrder([glucoseId, bunId]);
    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const invoiceId = (invoiceRes.body as { resourceId: string }).resourceId;
    const totalCents = GLUCOSE_PRICE_CENTS + BUN_PRICE_CENTS; // 1200
    const eachCents = 700; // 700 + 700 = 1400 > 1200, but 700 alone is valid

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ method: 'cash', amountCents: eachCents }),
      request(app.getHttpServer())
        .post(`/v1/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ method: 'cash', amountCents: eachCents }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    if (statuses[0] !== 201 || statuses[1] !== 400) {
      throw new Error(
        `expected exactly one of the two concurrent payments to succeed (201) and the other to be rejected (400), got ${JSON.stringify(statuses)}`,
      );
    }

    const final = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const finalBody = final.body as { amountPaidCents: number };
    if (finalBody.amountPaidCents !== eachCents) {
      throw new Error(
        `expected exactly one payment (${eachCents} cents) to have gone through, got amountPaidCents ${finalBody.amountPaidCents}`,
      );
    }
    if (finalBody.amountPaidCents > totalCents) {
      throw new Error(
        `invoice was overpaid: amountPaidCents ${finalBody.amountPaidCents} > totalCents ${totalCents}`,
      );
    }
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
