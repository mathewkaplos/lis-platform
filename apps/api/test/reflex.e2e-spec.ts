import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  createDb,
  order,
  orderedTest,
  outboxEvent,
  patient,
  specimen,
  specimenFulfillment,
  testAnalyte,
  testDefinition,
  workflowDefinition,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const TSH_CODE = 'TSH';
const FT4_CODE = 'FT4';

/**
 * FEAT-030 (ADR-0030): proves issue #39's literal AC -- "a reflex rule
 * correctly triggers a follow-on test and the lineage is traceable
 * end-to-end" -- against a real published rule, a real draft/finalize/
 * verify chain, and a real `OutboxRelayService.tick()` delivery, mirroring
 * `outbox.e2e-spec.ts`/`workflow.e2e-spec.ts`'s own real-event-through-
 * real-pipeline style.
 */
describe('Reflex rules (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let db: ReturnType<typeof createDb>;
  let tshAnalyteId: string;
  let tshTestDefinitionId: string;
  let ft4TestDefinitionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [qaToken, verifierToken] = await Promise.all([
      getKeycloakToken('test-user-5', 'test-password-5'),
      getKeycloakToken('test-user-4', 'test-password-4'),
    ]);

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [tshAnalyteRow] = await db
      .select({ id: analyte.id })
      .from(testAnalyte)
      .innerJoin(
        testDefinition,
        eq(testAnalyte.testDefinitionId, testDefinition.id),
      )
      .innerJoin(analyte, eq(testAnalyte.analyteId, analyte.id))
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, TSH_CODE),
        ),
      )
      .limit(1);
    if (!tshAnalyteRow) {
      throw new Error(
        'chemistry-catalog seed data (TSH) not found -- run `pnpm db:reset` first',
      );
    }
    tshAnalyteId = tshAnalyteRow.id;

    const [tshDef] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, TSH_CODE),
        ),
      )
      .limit(1);
    tshTestDefinitionId = tshDef.id;

    const [ft4Def] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, FT4_CODE),
        ),
      )
      .limit(1);
    ft4TestDefinitionId = ft4Def.id;
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

  async function publishRule(rules: unknown[]): Promise<string> {
    await archiveAnyPublished();
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ rules })
      .expect(201);
    const { id } = createRes.body as { id: string };
    await request(app.getHttpServer())
      .post(`/v1/workflow-definitions/${id}/publish`)
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
    return id;
  }

  /** Creates a real patient/order/ordered_test/specimen/fulfillment fixture
   * for the given test_definition, so draft/finalize/verify runs against a
   * genuine specimen -- same style as workflow.e2e-spec.ts's own
   * createPreliminaryObservation, parametrized to the test being ordered. */
  async function createFixture(
    testDefinitionId: string,
  ): Promise<{ orderedTestId: string; specimenId: string }> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `REFLEX-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Reflex',
        lastName: 'Test',
        sex: 'U',
      })
      .returning();
    const [ord] = await db
      .insert(order)
      .values({ tenantId: TENANT_A, patientId: pat.id })
      .returning();
    const [ot] = await db
      .insert(orderedTest)
      .values({
        tenantId: TENANT_A,
        orderId: ord.id,
        testDefinitionId,
        status: 'in_process',
      })
      .returning();
    const [sp] = await db
      .insert(specimen)
      .values({
        tenantId: TENANT_A,
        accessionNumber: `REFLEX-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

    return { orderedTestId: ot.id, specimenId: sp.id };
  }

  async function verifyTsh(
    orderedTestId: string,
    value: number,
  ): Promise<void> {
    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${tshAnalyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: value })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${tshAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: value })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${tshAnalyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  }

  it('creates a reflex ordered_test on the same specimen, with traceable lineage, when a published rule matches a real ObservationVerified event', async () => {
    await publishRule([
      {
        id: `reflex-tsh-ft4-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'valueNum', op: 'gt', value: 5.0 },
        do: { command: 'AddReflexTest', testCode: FT4_CODE },
      },
    ]);

    const { orderedTestId, specimenId } =
      await createFixture(tshTestDefinitionId);
    await verifyTsh(orderedTestId, 6.0); // > 5.0 -- triggers the reflex

    await app.get(OutboxRelayService).tick();

    const reflexRows = await db
      .select()
      .from(orderedTest)
      .where(
        and(
          eq(orderedTest.tenantId, TENANT_A),
          eq(orderedTest.parentOrderedTestId, orderedTestId),
        ),
      );
    expect(reflexRows).toHaveLength(1);
    const reflex = reflexRows[0];
    expect(reflex.testDefinitionId).toBe(ft4TestDefinitionId);
    expect(reflex.status).toBe('received');

    // Lineage traceable end-to-end: same specimen (no recollection).
    const fulfillmentRows = await db
      .select()
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.orderedTestId, reflex.id));
    expect(fulfillmentRows).toHaveLength(1);
    expect(fulfillmentRows[0].specimenId).toBe(specimenId);

    // Audited.
    const auditRows = await db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.tenantId, TENANT_A),
          eq(auditEvent.resourceType, 'ordered_test'),
          eq(auditEvent.resourceId, reflex.id),
          eq(auditEvent.action, 'ordered_test.reflex_create'),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorType).toBe('service');
  });

  it('is idempotent: redelivering the same ObservationVerified event does not create a duplicate reflex', async () => {
    await publishRule([
      {
        id: `reflex-tsh-ft4-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'valueNum', op: 'gt', value: 5.0 },
        do: { command: 'AddReflexTest', testCode: FT4_CODE },
      },
    ]);

    const { orderedTestId } = await createFixture(tshTestDefinitionId);
    await verifyTsh(orderedTestId, 7.0);

    await app.get(OutboxRelayService).tick();
    const afterFirstTick = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(afterFirstTick).toHaveLength(1);

    // Simulate a real outbox redelivery: flip the already-processed event
    // back to pending (exactly what a relay retry after a partial failure
    // looks like from the handler's own point of view) and tick() again.
    await db
      .update(outboxEvent)
      .set({ status: 'pending' })
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'ObservationVerified'),
          sql`${outboxEvent.payload}->>'orderedTestId' = ${orderedTestId}`,
        ),
      );
    await app.get(OutboxRelayService).tick();

    const afterRedelivery = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(afterRedelivery).toHaveLength(1); // still exactly one, no duplicate
  });

  it('cycle guardrail: a rule that would reflex back to an ancestor test does not create it and does not throw', async () => {
    const { orderedTestId: tshOrderedTestId } =
      await createFixture(tshTestDefinitionId);

    // Manually seed a one-level-deep reflex chain: an FT4 ordered_test whose
    // parent is the TSH one above -- same shape AddReflexTest itself would
    // produce, set up directly so the test controls the ancestor chain.
    const [ft4Fulfillment] = await db
      .select({ specimenId: specimenFulfillment.specimenId })
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.orderedTestId, tshOrderedTestId));
    const [ft4Ordered] = await db
      .insert(orderedTest)
      .values({
        tenantId: TENANT_A,
        orderId: (
          await db
            .select({ orderId: orderedTest.orderId })
            .from(orderedTest)
            .where(eq(orderedTest.id, tshOrderedTestId))
        )[0].orderId,
        testDefinitionId: ft4TestDefinitionId,
        status: 'in_process',
        parentOrderedTestId: tshOrderedTestId,
      })
      .returning();
    await db.insert(specimenFulfillment).values({
      tenantId: TENANT_A,
      specimenId: ft4Fulfillment.specimenId,
      orderedTestId: ft4Ordered.id,
    });

    // A rule that would cycle FT4's own verification back to TSH -- FT4's
    // ancestor chain is [TSH], so this must be refused.
    await publishRule([
      {
        id: `reflex-cycle-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'status', op: 'eq', value: 'verified' },
        do: { command: 'AddReflexTest', testCode: TSH_CODE },
      },
    ]);

    // Enter/finalize/verify a result directly on the FT4 ordered_test
    // (reusing the TSH analyte/route shape isn't right here -- draft against
    // FT4's own analyte instead).
    const [ft4AnalyteRow] = await db
      .select({ id: analyte.id })
      .from(testAnalyte)
      .innerJoin(analyte, eq(testAnalyte.analyteId, analyte.id))
      .where(eq(testAnalyte.testDefinitionId, ft4TestDefinitionId))
      .limit(1);

    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${ft4Ordered.id}/results/${ft4AnalyteRow.id}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 1.2 })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${ft4Ordered.id}/results/${ft4AnalyteRow.id}/finalize`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 1.2 })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${ft4Ordered.id}/results/${ft4AnalyteRow.id}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    await expect(app.get(OutboxRelayService).tick()).resolves.not.toThrow();

    const cyclicalRows = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, ft4Ordered.id));
    expect(cyclicalRows).toHaveLength(0); // guardrail refused, no new row
  });

  it('an unresolvable testCode does not throw and creates nothing', async () => {
    await publishRule([
      {
        id: `reflex-bad-code-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'valueNum', op: 'gt', value: 5.0 },
        do: { command: 'AddReflexTest', testCode: 'DOES-NOT-EXIST' },
      },
    ]);

    const { orderedTestId } = await createFixture(tshTestDefinitionId);
    await verifyTsh(orderedTestId, 8.0);

    await expect(app.get(OutboxRelayService).tick()).resolves.not.toThrow();

    const reflexRows = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(reflexRows).toHaveLength(0);
  });

  it("excludes another tenant's ordered_test lineage entirely (RLS)", async () => {
    const { orderedTestId } = await createFixture(tshTestDefinitionId);
    const [reflexRow] = await db
      .insert(orderedTest)
      .values({
        tenantId: TENANT_A,
        orderId: (
          await db
            .select({ orderId: orderedTest.orderId })
            .from(orderedTest)
            .where(eq(orderedTest.id, orderedTestId))
        )[0].orderId,
        testDefinitionId: ft4TestDefinitionId,
        status: 'received',
        parentOrderedTestId: orderedTestId,
      })
      .returning();

    const tenantBDb = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await tenantBDb.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
    );
    const rows = await tenantBDb
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.id, reflexRow.id));
    expect(rows).toEqual([]);
  });
});
