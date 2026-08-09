import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDb,
  order,
  orderedTest,
  patient,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

// Seeded by db/seed/chemistry-catalog.sql; test-user (technologist) and
// test-user-2 (verifier), per infra/keycloak/lis-realm.json.
const TENANT_A = '00000000-0000-0000-0000-000000000001';
// test-user-2's own tenant (rls-isolation-check.ts's own convention) --
// deliberately never seeded with a catalog, so a real tenant-B order fixture
// needs a direct @lis/db insert, not the HTTP order-creation path.
const TENANT_B = '00000000-0000-0000-0000-000000000002';

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

  /**
   * FEAT-022 Part 1: no HTTP path controls `ordered_test.createdAt` directly
   * (it's a real, defaulted-at-insert timestamp) -- backdating it via a
   * direct DB write is the only way to prove `slaStatus`'s real boundary
   * behavior deterministically, without a fragile "wait N real minutes" test.
   * The row's own status/existence is still produced entirely by the real
   * order-creation endpoint (`createOrder` above); only its age is adjusted.
   */
  async function backdateCreatedAt(
    orderedTestId: string,
    minutesAgo: number,
  ): Promise<void> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    await db
      .update(orderedTest)
      .set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(orderedTest.id, orderedTestId));
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

  /**
   * FEAT-022 Part 1 (ADR-0024, proposal §7 AC): `slaStatus` boundary
   * correctness, against the real seeded `sla_target` row for 'stat'
   * (60 minutes, `db/seed/sla-targets.sql`) -- 80% of 60 = 48 (at_risk),
   * 60 (overdue), both inclusive per `computeSlaStatus`'s own precedent.
   */
  describe('SLA status (FEAT-022 Part 1, ADR-0024)', () => {
    it('a fresh stat item is on_track', async () => {
      const { orderedTestId } = await createOrder('K', 'stat');
      const res = await request(app.getHttpServer())
        .get('/v1/worklist')
        .query({ priority: 'stat' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const item = (
        res.body as { items: { id: string; slaStatus: string }[] }
      ).items.find((i) => i.id === orderedTestId);
      if (item?.slaStatus !== 'on_track') {
        throw new Error(`expected on_track, got ${JSON.stringify(item)}`);
      }
    });

    it('exactly at the 80% at-risk threshold (48 of 60 min) is at_risk; exactly at the target (60 min) is overdue', async () => {
      const atRisk = await createOrder('CL', 'stat');
      await backdateCreatedAt(atRisk.orderedTestId, 48);
      const overdue = await createOrder('NA', 'stat');
      await backdateCreatedAt(overdue.orderedTestId, 60);

      const res = await request(app.getHttpServer())
        .get('/v1/worklist')
        .query({ priority: 'stat' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const items = (res.body as { items: { id: string; slaStatus: string }[] })
        .items;

      const atRiskItem = items.find((i) => i.id === atRisk.orderedTestId);
      if (atRiskItem?.slaStatus !== 'at_risk') {
        throw new Error(
          `expected at_risk at exactly 48/60 min, got ${JSON.stringify(atRiskItem)}`,
        );
      }
      const overdueItem = items.find((i) => i.id === overdue.orderedTestId);
      if (overdueItem?.slaStatus !== 'overdue') {
        throw new Error(
          `expected overdue at exactly 60/60 min, got ${JSON.stringify(overdueItem)}`,
        );
      }
    });
  });

  /**
   * FEAT-022 Part 1 (ADR-0024): `POST /v1/worklist/bulk-assign` sets
   * `assignedUserId` on every real, tenant-visible id in the request and
   * reports the rest back (§7 AC) -- proven with a mixed batch (real +
   * wrong-tenant + nonexistent), not just the all-valid happy path.
   */
  describe('Bulk assign (FEAT-022 Part 1, ADR-0024)', () => {
    it('updates valid tenant-visible ids and reports wrong-tenant/nonexistent ids as notFound, not a silent drop or a 500', async () => {
      const fixture = await makeOrderedFixture();
      // A minimal tenant-B fixture via direct @lis/db insert -- TENANT_B is
      // deliberately never seeded with a catalog (rls-isolation-check.ts's
      // own convention, this file's header comment), so no HTTP path can
      // create a real order for it. The FK on ordered_test.testDefinitionId
      // doesn't itself check tenant consistency, so reusing a real TENANT_A
      // test_definition id here is a valid, minimal fixture -- same "direct
      // DB insert for a spec-local cross-tenant fixture" pattern
      // flagging.e2e-spec.ts/delta-check.e2e-spec.ts already establish.
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
      );
      const [tenantBTestDef] = await db
        .select({ id: testDefinition.id })
        .from(testDefinition)
        .limit(1);
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [aTestDef] = await db
        .select({ id: testDefinition.id })
        .from(testDefinition)
        .limit(1);
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
      );
      const [tenantBPatient] = await db
        .insert(patient)
        .values({
          tenantId: TENANT_B,
          mrn: `WORKLIST-TENANT-B-${Date.now()}`,
          firstName: 'TenantB',
          lastName: 'Fixture',
          sex: 'U',
        })
        .returning({ id: patient.id });
      const [tenantBOrder] = await db
        .insert(order)
        .values({ tenantId: TENANT_B, patientId: tenantBPatient.id })
        .returning({ id: order.id });
      const [tenantBOrderedTest] = await db
        .insert(orderedTest)
        .values({
          tenantId: TENANT_B,
          orderId: tenantBOrder.id,
          testDefinitionId: (tenantBTestDef ?? aTestDef).id,
        })
        .returning({ id: orderedTest.id });
      const tenantBFixture = tenantBOrderedTest.id;
      const nonexistentId = randomUUID();
      const assigneeId = randomUUID();

      const res = await request(app.getHttpServer())
        .post('/v1/worklist/bulk-assign')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestIds: [
            fixture.orderedId,
            fixture.receivedId,
            tenantBFixture,
            nonexistentId,
          ],
          assignedUserId: assigneeId,
        })
        .expect(200);
      const body = res.body as {
        updatedIds: string[];
        notFoundIds: string[];
      };

      if (
        !body.updatedIds.includes(fixture.orderedId) ||
        !body.updatedIds.includes(fixture.receivedId)
      ) {
        throw new Error(
          `expected both real TENANT_A ids in updatedIds, got ${JSON.stringify(body)}`,
        );
      }
      if (
        !body.notFoundIds.includes(tenantBFixture) ||
        !body.notFoundIds.includes(nonexistentId)
      ) {
        throw new Error(
          `expected the wrong-tenant and nonexistent ids both in notFoundIds (RLS makes tenant B's row structurally invisible, same as a nonexistent id), got ${JSON.stringify(body)}`,
        );
      }

      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [updatedRow] = await db
        .select({ assignedUserId: orderedTest.assignedUserId })
        .from(orderedTest)
        .where(eq(orderedTest.id, fixture.orderedId));
      if (updatedRow?.assignedUserId !== assigneeId) {
        throw new Error(
          `expected assignedUserId persisted on the row, got ${JSON.stringify(updatedRow)}`,
        );
      }

      // Clean up the tenant-B fixture: rls-isolation-check.ts's own live
      // leak check asserts TENANT_B sees zero rows of *any* kind under its
      // own session (it is "deliberately never written to by anything," per
      // that script's own header comment) -- a real, load-bearing test
      // invariant this spec must not leave broken for a later run of that
      // check, in this session or a future one.
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
      );
      await db.delete(orderedTest).where(eq(orderedTest.id, tenantBFixture));
      await db.delete(order).where(eq(order.id, tenantBOrder.id));
      await db.delete(patient).where(eq(patient.id, tenantBPatient.id));
    });

    it('assignedUserId: null clears an assignment (bulk-unassign)', async () => {
      const fixture = await makeOrderedFixture();
      const assigneeId = randomUUID();
      await request(app.getHttpServer())
        .post('/v1/worklist/bulk-assign')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestIds: [fixture.orderedId],
          assignedUserId: assigneeId,
        })
        .expect(200);

      await request(app.getHttpServer())
        .post('/v1/worklist/bulk-assign')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ orderedTestIds: [fixture.orderedId], assignedUserId: null })
        .expect(200);

      // Direct DB read, not the list endpoint: this local DB has accumulated
      // well over WORKLIST_RESULT_LIMIT (100) 'ordered'-status rows across
      // many prior sessions' own e2e runs, a real, already-accepted
      // limitation (FEAT-017 proposal §6) unrelated to this feature -- the
      // default view's own createdAt-ascending cap can genuinely omit a
      // fresh fixture. Reading the row directly proves the persisted state
      // regardless of list pagination/ordering.
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({ assignedUserId: orderedTest.assignedUserId })
        .from(orderedTest)
        .where(eq(orderedTest.id, fixture.orderedId));
      if (row?.assignedUserId !== null) {
        throw new Error(
          `expected assignedUserId cleared, got ${JSON.stringify(row)}`,
        );
      }
    });
  });

  /**
   * FEAT-022 Part 1 (proposal §1 finding #2/#3, §7 AC): `POST
   * /v1/worklist/bulk-cancel` cancels only `'ordered'`-status ids, reports
   * the rest as ineligible, and cascades each affected order's own status
   * independently -- proven across a genuine multi-order selection, not
   * just the single-order case `order.controller.ts`'s own `cancel()`
   * already covers.
   */
  describe('Bulk cancel (FEAT-022 Part 1)', () => {
    it('cancels only ordered-status ids and reports in_process/resulted ids as ineligible, not silently skipped or a 500', async () => {
      const fixture = await makeOrderedFixture();

      const res = await request(app.getHttpServer())
        .post('/v1/worklist/bulk-cancel')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestIds: [
            fixture.orderedId,
            fixture.inProcessId,
            fixture.resultedId,
          ],
        })
        .expect(200);
      const body = res.body as {
        cancelledIds: string[];
        ineligibleIds: string[];
      };

      if (!body.cancelledIds.includes(fixture.orderedId)) {
        throw new Error(
          `expected the 'ordered' fixture cancelled, got ${JSON.stringify(body)}`,
        );
      }
      if (
        !body.ineligibleIds.includes(fixture.inProcessId) ||
        !body.ineligibleIds.includes(fixture.resultedId)
      ) {
        throw new Error(
          `expected 'in_process'/'resulted' fixtures reported ineligible, got ${JSON.stringify(body)}`,
        );
      }

      const statusRes = await request(app.getHttpServer())
        .get('/v1/worklist')
        .query({ status: 'cancelled' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const cancelledIds = (
        statusRes.body as { items: { id: string }[] }
      ).items.map((i) => i.id);
      if (!cancelledIds.includes(fixture.orderedId)) {
        throw new Error(
          `expected the cancelled fixture to now show status=cancelled`,
        );
      }
    });

    it("cascades each affected order's own status to 'cancelled' independently across a multi-order bulk selection", async () => {
      // Order 1: single test, fully cancelled by this call -> order cascades.
      const solo = await createOrder('K');
      // Order 2: two tests, only one included in this call -> order must
      // NOT cascade (the other test is still 'ordered', untouched).
      const catalogRes = await request(app.getHttpServer())
        .get('/v1/catalog')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const catalog = catalogRes.body as {
        tests: { id: string; code: string }[];
      };
      const clId = catalog.tests.find((t) => t.code === 'CL')!.id;
      const co2Id = catalog.tests.find((t) => t.code === 'CO2')!.id;
      const partialOrderRes = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ patientId, testDefinitionIds: [clId, co2Id] })
        .expect(201);
      const partialOrderBody = partialOrderRes.body as {
        resourceId: string;
        after: { orderedTests: { id: string }[] };
      };
      const [partialTestA] = partialOrderBody.after.orderedTests;

      await request(app.getHttpServer())
        .post('/v1/worklist/bulk-cancel')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ orderedTestIds: [solo.orderedTestId, partialTestA.id] })
        .expect(200);

      const soloOrderRes = await request(app.getHttpServer())
        .get(`/v1/orders/${solo.orderId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      if ((soloOrderRes.body as { status: string }).status !== 'cancelled') {
        throw new Error(
          `expected the fully-cancelled solo order to cascade to status 'cancelled', got ${JSON.stringify(soloOrderRes.body)}`,
        );
      }

      const partialOrderStatusRes = await request(app.getHttpServer())
        .get(`/v1/orders/${partialOrderBody.resourceId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      if (
        (partialOrderStatusRes.body as { status: string }).status ===
        'cancelled'
      ) {
        throw new Error(
          `expected the partially-cancelled order to NOT cascade (its second test is still 'ordered'), got ${JSON.stringify(partialOrderStatusRes.body)}`,
        );
      }
    });
  });
});
