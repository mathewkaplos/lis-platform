import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDb,
  orderedTest,
  outboxEvent,
  specimenFulfillment,
  synopticProtocolVersion,
  workflowDefinition,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const HPV_CODE = 'HPV';

/**
 * FEAT-064 (docs/plans/feat-064-cytology-reflex-ascus-hpv.md, issue #543).
 * Proves both issue ACs against a real Postgres/Keycloak/`OutboxRelayService`
 * pipeline, mirroring `culture-read.e2e-spec.ts`'s own "growth fires the
 * published rule" test shape -- the third proven instance of the same
 * reflex-cascade engine (FEAT-030), `AddReflexTest` reused entirely
 * unmodified.
 *
 * The `specimen_fulfillment` row on the parent (Pap) `ordered_test` is
 * inserted directly here, not produced by any real request -- proposal
 * §3/§5/§10 Q1's own documented finding: `case.controller.ts`'s AP flow
 * never populates `specimen_fulfillment` for a case's own order-level
 * `ordered_test` (the same root cause already filed as issue #561, just
 * blocking reflex-triggering here instead of result-entry). This proves the
 * reflex *mechanism* (event -> rule -> AddReflexTest -> new ordered_test),
 * not a fully production-wired AP case.
 */
describe('Cytology reflex: ASC-US -> HPV (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens
  let qaToken: string; // test-user-5: manage_workflow
  let db: ReturnType<typeof createDb>;
  let papVersionId: string;
  let hpvTestDefId: string;

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

  async function publishAscUsHpvRule(): Promise<void> {
    await archiveAnyPublished();
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: `cytology-ascus-hpv-reflex-${randomUUID()}`,
            on: 'SynopticResponseRecorded',
            when: {
              field: 'interpretation_category',
              op: 'eq',
              value: 'asc_us',
            },
            do: { command: 'AddReflexTest', testCode: HPV_CODE },
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

  /** A real cytology case with a Pap-carrying orderedTest, mirroring
   * cytology-pap.e2e-spec.ts's own createCytologyCase() fixture, plus the
   * direct specimen_fulfillment insert this file's own header comment
   * documents (proposal §5/§10 Q1). */
  async function createCytologyCase(): Promise<{
    orderedTestId: string;
    specimenId: string;
  }> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Reflex', lastName: 'Fixture', sex: 'F' })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const glu = (
      catalogRes.body as { tests: { id: string; code: string }[] }
    ).tests.find((t) => t.code === 'GLU');
    if (!glu) {
      throw new Error("expected db/seed/chemistry-catalog.sql fixture 'GLU'");
    }

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glu.id] })
      .expect(201);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'cervical_cytology' }] })
      .expect(201);
    const caseId = (caseRes.body as { resourceId: string }).resourceId;

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const [part] = (lineage.body as { parts: { id: string }[] }).parts;

    const orderDetail = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderedTestId = (
      orderDetail.body as { orderedTests: { id: string }[] }
    ).orderedTests[0].id;

    // Proposal §3/§5/§10 Q1: case.controller.ts's own AP flow never inserts
    // specimen_fulfillment for a case's order-level ordered_test -- the
    // same root cause as issue #561. Worked around directly here, exactly
    // as engineering/workflow-engine Skill entry #12 already documents for
    // the analogous block_fulfillment gap.
    await db.insert(specimenFulfillment).values({
      tenantId: TENANT_A,
      specimenId: part.id,
      orderedTestId,
    });

    return { orderedTestId, specimenId: part.id };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, qaToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-5', 'test-password-5'),
    ]);

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const hpvRes = await db.execute(
      sql`SELECT id FROM test_definition WHERE tenant_id = ${TENANT_A} AND code = ${HPV_CODE}`,
    );
    const hpvRows = hpvRes.rows as { id: string }[];
    if (hpvRows.length === 0) {
      throw new Error(
        "expected db/seed/synoptic-protocol-cytology-pap.sql's 'HPV' test_definition -- run `pnpm db:reset` first",
      );
    }
    hpvTestDefId = hpvRows[0].id;

    const protocolsRes = await request(app.getHttpServer())
      .get('/v1/synoptic-protocols')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const pap = (
      protocolsRes.body as { protocols: { id: string; name: string }[] }
    ).protocols.find((p) => p.name === 'Cervical Cytology (Pap)');
    if (!pap) {
      throw new Error(
        "expected db/seed/synoptic-protocol-cytology-pap.sql's 'Cervical Cytology (Pap)' protocol",
      );
    }

    const [{ id: versionId }] = await db
      .select({ id: synopticProtocolVersion.id })
      .from(synopticProtocolVersion)
      .where(
        and(
          eq(synopticProtocolVersion.synopticProtocolId, pap.id),
          eq(synopticProtocolVersion.status, 'published'),
        ),
      );
    papVersionId = versionId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function recordSynopticResponse(
    orderedTestId: string,
    interpretationCategory: string,
    specimenId: string,
  ) {
    return request(app.getHttpServer())
      .post(
        `/v1/cases/${await caseIdForOrderedTest(orderedTestId)}/synoptic-responses`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        specimenId,
        synopticProtocolVersionId: papVersionId,
        responses: [
          { elementKey: 'specimen_adequacy', value: 'satisfactory' },
          {
            elementKey: 'interpretation_category',
            value: interpretationCategory,
          },
        ],
      })
      .expect(201);
  }

  async function caseIdForOrderedTest(orderedTestId: string): Promise<string> {
    const [{ orderId }] = await db
      .select({ orderId: orderedTest.orderId })
      .from(orderedTest)
      .where(eq(orderedTest.id, orderedTestId));
    const res = await db.execute(
      sql`SELECT id FROM "case" WHERE tenant_id = ${TENANT_A} AND order_id = ${orderId}`,
    );
    return (res.rows as { id: string }[])[0].id;
  }

  it('AC #1: an ASC-US interpretation fires the published rule and creates a correctly-lineaged HPV ordered_test via AddReflexTest, unmodified', async () => {
    await publishAscUsHpvRule();
    const { orderedTestId, specimenId } = await createCytologyCase();

    await recordSynopticResponse(orderedTestId, 'asc_us', specimenId);
    await app.get(OutboxRelayService).tick();

    const reflexRows = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(reflexRows).toHaveLength(1);
    expect(reflexRows[0].testDefinitionId).toBe(hpvTestDefId);
    expect(reflexRows[0].status).toBe('received');

    const fulfillmentRows = await db
      .select()
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.orderedTestId, reflexRows[0].id));
    expect(fulfillmentRows).toHaveLength(1);
    expect(fulfillmentRows[0].specimenId).toBe(specimenId);

    // Redelivery is idempotent -- AddReflexTest's own existing guarantee.
    await db
      .update(outboxEvent)
      .set({ status: 'pending' })
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'SynopticResponseRecorded'),
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

  it('a NILM interpretation records successfully but creates no reflex', async () => {
    await publishAscUsHpvRule();
    const { orderedTestId, specimenId } = await createCytologyCase();

    await recordSynopticResponse(orderedTestId, 'nilm', specimenId);
    await app.get(OutboxRelayService).tick();

    const reflexRows = await db
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.parentOrderedTestId, orderedTestId));
    expect(reflexRows).toHaveLength(0);
  });

  it('AC #2: the reflex rule is configurable metadata, not hardcoded logic -- authored via the existing, unmodified workflow-definitions API', async () => {
    await archiveAnyPublished();
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: `cytology-ascus-hpv-reflex-${randomUUID()}`,
            on: 'SynopticResponseRecorded',
            when: {
              field: 'interpretation_category',
              op: 'eq',
              value: 'asc_us',
            },
            do: { command: 'AddReflexTest', testCode: HPV_CODE },
          },
        ],
      })
      .expect(201);
    const { id } = createRes.body as { id: string };
    const publishRes = await request(app.getHttpServer())
      .post(`/v1/workflow-definitions/${id}/publish`)
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
    expect((publishRes.body as { status: string }).status).toBe('published');
  });
});
