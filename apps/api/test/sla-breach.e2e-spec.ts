import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, orderedTest, slaBreach, workflowDefinition } from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { SlaBreachDetectorService } from '../src/sla/sla-breach-detector.service';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md).
 * `sla_target` seeded per tenant A: routine 1440min, stat 60min
 * (db/seed/sla-targets.sql) -- fixtures below backdate `ordered_test
 * .createdAt` past the stat target (90min > 60min) or comfortably within
 * the routine target (5min < 1440min), same real-elapsed-time technique
 * `operational-reports.e2e-spec.ts` (FEAT-034) already established
 * (backdating `ordered_test.createdAt`, never `observation`, which is
 * append-only-protected).
 */
describe('SLA breaches (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let technologistToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseAnalyteId: string;
  let glucoseTestDefId: string;

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
      sql`SELECT td.id AS test_def_id, ta.analyte_id AS analyte_id
          FROM test_definition td
          JOIN test_analyte ta ON ta.test_definition_id = td.id
          WHERE td.tenant_id = ${TENANT_A} AND td.code = ${GLUCOSE_CODE}
          LIMIT 1`,
    );
    const row = testDefRes.rows[0] as
      { test_def_id: string; analyte_id: string } | undefined;
    if (!row) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseTestDefId = row.test_def_id;
    glucoseAnalyteId = row.analyte_id;
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

  async function publishRule(command: string): Promise<void> {
    await archiveAnyPublished();
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: `sla-${randomUUID()}`,
            on: 'SlaBreached',
            when: { field: 'priority', op: 'eq', value: 'stat' },
            do: { command },
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

  /** Creates a real order+ordered_test via the real API, then backdates
   * `ordered_test.createdAt` by `backdateMinutes` -- never touches
   * `observation` directly (append-only, Constitution Law #2). */
  async function createBackdatedOrderedTest(
    priority: 'routine' | 'stat',
    backdateMinutes: number,
  ): Promise<string> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        firstName: 'Sla',
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
        testDefinitionIds: [glucoseTestDefId],
        priority,
      })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderedTestId = orderBody.after.orderedTests[0].id;

    // finalize() requires a fulfilled specimen -- same shape FEAT-034's own
    // createBackdatedVerifiedResult already established.
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'serum' })
      .expect(201);

    await db
      .update(orderedTest)
      .set({ createdAt: new Date(Date.now() - backdateMinutes * 60_000) })
      .where(eq(orderedTest.id, orderedTestId));

    return orderedTestId;
  }

  async function verifyGlucose(orderedTestId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 90 })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  }

  it('rejects a non-qa session on GET /v1/sla-breaches (403)', async () => {
    await request(app.getHttpServer())
      .get('/v1/sla-breaches')
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(403);
  });

  it('does not breach a panel still comfortably within its target', async () => {
    const orderedTestId = await createBackdatedOrderedTest('routine', 5);

    await app.get(SlaBreachDetectorService).detectOverdue();

    const [breach] = await db
      .select()
      .from(slaBreach)
      .where(eq(slaBreach.orderedTestId, orderedTestId))
      .limit(1);
    expect(breach).toBeUndefined();
  });

  it('detects a real overdue STAT panel, fires a published rule, and escalates via NotifySlaBreach', async () => {
    await publishRule('NotifySlaBreach');
    const orderedTestId = await createBackdatedOrderedTest('stat', 90); // exceeds the seeded 60-minute stat target

    await app.get(SlaBreachDetectorService).detectOverdue();

    const [detected] = await db
      .select()
      .from(slaBreach)
      .where(eq(slaBreach.orderedTestId, orderedTestId))
      .limit(1);
    expect(detected).toMatchObject({
      status: 'pending',
      priority: 'stat',
      targetMinutes: 60,
    });

    await app.get(OutboxRelayService).tick();

    const [escalated] = await db
      .select()
      .from(slaBreach)
      .where(eq(slaBreach.orderedTestId, orderedTestId))
      .limit(1);
    expect(escalated).toMatchObject({
      status: 'escalated',
      escalationLevel: 1,
    });

    const listRes = await request(app.getHttpServer())
      .get('/v1/sla-breaches')
      .set('Authorization', `Bearer ${qaToken}`)
      .query({ status: 'escalated' })
      .expect(200);
    const body = listRes.body as { orderedTestId: string }[];
    expect(body.some((row) => row.orderedTestId === orderedTestId)).toBe(true);
  });

  it('resolves instead of escalating when the panel verifies between detection and rule dispatch', async () => {
    await publishRule('NotifySlaBreach');
    const orderedTestId = await createBackdatedOrderedTest('stat', 90);

    await app.get(SlaBreachDetectorService).detectOverdue();
    await verifyGlucose(orderedTestId); // verifies in the gap, before the rule ever dispatches
    await app.get(OutboxRelayService).tick();

    const [resolved] = await db
      .select()
      .from(slaBreach)
      .where(eq(slaBreach.orderedTestId, orderedTestId))
      .limit(1);
    expect(resolved).toMatchObject({ status: 'resolved' });
  });

  it('a second detector run is idempotent -- no duplicate sla_breach row for the same ordered_test', async () => {
    const orderedTestId = await createBackdatedOrderedTest('stat', 90);

    await app.get(SlaBreachDetectorService).detectOverdue();
    await app.get(SlaBreachDetectorService).detectOverdue();

    const rows = await db
      .select()
      .from(slaBreach)
      .where(eq(slaBreach.orderedTestId, orderedTestId));
    expect(rows).toHaveLength(1);
  });

  it("RLS: another tenant's own qa session shows none of this fixture's breaches", async () => {
    const otherTenantQaToken = await getKeycloakToken(
      'test-user-6',
      'test-password-6',
    );
    const res = await request(app.getHttpServer())
      .get('/v1/sla-breaches')
      .set('Authorization', `Bearer ${otherTenantQaToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
