import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, testAnalyte, testDefinition } from '@lis/db';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

// Seeded by db/seed/chemistry-catalog.sql; test-user (technologist) and
// test-user-2 (verifier), per infra/keycloak/lis-realm.json.
const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * TASK-061 (FEAT-017 proposal, docs/plans/feat-017-minimal-worklist.md):
 * proves GET /v1/worklist against the real HTTP stack, real Keycloak, real
 * Postgres, matching order.e2e-spec.ts's/observation.e2e-spec.ts's own
 * standard. Every ordered_test status fixture is produced by driving through
 * the real order/reception/result-entry endpoints (create/receive/draft/
 * finalize/cancel), not by a direct DB status update -- proving this
 * endpoint against this app's own real state-transition code, matching
 * TASK-052's precedent.
 */
describe('Worklist API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let patientId: string;

  async function createOrder(
    testCode: string,
    priority?: 'routine' | 'stat',
  ): Promise<{ orderId: string; orderedTestId: string }> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    const found = catalog.tests.find((t) => t.code === testCode);
    if (!found) {
      throw new Error(`expected catalog fixture '${testCode}' in /v1/catalog`);
    }

    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        patientId,
        testDefinitionIds: [found.id],
        ...(priority ? { priority } : {}),
      })
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

  async function receive(orderId: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'serum' })
      .expect(201);
  }

  async function analyteIdForTestCode(testCode: string): Promise<string> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({ analyteId: testAnalyte.analyteId })
      .from(testAnalyte)
      .innerJoin(
        testDefinition,
        sql`${testAnalyte.testDefinitionId} = ${testDefinition.id}`,
      )
      .where(sql`${testDefinition.code} = ${testCode}`)
      .limit(1);
    if (!row) throw new Error(`no analyte found for test code '${testCode}'`);
    return row.analyteId;
  }

  // Single-analyte quantity tests from the seeded CMP panel (db/seed/
  // chemistry-catalog.sql) -- one per target status, so each fixture order
  // reaches exactly the status its own test proves, with no cross-status
  // interference from a multi-analyte panel's own partial-completion states.
  async function makeOrderedFixture(): Promise<{
    orderedId: string; // stays 'ordered' -- no action taken
    receivedId: string; // 'received' -- specimen received, no draft
    inProcessId: string; // 'in_process' -- drafted, not finalized
    resultedId: string; // 'resulted' -- finalized
    cancelledId: string; // 'cancelled'
    statOrderId: string; // 'ordered', priority 'stat'
  }> {
    const ordered = await createOrder('K');
    const received = await createOrder('CL');
    await receive(received.orderId);
    const inProcess = await createOrder('NA');
    await receive(inProcess.orderId);
    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${inProcess.orderedTestId}/results/${await analyteIdForTestCode('NA')}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 140 })
      .expect(200);
    const resulted = await createOrder('BUN');
    await receive(resulted.orderId);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${resulted.orderedTestId}/results/${await analyteIdForTestCode('BUN')}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 15 })
      .expect(200);
    const cancelled = await createOrder('CA');
    await request(app.getHttpServer())
      .post(`/v1/orders/${cancelled.orderId}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const stat = await createOrder('CO2', 'stat');

    return {
      orderedId: ordered.orderedTestId,
      receivedId: received.orderedTestId,
      inProcessId: inProcess.orderedTestId,
      resultedId: resulted.orderedTestId,
      cancelledId: cancelled.orderedTestId,
      statOrderId: stat.orderedTestId,
    };
  }

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

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Worklist', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns items scoped to the authenticated tenant only, with correct stage counts across a real multi-status fixture', async () => {
    const fixture = await makeOrderedFixture();

    const res = await request(app.getHttpServer())
      .get('/v1/worklist')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as {
      counts: { pending: number; inProgress: number; verified: number };
      items: { id: string; status: string }[];
    };

    if (body.counts.pending < 2) {
      throw new Error(
        `expected pending count >= 2 ('ordered' + 'received' fixtures), got ${JSON.stringify(body.counts)}`,
      );
    }
    if (body.counts.inProgress < 1) {
      throw new Error(
        `expected inProgress count >= 1, got ${JSON.stringify(body.counts)}`,
      );
    }
    if (body.counts.verified < 1) {
      throw new Error(
        `expected verified count >= 1, got ${JSON.stringify(body.counts)}`,
      );
    }

    const itemIds = body.items.map((i) => i.id);
    if (!itemIds.includes(fixture.orderedId)) {
      throw new Error(
        `expected the 'ordered' fixture in the default item list`,
      );
    }
    if (!itemIds.includes(fixture.receivedId)) {
      throw new Error(
        `expected the 'received' fixture in the default item list`,
      );
    }
    if (!itemIds.includes(fixture.inProcessId)) {
      throw new Error(
        `expected the 'in_process' fixture in the default item list`,
      );
    }
    if (!itemIds.includes(fixture.resultedId)) {
      throw new Error(
        `expected the 'resulted' fixture in the default item list`,
      );
    }
    if (itemIds.includes(fixture.cancelledId)) {
      throw new Error(
        `expected 'cancelled' to be excluded from the default item list (§10 Q3)`,
      );
    }

    const inProcessItem = body.items.find((i) => i.id === fixture.inProcessId);
    if (inProcessItem?.status !== 'in_process') {
      throw new Error(
        `expected status 'in_process', got ${JSON.stringify(inProcessItem)}`,
      );
    }
    const resultedItem = body.items.find((i) => i.id === fixture.resultedId);
    if (resultedItem?.status !== 'resulted') {
      throw new Error(
        `expected status 'resulted', got ${JSON.stringify(resultedItem)}`,
      );
    }
  });

  it('filters by stage bucket, matching the counts mapping (pending=ordered+received, in_progress, verified=resulted)', async () => {
    const fixture = await makeOrderedFixture();

    const pending = await request(app.getHttpServer())
      .get('/v1/worklist')
      .query({ stage: 'pending' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const pendingIds = (
      pending.body as { items: { id: string; status: string }[] }
    ).items;
    if (!pendingIds.some((i) => i.id === fixture.orderedId)) {
      throw new Error(`expected 'ordered' fixture in stage=pending`);
    }
    if (!pendingIds.some((i) => i.id === fixture.receivedId)) {
      throw new Error(`expected 'received' fixture in stage=pending`);
    }
    if (pendingIds.some((i) => i.id === fixture.inProcessId)) {
      throw new Error(
        `expected 'in_process' fixture excluded from stage=pending`,
      );
    }
    if (
      !pendingIds.every(
        (i) => i.status === 'ordered' || i.status === 'received',
      )
    ) {
      throw new Error(
        `expected only 'ordered'/'received' rows in stage=pending, got ${JSON.stringify(pendingIds)}`,
      );
    }

    const inProgress = await request(app.getHttpServer())
      .get('/v1/worklist')
      .query({ stage: 'in_progress' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const inProgressIds = (
      inProgress.body as { items: { id: string }[] }
    ).items.map((i) => i.id);
    if (!inProgressIds.includes(fixture.inProcessId)) {
      throw new Error(`expected 'in_process' fixture in stage=in_progress`);
    }
    if (inProgressIds.includes(fixture.resultedId)) {
      throw new Error(
        `expected 'resulted' fixture excluded from stage=in_progress`,
      );
    }

    const verified = await request(app.getHttpServer())
      .get('/v1/worklist')
      .query({ stage: 'verified' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const verifiedIds = (
      verified.body as { items: { id: string }[] }
    ).items.map((i) => i.id);
    if (!verifiedIds.includes(fixture.resultedId)) {
      throw new Error(`expected 'resulted' fixture in stage=verified`);
    }
  });

  it('an explicit status filter can surface cancelled/rejected rows the default view excludes (§10 Q3)', async () => {
    const fixture = await makeOrderedFixture();

    const defaultView = await request(app.getHttpServer())
      .get('/v1/worklist')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const defaultIds = (
      defaultView.body as { items: { id: string }[] }
    ).items.map((i) => i.id);
    if (defaultIds.includes(fixture.cancelledId)) {
      throw new Error(`expected the default view to exclude 'cancelled'`);
    }

    const cancelledView = await request(app.getHttpServer())
      .get('/v1/worklist')
      .query({ status: 'cancelled' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const cancelledIds = (
      cancelledView.body as { items: { id: string; status: string }[] }
    ).items;
    if (!cancelledIds.some((i) => i.id === fixture.cancelledId)) {
      throw new Error(
        `expected status=cancelled to surface the cancelled fixture`,
      );
    }
    if (!cancelledIds.every((i) => i.status === 'cancelled')) {
      throw new Error(
        `expected status=cancelled to return only cancelled rows`,
      );
    }
  });

  it('filters by priority and by createdAt date range, and every item carries a non-negative computed TAT (ageMinutes)', async () => {
    const fixture = await makeOrderedFixture();

    const byPriority = await request(app.getHttpServer())
      .get('/v1/worklist')
      .query({ priority: 'stat' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byPriorityBody = byPriority.body as {
      items: { id: string; priority: string; ageMinutes: number }[];
    };
    if (!byPriorityBody.items.some((i) => i.id === fixture.statOrderId)) {
      throw new Error(`expected the stat fixture in priority=stat results`);
    }
    if (!byPriorityBody.items.every((i) => i.priority === 'stat')) {
      throw new Error(
        `expected only 'stat' rows, got ${JSON.stringify(byPriorityBody.items)}`,
      );
    }
    if (
      !byPriorityBody.items.every(
        (i) => Number.isInteger(i.ageMinutes) && i.ageMinutes >= 0,
      )
    ) {
      throw new Error(
        `expected every item to carry a non-negative integer ageMinutes, got ${JSON.stringify(byPriorityBody.items)}`,
      );
    }

    const future = new Date(Date.now() + 60_000).toISOString();
    const byDateRange = await request(app.getHttpServer())
      .get('/v1/worklist')
      .query({ createdFrom: future })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byDateRangeItems = (byDateRange.body as { items: unknown[] }).items;
    if (byDateRangeItems.length !== 0) {
      throw new Error(
        `expected no items created after a future timestamp, got ${JSON.stringify(byDateRangeItems)}`,
      );
    }
  });

  it("excludes another tenant's ordered_test rows entirely (RLS at the API layer)", async () => {
    const fixture = await makeOrderedFixture();

    const asTenantB = await request(app.getHttpServer())
      .get('/v1/worklist')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const tenantBIds = (
      asTenantB.body as { items: { id: string }[] }
    ).items.map((i) => i.id);
    if (tenantBIds.includes(fixture.resultedId)) {
      throw new Error(
        `expected tenant B's worklist to never see tenant A's ordered_test rows`,
      );
    }
  });
});
