import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  blockFulfillment,
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
const TSH_CODE = 'TSH';

/**
 * FEAT-060 (KB-17, KB-25, docs/plans/feat-060-reflex-stains-ihc.md). Proves
 * issue #545's own two ACs against a real published `workflow_definition`
 * rule, a real case->part->block fixture (`case.e2e-spec.ts`'s own AC #4
 * shape), a real draft/finalize/verify chain, and a real
 * `OutboxRelayService.tick()` delivery -- mirroring `reflex.e2e-spec.ts`'s
 * own real-event-through-real-pipeline style, adapted for the block-linked
 * (not specimen-linked) reflex command this feature adds.
 *
 * Reuses the seeded TSH test/analyte (same one `reflex.e2e-spec.ts` already
 * proves works end-to-end) as the block-linked "parent" test's own catalog
 * binding -- which real catalog test represents the triggering stain result
 * doesn't matter for proving the reflex mechanics; only a genuinely new
 * `test_definition` is created for the reflex/IHC *target* itself (a
 * placeholder name, proposal §5/§10 Q3), via the real `POST
 * /v1/test-definitions` route.
 */
describe('Reflex/add-on stains & IHC on existing blocks (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string; // test-user-4: technologist+verifier -- manage_specimens + enter_result + verify
  let db: ReturnType<typeof createDb>;
  let tshAnalyteId: string;
  let tshTestDefinitionId: string;

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

    const [tshDefRow] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, TSH_CODE),
        ),
      )
      .limit(1);
    tshTestDefinitionId = tshDefRow.id;
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

  /** A genuinely new test_definition, standing in for the reflex/IHC target
   * test -- a placeholder name (proposal §5/§10 Q3), bound to the seeded TSH
   * analyte purely to satisfy `testDefinitionCreateSchema`'s required
   * `analyteIds` (never drafted/verified against in this file). */
  async function createIhcTargetTestDefinition(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/test-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        code: `IHC-PANEL-${randomUUID()}`,
        displayName: 'IHC Panel (placeholder, FEAT-060 e2e fixture)',
        analyteIds: [tshAnalyteId],
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  /** case -> part -> block, plus a block-linked ordered_test on the seeded
   * TSH test (case.e2e-spec.ts's own AC #4 fixture shape). */
  async function createBlockLinkedOrderedTest(): Promise<{
    caseId: string;
    blockId: string;
    orderedTestId: string;
  }> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ firstName: 'ReflexBlock', lastName: 'Test', sex: 'U' })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ patientId, testDefinitionIds: [tshTestDefinitionId] })
      .expect(201);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    const caseId = (caseRes.body as { resourceId: string }).resourceId;

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    const [part] = (lineage.body as { parts: { id: string }[] }).parts;

    const blockRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/blocks`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ specimenId: part.id })
      .expect(201);
    const blockId = (blockRes.body as { resourceId: string }).resourceId;

    const linkRes = await request(app.getHttpServer())
      .post(`/v1/blocks/${blockId}/ordered-tests`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ testDefinitionId: tshTestDefinitionId })
      .expect(201);
    const orderedTestId = (linkRes.body as { resourceId: string }).resourceId;

    // Real, pre-existing gap surfaced by this feature, not created by it:
    // `POST /v1/blocks/:id/ordered-tests` (FEAT-057) links via
    // block_fulfillment only, leaving `status: 'ordered'` (the schema
    // default) and no `specimen_fulfillment` row -- but the generic result-
    // entry path (`ObservationWriteService.loadWriteContext`) hard-requires
    // both (`ENTERABLE_ORDERED_TEST_STATUSES` + a `specimen_fulfillment`
    // row, unconditionally, regardless of block_fulfillment). A block's own
    // specimen (the part it was grossed from) is a real, valid
    // specimen_fulfillment target -- not a hack, the coherent real-world
    // fact that a block descends from a specimen -- so this fixture adds it
    // directly, the same way FEAT-030's own reflex handler sets
    // `status: 'received'` directly on insert rather than through the
    // normal ordered/collected progression.
    await db
      .update(orderedTest)
      .set({ status: 'received' })
      .where(eq(orderedTest.id, orderedTestId));
    await db.insert(specimenFulfillment).values({
      tenantId: TENANT_A,
      specimenId: part.id,
      orderedTestId,
    });

    return { caseId, blockId, orderedTestId };
  }

  async function verifyResult(orderedTestId: string): Promise<void> {
    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${tshAnalyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 3.0 })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${tshAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 3.0 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${tshAnalyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  }

  it('AC #1/#2: an IHC/stain reflex rule creates a new OrderedTest on the existing block, with no new Case/Specimen row, traceable to the originating block', async () => {
    const ihcTestDefinitionId = await createIhcTargetTestDefinition();
    const { caseId, blockId, orderedTestId } =
      await createBlockLinkedOrderedTest();

    const lineageBefore = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    const before = lineageBefore.body as {
      parts: { blocks: unknown[] }[];
    };

    const [ihcTestDef] = await db
      .select({ code: testDefinition.code })
      .from(testDefinition)
      .where(eq(testDefinition.id, ihcTestDefinitionId));
    await publishRule([
      {
        id: `block-reflex-ihc-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'status', op: 'eq', value: 'verified' },
        do: { command: 'AddBlockReflexTest', testCode: ihcTestDef.code },
      },
    ]);

    await verifyResult(orderedTestId);
    await app.get(OutboxRelayService).tick();

    // AC #2: lineage traceable to the originating block.
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
    expect(reflex.testDefinitionId).toBe(ihcTestDefinitionId);
    expect(reflex.status).toBe('received');

    const fulfillmentRows = await db
      .select()
      .from(blockFulfillment)
      .where(eq(blockFulfillment.orderedTestId, reflex.id));
    expect(fulfillmentRows).toHaveLength(1);
    expect(fulfillmentRows[0].blockId).toBe(blockId);

    // AC #1: no new Case or Specimen row -- lineage part/block counts unchanged.
    const lineageAfter = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    const after = lineageAfter.body as { parts: { blocks: unknown[] }[] };
    expect(after.parts.length).toBe(before.parts.length);
    expect(after.parts[0].blocks.length).toBe(before.parts[0].blocks.length);

    // Audited.
    const auditRows = await db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.tenantId, TENANT_A),
          eq(auditEvent.resourceType, 'ordered_test'),
          eq(auditEvent.resourceId, reflex.id),
          eq(auditEvent.action, 'ordered_test.block_reflex_create'),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorType).toBe('service');
  });

  it('is idempotent: redelivering the same ObservationVerified event does not create a duplicate block reflex', async () => {
    const ihcTestDefinitionId = await createIhcTargetTestDefinition();
    const { orderedTestId } = await createBlockLinkedOrderedTest();
    const [ihcTestDef] = await db
      .select({ code: testDefinition.code })
      .from(testDefinition)
      .where(eq(testDefinition.id, ihcTestDefinitionId));

    await publishRule([
      {
        id: `block-reflex-idem-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'status', op: 'eq', value: 'verified' },
        do: { command: 'AddBlockReflexTest', testCode: ihcTestDef.code },
      },
    ]);

    await verifyResult(orderedTestId);
    await app.get(OutboxRelayService).tick();
    const afterFirstTick = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(afterFirstTick).toHaveLength(1);

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

  it('is a no-op for an ObservationVerified event with no block_fulfillment (not an AP case) -- never throws, creates nothing', async () => {
    const ihcTestDefinitionId = await createIhcTargetTestDefinition();
    const [ihcTestDef] = await db
      .select({ code: testDefinition.code })
      .from(testDefinition)
      .where(eq(testDefinition.id, ihcTestDefinitionId));

    await publishRule([
      {
        id: `block-reflex-nonap-${randomUUID()}`,
        on: 'ObservationVerified',
        when: { field: 'status', op: 'eq', value: 'verified' },
        do: { command: 'AddBlockReflexTest', testCode: ihcTestDef.code },
      },
    ]);

    // A plain, non-AP ordered_test (specimen-linked only, same shape
    // reflex.e2e-spec.ts's own createFixture produces, no block_fulfillment
    // row anywhere).
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `REFLEX-BLOCK-NONAP-${Date.now()}-${randomUUID()}`,
        firstName: 'NonAp',
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
        testDefinitionId: tshTestDefinitionId,
        status: 'in_process',
      })
      .returning();
    const [sp] = await db
      .insert(specimen)
      .values({
        tenantId: TENANT_A,
        accessionNumber: `REFLEX-BLOCK-NONAP-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

    await verifyResult(ot.id);
    await expect(app.get(OutboxRelayService).tick()).resolves.not.toThrow();

    const reflexRows = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, ot.id));
    expect(reflexRows).toHaveLength(0);
  });
});
