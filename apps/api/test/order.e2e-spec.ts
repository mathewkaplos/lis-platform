import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDb,
  orderedTest,
  panel,
  panelTest,
  testDefinition,
} from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

// Seeded by db/seed/chemistry-catalog.sql; also the tenant test-user
// (technologist)/test-user-3 carry, per infra/keycloak/lis-realm.json.
const TENANT_A = '00000000-0000-0000-0000-000000000001';
// test-user-2 (verifier)'s tenant. No catalog data is seeded for it -- used
// below purely to construct a genuinely cross-tenant test_definition fixture.
const TENANT_B = '00000000-0000-0000-0000-000000000002';

/**
 * TASK-042 (FEAT-012): proves the second real domain-resource endpoint,
 * including this repo's first action sub-resource
 * (`POST /v1/orders/:id/cancel` -- see order.controller.ts's own header
 * comment for why this deviates from KB-08's literal colon-suffix example),
 * through the live API -- real Keycloak tokens, real Postgres, matching
 * patient.e2e-spec.ts's own standard.
 *
 * Fixture test/panel ids come from db/seed/chemistry-catalog.sql's real CMP
 * panel (14 member tests) rather than inserting a bespoke fixture -- it's
 * already there, tenant-scoped to TENANT_A, and exercising panel expansion
 * against a genuinely multi-test panel is a better proof than a synthetic
 * two-test one.
 */
