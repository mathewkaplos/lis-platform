import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  createDb,
  order,
  orderedTest,
  patient,
  specimen,
  specimenFulfillment,
  testAnalyte,
  testDefinition,
  workflowDefinition,
  workflowRuleFiring,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-029 (ADR-0029): proves issue #38's own AC #1 ("a new workflow rule
 * can be added via configuration without a code deployment") -- a real
 * published definition's rules are evaluated against a real
 * ObservationVerified event, matched or not, and recorded to
 * workflow_rule_firing. AC #2 (migrating existing hard-coded workflows) is
 * deliberately not attempted (see the proposal/issue #38 comment) and has
 * no test here.
 */
describe('Workflow definitions (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let humanToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseAnalyteId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [qaToken, verifierToken, humanToken] = await Promise.all([
      getKeycloakToken('test-user-5', 'test-password-5'),
      getKeycloakToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user', 'test-password'),
    ]);

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [analyteRow] = await db
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
          eq(testDefinition.code, GLUCOSE_CODE),
        ),
      )
      .limit(1);
    if (!analyteRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseAnalyteId = analyteRow.id;
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

  async function createPreliminaryObservation(): Promise<{
    orderedTestId: string;
  }> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `WF-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Workflow',
        lastName: 'Test',
        sex: 'U',
      })
      .returning();
    const [ord] = await db
      .insert(order)
      .values({ tenantId: TENANT_A, patientId: pat.id })
      .returning();
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
    const [ot] = await db
      .insert(orderedTest)
      .values({
        tenantId: TENANT_A,
        orderId: ord.id,
        testDefinitionId: testDefRow.id,
        status: 'in_process',
      })
      .returning();
    const [sp] = await db
      .insert(specimen)
      .values({
        tenantId: TENANT_A,
        accessionNumber: `WF-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

    return { orderedTestId: ot.id };
  }

  async function verifyGlucose(
    orderedTestId: string,
    value: number,
  ): Promise<void> {
    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: value })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: value })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  }

  it('rejects create/publish for a non-qa role -- 403', async () => {
    await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${humanToken}`)
      .send({
        rules: [
          {
            id: 'r1',
            on: 'ObservationVerified',
            when: { field: 'flags', op: 'includes', value: 'HH' },
            do: { command: 'LogEvent' },
          },
        ],
      })
      .expect(403);
  });

  it('rejects publishing a rule naming a denylisted command -- 400', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: 'r1',
            on: 'ObservationVerified',
            when: { field: 'flags', op: 'includes', value: 'HH' },
            do: { command: 'VerifyObservation' },
          },
        ],
      })
      .expect(201);
    const { id } = createRes.body as { id: string };

    const res = await request(app.getHttpServer())
      .post(`/v1/workflow-definitions/${id}/publish`)
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(400);
    expect((res.body as { detail: string }).detail).toContain(
      'VerifyObservation',
    );
  });

  it('evaluates a real published rule against a real ObservationVerified event, recording matched and non-matched rules alike', async () => {
    await archiveAnyPublished();

    const matchingRuleId = `match-${randomUUID()}`;
    const nonMatchingRuleId = `no-match-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: matchingRuleId,
            on: 'ObservationVerified',
            when: { field: 'status', op: 'eq', value: 'verified' },
            do: { command: 'LogEvent' },
          },
          {
            id: nonMatchingRuleId,
            on: 'ObservationVerified',
            when: { field: 'flags', op: 'includes', value: 'HH' },
            do: { command: 'LogEvent' },
          },
        ],
      })
      .expect(201);
    const { id: definitionId } = createRes.body as { id: string };

    await request(app.getHttpServer())
      .post(`/v1/workflow-definitions/${definitionId}/publish`)
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);

    const { orderedTestId } = await createPreliminaryObservation();
    await verifyGlucose(orderedTestId, 90); // in-range mg/dL, no HH flag

    // The workflow engine only runs when the outbox relay delivers the
    // ObservationVerified event -- @Interval fires too slowly for a test,
    // same reasoning as CriticalNotificationEscalationService's/
    // OutboxRelayService's own existing e2e tests (call the tick method
    // directly rather than waiting for the real interval).
    await app.get(OutboxRelayService).tick();

    const firings = await db
      .select()
      .from(workflowRuleFiring)
      .where(
        and(
          eq(workflowRuleFiring.tenantId, TENANT_A),
          eq(workflowRuleFiring.workflowDefinitionId, definitionId),
        ),
      );

    const matchingFiring = firings.find((f) => f.ruleId === matchingRuleId);
    const nonMatchingFiring = firings.find(
      (f) => f.ruleId === nonMatchingRuleId,
    );
    expect(matchingFiring?.matched).toBe(true);
    expect(matchingFiring?.dispatched).toBe(false); // no handler registered this phase
    expect(nonMatchingFiring?.matched).toBe(false);
    expect(nonMatchingFiring?.dispatched).toBeNull();
  });

  it("excludes another tenant's workflow definitions entirely (RLS)", async () => {
    const [inserted] = await db
      .insert(workflowDefinition)
      .values({
        tenantId: TENANT_A,
        version: 999,
        status: 'draft',
        rules: [],
      })
      .returning();

    const tenantBDb = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await tenantBDb.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
    );
    const rows = await tenantBDb
      .select()
      .from(workflowDefinition)
      .where(eq(workflowDefinition.id, inserted.id));
    expect(rows).toEqual([]);
  });
});
