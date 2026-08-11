import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDb,
  cultureRead,
  orderedTest,
  outboxEvent,
  workflowDefinition,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { CultureReadDueDetectorService } from '../src/culture-read/culture-read-due-detector.service';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const CULT_CODE = 'CULT';
const ORGID_CODE = 'ORGID';

/**
 * FEAT-052 (docs/plans/feat-052-culture-workflow-reflex-cascade.md,
 * ADR-0046). Proves the whole cascade end-to-end against a real published
 * rule and a real `OutboxRelayService.tick()` delivery, mirroring
 * `reflex.e2e-spec.ts`/`sla-breach.e2e-spec.ts`'s own real-pipeline style:
 * schedule -> worklist -> detector -> human-recorded growth -> reflex
 * organism-ID panel, correctly lineaged via `AddReflexTest`, unmodified.
 */
describe('Culture workflow & reflex cascade (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let technologistToken: string;
  let db: ReturnType<typeof createDb>;
  let cultTestDefId: string;
  let orgidTestDefId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    [qaToken, verifierToken, technologistToken] = await Promise.all([
      getKeycloakToken('test-user-5', 'test-password-5'),
      getKeycloakToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user', 'test-password'),
    ]);

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const testDefRes = await db.execute(
      sql`SELECT code, id FROM test_definition
          WHERE tenant_id = ${TENANT_A} AND code IN (${CULT_CODE}, ${ORGID_CODE})`,
    );
    const rows = testDefRes.rows as { code: string; id: string }[];
    const cult = rows.find((r) => r.code === CULT_CODE);
    const orgid = rows.find((r) => r.code === ORGID_CODE);
    if (!cult || !orgid) {
      throw new Error(
        'microbiology-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    cultTestDefId = cult.id;
    orgidTestDefId = orgid.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function archiveAnyPublished(): Promise<void> {
    await db
      .update(workflowDefinition)
      .set({ status: 'archived' })
      .where(
        and(
          eq(workflowDefinition.tenantId, TENANT_A),
          eq(workflowDefinition.status, 'published'),
        ),
      );
  }

  async function publishGrowthReflexRule(): Promise<void> {
    await archiveAnyPublished();
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: `culture-growth-reflex-${randomUUID()}`,
            on: 'CultureGrowthDetected',
            when: { field: 'result', op: 'eq', value: 'growth' },
            do: { command: 'AddReflexTest', testCode: ORGID_CODE },
          },
        ],
      })
      .expect(201);
    const { id } = createRes.body as { id: string };
    await request(app.getHttpServer())
      .post(`/v1/workflow-definitions/${id}/publish`)
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
  }

  /** Real patient/order/specimen via the real API, for the CULT panel. */
  async function createCultureOrderedTest(): Promise<string> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        firstName: 'Culture',
        lastName: 'Test',
        sex: 'U',
        birthDate: '1980-01-01',
      })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        patientId,
        testDefinitionIds: [cultTestDefId],
        priority: 'routine',
      })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderedTestId = orderBody.after.orderedTests[0].id;

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'swab' })
      .expect(201);

    return orderedTestId;
  }

  async function scheduleCultureRead(
    orderedTestId: string,
    scheduledAt: Date,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/culture-reads`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ scheduledAt: scheduledAt.toISOString() })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  it('rejects a non-enter_result session on schedule/record (403)', async () => {
    const orderedTestId = await createCultureOrderedTest();
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/culture-reads`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({})
      .expect(403);
  });

  it('schedules a read, surfaces it on the due worklist once its time has passed, and the detector marks it audited/notified exactly once', async () => {
    const orderedTestId = await createCultureOrderedTest();
    const pastScheduledAt = new Date(Date.now() - 5 * 60_000); // already due
    const cultureReadId = await scheduleCultureRead(
      orderedTestId,
      pastScheduledAt,
    );

    const worklistRes = await request(app.getHttpServer())
      .get('/v1/culture-reads')
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(200);
    const worklist = worklistRes.body as { id: string }[];
    expect(worklist.some((row) => row.id === cultureReadId)).toBe(true);

    await app.get(CultureReadDueDetectorService).detectDue();
    await app.get(CultureReadDueDetectorService).detectDue(); // idempotency: a second tick must not double-fire

    const [row] = await db
      .select()
      .from(cultureRead)
      .where(eq(cultureRead.id, cultureReadId));
    expect(row.dueNotifiedAt).not.toBeNull();

    const dueEvents = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'CultureReadDue'),
          sql`${outboxEvent.payload}->>'cultureReadId' = ${cultureReadId}`,
        ),
      );
    expect(dueEvents).toHaveLength(1); // exactly one, no duplicate from the second tick
  });

  it('a second schedule call while one is already open is rejected (400), not silently reused', async () => {
    const orderedTestId = await createCultureOrderedTest();
    await scheduleCultureRead(orderedTestId, new Date());
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/culture-reads`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({})
      .expect(400);
  });

  it("recording 'no_growth' completes the read and creates no reflex, no CultureGrowthDetected event", async () => {
    const orderedTestId = await createCultureOrderedTest();
    const cultureReadId = await scheduleCultureRead(orderedTestId, new Date());

    await request(app.getHttpServer())
      .post(`/v1/culture-reads/${cultureReadId}/record`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ result: 'no_growth' })
      .expect(200);

    const growthEvents = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'CultureGrowthDetected'),
          sql`${outboxEvent.payload}->>'orderedTestId' = ${orderedTestId}`,
        ),
      );
    expect(growthEvents).toHaveLength(0);

    // v1 scope: a completed read is terminal -- re-recording is rejected.
    await request(app.getHttpServer())
      .post(`/v1/culture-reads/${cultureReadId}/record`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ result: 'growth' })
      .expect(400);
  });

  it("recording 'growth' fires the published rule and creates a correctly-lineaged organism-ID ordered_test via AddReflexTest, unmodified", async () => {
    await publishGrowthReflexRule();
    const orderedTestId = await createCultureOrderedTest();
    const cultureReadId = await scheduleCultureRead(orderedTestId, new Date());

    await request(app.getHttpServer())
      .post(`/v1/culture-reads/${cultureReadId}/record`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ result: 'growth' })
      .expect(200);

    await app.get(OutboxRelayService).tick();

    const reflexRows = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(reflexRows).toHaveLength(1);
    expect(reflexRows[0].testDefinitionId).toBe(orgidTestDefId);
    expect(reflexRows[0].status).toBe('received');

    // Redelivery is idempotent -- AddReflexTest's own existing guarantee,
    // exercised here through this feature's own real event, not assumed.
    await db
      .update(outboxEvent)
      .set({ status: 'pending' })
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'CultureGrowthDetected'),
          sql`${outboxEvent.payload}->>'orderedTestId' = ${orderedTestId}`,
        ),
      );
    await app.get(OutboxRelayService).tick();
    const afterRedelivery = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(afterRedelivery).toHaveLength(1);
  });

  it("RLS: another tenant's own session shows none of this fixture's culture reads", async () => {
    const orderedTestId = await createCultureOrderedTest();
    await scheduleCultureRead(orderedTestId, new Date());

    // test-user-2 = verifier, TENANT_B (catalog-admin.e2e-spec.ts's own
    // precedent) -- has 'enter_result', a real capability match, not just a
    // different tenant.
    const otherTenantToken = await getKeycloakToken(
      'test-user-2',
      'test-password-2',
    );
    const res = await request(app.getHttpServer())
      .get('/v1/culture-reads')
      .set('Authorization', `Bearer ${otherTenantToken}`)
      .expect(200);
    const body = res.body as { orderedTestId: string }[];
    expect(body.some((row) => row.orderedTestId === orderedTestId)).toBe(false);
  });
});