describe('Order API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let patientId: string;
  let glucoseId: string;
  let bunId: string;
  let cmpPanelId: string;
  let cmpMemberCount: number;

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

    // Direct DB access purely to read/insert fixture rows -- connects as the
    // migrations-only postgres role via DATABASE_URL (bypasses RLS, same as
    // db-reset.sh's own seed step), never used by app code under test.
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
    const [cmp] = await db
      .select({ id: panel.id })
      .from(panel)
      .where(and(eq(panel.tenantId, TENANT_A), eq(panel.code, 'CMP')));
    if (!glucose || !bun || !cmp) {
      throw new Error(
        'expected db/seed/chemistry-catalog.sql fixtures (GLU, BUN, CMP) to exist under TENANT_A',
      );
    }
    const cmpMembers = await db
      .select({ id: panelTest.id })
      .from(panelTest)
      .where(eq(panelTest.panelId, cmp.id));
    glucoseId = glucose.id;
    bunId = bun.id;
    cmpPanelId = cmp.id;
    cmpMemberCount = cmpMembers.length;

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Order', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function auditCount(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  it('creates an order from testDefinitionIds: one ordered_test row per test, status "ordered", priority defaults to "routine", audited', async () => {
    const before = await auditCount(tokenA);
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId, bunId] })
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: {
        status: string;
        priority: string;
        orderedTests: { testDefinitionId: string; status: string }[];
      };
    };
    if (body.after.status !== 'ordered' || body.after.priority !== 'routine') {
      throw new Error(`unexpected order state: ${JSON.stringify(res.body)}`);
    }
    if (body.after.orderedTests.length !== 2) {
      throw new Error(
        `expected 2 ordered_test rows, got ${JSON.stringify(res.body)}`,
      );
    }
    if (!body.after.orderedTests.every((t) => t.status === 'ordered')) {
      throw new Error(
        `expected every ordered_test row to start 'ordered', got ${JSON.stringify(res.body)}`,
      );
    }
    const after = await auditCount(tokenA);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it('accepts an explicit priority', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId], priority: 'stat' })
      .expect(201);
    const body = res.body as { after: { priority: string } };
    if (body.after.priority !== 'stat') {
      throw new Error(
        `expected priority 'stat', got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it('expands a panel into its member ordered_test rows (the lipid-panel-equivalent AC)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, panelIds: [cmpPanelId] })
      .expect(201);
    const body = res.body as { after: { orderedTests: unknown[] } };
    if (body.after.orderedTests.length !== cmpMemberCount) {
      throw new Error(
        `expected ${cmpMemberCount} ordered_test rows from the CMP panel, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it('dedupes a test present both directly and via a panel into exactly one ordered_test row', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId,
        testDefinitionIds: [glucoseId],
        panelIds: [cmpPanelId],
      })
      .expect(201);
    const body = res.body as {
      after: { orderedTests: { testDefinitionId: string }[] };
    };
    if (body.after.orderedTests.length !== cmpMemberCount) {
      throw new Error(
        `expected dedupe to still produce ${cmpMemberCount} rows (glucose counted once), got ${JSON.stringify(res.body)}`,
      );
    }
    const glucoseRows = body.after.orderedTests.filter(
      (t) => t.testDefinitionId === glucoseId,
    );
    if (glucoseRows.length !== 1) {
      throw new Error(
        `expected exactly one glucose ordered_test row, got ${glucoseRows.length}`,
      );
    }
  });

  it('rejects an unknown/cross-tenant test id with 400, writing nothing', async () => {
    const db = createDb();
    const [crossTenantTest] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_B,
        code: `X-${randomUUID()}`,
        displayName: 'Cross-tenant fixture',
      })
      .returning();

    const before = await auditCount(tokenA);
    await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [crossTenantTest.id] })
      .expect(400);
    const after = await auditCount(tokenA);
    if (after !== before) {
      throw new Error(
        `expected no audit_event row on a rejected create, before=${before} after=${after}`,
      );
    }
  });

  it('rejects an unknown patientId with 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: randomUUID(), testDefinitionIds: [glucoseId] })
      .expect(400);
  });

  it('rejects a create with neither testDefinitionIds nor panelIds populated, and a missing patientId', async () => {
    await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ testDefinitionIds: [glucoseId] })
      .expect(400);
  });

  it('cancels an order whose tests are all still "ordered": cascades to cancelled, order status becomes cancelled, audited', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId, bunId] })
      .expect(201);
    const orderId = (created.body as { resourceId: string }).resourceId;

    const before = await auditCount(tokenA);
    const res = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as {
      after: { status: string; orderedTests: { status: string }[] };
    };
    if (body.after.status !== 'cancelled') {
      throw new Error(
        `expected order status 'cancelled', got ${JSON.stringify(res.body)}`,
      );
    }
    if (!body.after.orderedTests.every((t) => t.status === 'cancelled')) {
      throw new Error(
        `expected every ordered_test cancelled, got ${JSON.stringify(res.body)}`,
      );
    }
    const after = await auditCount(tokenA);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it('partial cancel: a test already past "ordered" is left untouched, order status stays "ordered"', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId, bunId] })
      .expect(201);
    const createdBody = created.body as {
      resourceId: string;
      after: { orderedTests: { id: string; testDefinitionId: string }[] };
    };
    const orderId = createdBody.resourceId;
    const glucoseOrderedTestId = createdBody.after.orderedTests.find(
      (t) => t.testDefinitionId === glucoseId,
    )?.id;
    if (!glucoseOrderedTestId) {
      throw new Error(
        'expected a glucose ordered_test row in the fixture order',
      );
    }

    // Simulates FEAT-013's future reception step directly -- no API exists
    // yet to transition an ordered_test to 'collected'.
    const db = createDb();
    await db
      .update(orderedTest)
      .set({ status: 'collected' })
      .where(eq(orderedTest.id, glucoseOrderedTestId));

    const res = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as {
      after: {
        status: string;
        orderedTests: { testDefinitionId: string; status: string }[];
      };
    };
    if (body.after.status !== 'ordered') {
      throw new Error(
        `expected order to stay 'ordered' (partial cancel), got ${JSON.stringify(res.body)}`,
      );
    }
    const glucoseAfter = body.after.orderedTests.find(
      (t) => t.testDefinitionId === glucoseId,
    );
    const bunAfter = body.after.orderedTests.find(
      (t) => t.testDefinitionId === bunId,
    );
    if (glucoseAfter?.status !== 'collected') {
      throw new Error(
        `expected the already-collected test untouched, got ${JSON.stringify(res.body)}`,
      );
    }
    if (bunAfter?.status !== 'cancelled') {
      throw new Error(
        `expected the still-ordered test cancelled, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it('returns 409 cancelling an order with zero eligible tests (already fully cancelled)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId] })
      .expect(201);
    const orderId = (created.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(409);
  });

  it('returns 404 (not 500) cancelling a nonexistent order', async () => {
    await request(app.getHttpServer())
      .post(`/v1/orders/${randomUUID()}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it('GET /v1/orders filters by status, priority, and createdAt date range', async () => {
    const statCreated = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId], priority: 'stat' })
      .expect(201);
    const statOrderId = (statCreated.body as { resourceId: string }).resourceId;

    const byPriority = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ priority: 'stat' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byPriorityIds = (byPriority.body as { id: string }[]).map(
      (o) => o.id,
    );
    if (!byPriorityIds.includes(statOrderId)) {
      throw new Error(
        `expected the stat order in priority=stat results, got ${JSON.stringify(byPriority.body)}`,
      );
    }

    const byStatus = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ status: 'ordered', patientId })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byStatusResults = byStatus.body as { status: string }[];
    if (
      byStatusResults.length === 0 ||
      !byStatusResults.every((o) => o.status === 'ordered')
    ) {
      throw new Error(
        `expected only 'ordered' orders, got ${JSON.stringify(byStatus.body)}`,
      );
    }

    const future = new Date(Date.now() + 60_000).toISOString();
    const byDateRange = await request(app.getHttpServer())
      .get('/v1/orders')
      .query({ patientId, createdFrom: future })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    if ((byDateRange.body as unknown[]).length !== 0) {
      throw new Error(
        `expected no orders created after a future timestamp, got ${JSON.stringify(byDateRange.body)}`,
      );
    }
  });

  it('returns 404 for an order created under a different tenant (RLS at the API layer, not just the DB layer)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId] })
      .expect(201);
    const orderId = (created.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('returns 404 (not 500) for a well-formed but nonexistent order id', async () => {
    await request(app.getHttpServer())
      .get(`/v1/orders/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });
});
