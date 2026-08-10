import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, order, orderedTest, patient, testDefinition } from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getInteropToken } from './get-interop-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-036 (ADR-0034): proves the real pipeline behind
 * `POST /internal/interop/orders` -- correlation (MRN -> patient, test code
 * -> testDefinition, §10 Q5's MRN-only-exact-match decision), the write
 * itself going through `OrderCreationService` (same path
 * `POST /v1/orders` uses), and unmatched-input handling (422, "park, never
 * drop" -- mirrors `gateway-ingest.e2e-spec.ts`'s own precedent for the
 * analyzer path).
 */
describe('Interop order ingest (e2e)', () => {
  let app: INestApplication<App>;
  let interopToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseTestDefinitionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    interopToken = await getInteropToken();

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

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
    if (!testDefRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseTestDefinitionId = testDefRow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createPatient(): Promise<{ mrn: string; id: string }> {
    const mrn = `INTEROP-E2E-${Date.now()}-${randomUUID()}`;
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn,
        firstName: 'Interop',
        lastName: 'Test',
        sex: 'U',
      })
      .returning();
    return { mrn, id: pat.id };
  }

  it('returns 422 "unmatched" for an unregistered MRN (KB-30/KB-29: park, never drop)', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/interop/orders')
      .set('Authorization', `Bearer ${interopToken}`)
      .send({
        mrn: 'DOES-NOT-EXIST',
        testCode: GLUCOSE_CODE,
        rawMessage: 'MSH|...',
      })
      .expect(422);
    expect((res.body as { reason: string }).reason).toBe('unknown_mrn');
  });

  it('returns 422 "unmatched" for an unknown test code', async () => {
    const { mrn } = await createPatient();
    const res = await request(app.getHttpServer())
      .post('/internal/interop/orders')
      .set('Authorization', `Bearer ${interopToken}`)
      .send({ mrn, testCode: 'NEVER-A-REAL-CODE', rawMessage: 'MSH|...' })
      .expect(422);
    expect((res.body as { reason: string }).reason).toBe('unknown_test_code');
  });

  it('correlates by MRN/test code and writes a real order through OrderCreationService — 202', async () => {
    const { mrn, id: patientId } = await createPatient();

    const res = await request(app.getHttpServer())
      .post('/internal/interop/orders')
      .set('Authorization', `Bearer ${interopToken}`)
      .send({ mrn, testCode: GLUCOSE_CODE, rawMessage: 'MSH|...' })
      .expect(202);

    const body = res.body as { orderId: string; orderedTestIds: string[] };
    expect(body.orderedTestIds).toHaveLength(1);

    const [orderRow] = await db
      .select()
      .from(order)
      .where(eq(order.id, body.orderId))
      .limit(1);
    expect(orderRow).toBeDefined();
    expect(orderRow.patientId).toBe(patientId);
    expect(orderRow.priority).toBe('routine');

    const [otRow] = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.id, body.orderedTestIds[0]))
      .limit(1);
    expect(otRow.testDefinitionId).toBe(glucoseTestDefinitionId);
    expect(otRow.status).toBe('ordered');
  });

  it('honors an explicit STAT priority', async () => {
    const { mrn } = await createPatient();

    const res = await request(app.getHttpServer())
      .post('/internal/interop/orders')
      .set('Authorization', `Bearer ${interopToken}`)
      .send({
        mrn,
        testCode: GLUCOSE_CODE,
        priority: 'stat',
        rawMessage: 'MSH|...',
      })
      .expect(202);

    const body = res.body as { orderId: string };
    const [orderRow] = await db
      .select({ priority: order.priority })
      .from(order)
      .where(eq(order.id, body.orderId))
      .limit(1);
    expect(orderRow.priority).toBe('stat');
  });
});
