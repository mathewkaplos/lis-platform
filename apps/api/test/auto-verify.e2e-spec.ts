import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  controlLot,
  createDb,
  observation,
  order,
  orderedTest,
  outboxEvent,
  patient,
  qcRuleViolation,
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
const POTASSIUM_CODE = 'K';

/**
 * FEAT-031 (ADR-0031): proves issue #40's three ACs against the real
 * pipeline -- a real published rule, real fixtures, and real
 * `OutboxRelayService.tick()` delivery, mirroring
 * `reflex.e2e-spec.ts`/`workflow.e2e-spec.ts`'s own style. Critically,
 * proves the safety invariant (AC #2) against a *maximally permissive*
 * rule's own `when` -- the handler, not the rule, is what refuses a
 * critical/QC-held/manual result (ADR-0031).
 */
describe('Auto-verification (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseAnalyteId: string;
  let glucoseUnitId: string;
  let potassiumAnalyteId: string;
  let potassiumUnitId: string;

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

    const [glucoseRow] = await db
      .select({ id: analyte.id, defaultUnitId: analyte.defaultUnitId })
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
    if (!glucoseRow?.defaultUnitId) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    glucoseAnalyteId = glucoseRow.id;
    glucoseUnitId = glucoseRow.defaultUnitId;

    const [potassiumRow] = await db
      .select({ id: analyte.id, defaultUnitId: analyte.defaultUnitId })
      .from(testAnalyte)
      .innerJoin(
        testDefinition,
        eq(testAnalyte.testDefinitionId, testDefinition.id),
      )
      .innerJoin(analyte, eq(testAnalyte.analyteId, analyte.id))
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, POTASSIUM_CODE),
        ),
      )
      .limit(1);
    if (!potassiumRow?.defaultUnitId) {
      throw new Error(
        'chemistry-catalog seed data (K) not found -- run `pnpm db:reset` first',
      );
    }
    potassiumAnalyteId = potassiumRow.id;
    potassiumUnitId = potassiumRow.defaultUnitId;
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

  /** Deliberately maximally permissive `when` -- matches every
   * ObservationFinalized event, proving the handler's own gates, not the
   * rule's condition, are what refuse an unsafe result (ADR-0031). */
  async function publishAutoVerifyRule(dryRun = false): Promise<void> {
    await archiveAnyPublished();
    const createRes = await request(app.getHttpServer())
      .post('/v1/workflow-definitions')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        rules: [
          {
            id: `auto-verify-${randomUUID()}`,
            on: 'ObservationFinalized',
            when: { field: 'status', op: 'eq', value: 'preliminary' },
            do: { command: 'AutoVerifyObservation' },
            dryRun,
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

  async function createFixture(
    testDefinitionCode: string,
  ): Promise<{ orderedTestId: string; patientId: string; specimenId: string }> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `AUTOVERIFY-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'AutoVerify',
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
          eq(testDefinition.code, testDefinitionCode),
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
        accessionNumber: `AUTOVERIFY-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });

    return { orderedTestId: ot.id, patientId: pat.id, specimenId: sp.id };
  }

  /** Directly inserts a 'preliminary' observation and its ObservationFinalized
   * outbox event -- the same shape a real finalize() call produces
   * (proven separately, see the first test below), skipping the HTTP
   * round-trip since finalize()'s own controller route hardcodes
   * source:'manual' and has no way to produce an analyzer-sourced row
   * directly. Matches outbox.e2e-spec.ts's own precedent of inserting a
   * pending outbox event directly to set up a relay-delivery fixture. */
  async function seedFinalizedObservation(params: {
    orderedTestId: string;
    analyteId: string;
    patientId: string;
    specimenId: string;
    flags: string[];
    source: 'analyzer' | 'manual';
  }): Promise<{ observationId: string }> {
    const [inserted] = await db
      .insert(observation)
      .values({
        tenantId: TENANT_A,
        orderedTestId: params.orderedTestId,
        analyteId: params.analyteId,
        patientId: params.patientId,
        specimenId: params.specimenId,
        dataType: 'quantity',
        valueNum: '5',
        flags: params.flags,
        status: 'preliminary',
        source: params.source,
        producedAt: new Date(),
      })
      .returning();

    await db.insert(outboxEvent).values({
      tenantId: TENANT_A,
      eventType: 'ObservationFinalized',
      payload: {
        id: inserted.id,
        orderedTestId: params.orderedTestId,
        analyteId: params.analyteId,
        dataType: 'quantity',
        valueNum: 5,
        valueCode: null,
        valueText: null,
        unit: null,
        refLow: null,
        refHigh: null,
        refCondition: null,
        refSource: null,
        flags: params.flags,
        status: 'preliminary',
        source: params.source,
        producedAt: inserted.producedAt?.toISOString() ?? null,
        createdAt: inserted.createdAt.toISOString(),
      },
    });

    return { observationId: inserted.id };
  }

  it('finalize() emits a real ObservationFinalized outbox event atomically with the write', async () => {
    const { orderedTestId } = await createFixture(GLUCOSE_CODE);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 90 })
      .expect(200);

    const rows = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'ObservationFinalized'),
          sql`${outboxEvent.payload}->>'orderedTestId' = ${orderedTestId}`,
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('auto-verifies a clean-normal, analyzer-sourced result via a live rule -- even against a maximally permissive `when`', async () => {
    await publishAutoVerifyRule();
    const { orderedTestId, patientId, specimenId } =
      await createFixture(GLUCOSE_CODE);
    const { observationId } = await seedFinalizedObservation({
      orderedTestId,
      analyteId: glucoseAnalyteId,
      patientId,
      specimenId,
      flags: ['N'],
      source: 'analyzer',
    });

    await app.get(OutboxRelayService).tick();

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, observationId));
    expect(row.status).toBe('verified');
    expect(row.verifierUserId).toBeNull();

    const auditRows = await db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.tenantId, TENANT_A),
          eq(auditEvent.resourceType, 'observation'),
          eq(auditEvent.resourceId, observationId),
          eq(auditEvent.action, 'observation.auto_verify'),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actorType).toBe('service');

    const verifiedEventRows = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'ObservationVerified'),
          sql`${outboxEvent.payload}->>'id' = ${observationId}`,
        ),
      );
    expect(verifiedEventRows).toHaveLength(1);
  });

  it('never auto-verifies a critical (HH/LL) result, even against the same maximally permissive rule', async () => {
    await publishAutoVerifyRule();
    const { orderedTestId, patientId, specimenId } =
      await createFixture(POTASSIUM_CODE);
    const { observationId } = await seedFinalizedObservation({
      orderedTestId,
      analyteId: potassiumAnalyteId,
      patientId,
      specimenId,
      flags: ['HH'],
      source: 'analyzer',
    });

    await app.get(OutboxRelayService).tick();

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, observationId));
    expect(row.status).toBe('preliminary'); // unchanged -- refused

    const auditRows = await db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.resourceId, observationId),
          eq(auditEvent.action, 'observation.auto_verify'),
        ),
      );
    expect(auditRows).toHaveLength(0);
  });

  it('never auto-verifies a result held by an unresolved rejection-severity QC violation', async () => {
    await publishAutoVerifyRule();
    const { orderedTestId, patientId, specimenId } =
      await createFixture(GLUCOSE_CODE);
    const { observationId } = await seedFinalizedObservation({
      orderedTestId,
      analyteId: glucoseAnalyteId,
      patientId,
      specimenId,
      flags: ['N'],
      source: 'analyzer',
    });

    const [lot] = await db
      .insert(controlLot)
      .values({
        tenantId: TENANT_A,
        analyteId: glucoseAnalyteId,
        level: 'normal',
        unitId: glucoseUnitId,
        targetMean: '90',
        targetSd: '5',
        lotNumber: `AUTOVERIFY-QC-${randomUUID()}`,
      })
      .returning();

    // A held QC observation, unrelated to the patient result above --
    // qc_rule_violation only needs a real controlLot + its own
    // observationId/observationCreatedAt companion pair.
    const [qcObs] = await db
      .insert(observation)
      .values({
        tenantId: TENANT_A,
        analyteId: glucoseAnalyteId,
        isControl: true,
        controlLotId: lot.id,
        dataType: 'quantity',
        valueNum: '200',
        status: 'preliminary',
        source: 'analyzer',
      })
      .returning();
    // observationCreatedAt: a server-side subquery, not qcObs.createdAt --
    // drizzle's returned timestamptz only has millisecond JS Date
    // resolution, while Postgres's own now() (this column's default) has
    // microsecond precision, so the JS-truncated value never exactly
    // matches what Postgres actually stored (this composite FK's exact-
    // equality lookup then fails) -- same class of bug this codebase has
    // hit and fixed before (observation.controller.ts's own
    // criticalNotification insert comment).
    const [violation] = await db
      .insert(qcRuleViolation)
      .values({
        tenantId: TENANT_A,
        controlLotId: lot.id,
        observationId: qcObs.id,
        observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${qcObs.id})`,
        ruleCode: '1_3s',
        severity: 'rejection',
      })
      .returning();

    await app.get(OutboxRelayService).tick();

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, observationId));
    expect(row.status).toBe('preliminary'); // unchanged -- QC-held, refused

    // Resolve before this test ends -- an unresolved rejection-severity
    // violation on glucose is a REAL, permanent hold (matching the real
    // gate's own analyte-scoped "over-block" behavior), and this suite runs
    // with fileParallelism:false against one shared, persistent dev DB --
    // leaving this unresolved would incorrectly QC-hold every other e2e
    // file's own glucose fixture for the rest of this same test run.
    await db
      .update(qcRuleViolation)
      .set({ resolvedAt: new Date(), resolvedByUserId: null })
      .where(eq(qcRuleViolation.id, violation.id));
  });

  it('never auto-verifies a manually-entered result, even if clean-normal', async () => {
    await publishAutoVerifyRule();
    const { orderedTestId, patientId, specimenId } =
      await createFixture(GLUCOSE_CODE);
    const { observationId } = await seedFinalizedObservation({
      orderedTestId,
      analyteId: glucoseAnalyteId,
      patientId,
      specimenId,
      flags: ['N'],
      source: 'manual',
    });

    await app.get(OutboxRelayService).tick();

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, observationId));
    expect(row.status).toBe('preliminary'); // unchanged -- not analyzer-sourced
  });

  it('a dryRun rule never performs a real verification, but records the real would-have-qualified outcome', async () => {
    await publishAutoVerifyRule(true);
    const { orderedTestId, patientId, specimenId } =
      await createFixture(GLUCOSE_CODE);
    const { observationId } = await seedFinalizedObservation({
      orderedTestId,
      analyteId: glucoseAnalyteId,
      patientId,
      specimenId,
      flags: ['N'],
      source: 'analyzer',
    });

    await app.get(OutboxRelayService).tick();

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, observationId));
    expect(row.status).toBe('preliminary'); // never actually verified

    const firings = await db
      .select()
      .from(workflowRuleFiring)
      .where(
        and(
          eq(workflowRuleFiring.tenantId, TENANT_A),
          eq(workflowRuleFiring.eventType, 'ObservationFinalized'),
          eq(workflowRuleFiring.dryRun, true),
        ),
      );
    expect(firings.length).toBeGreaterThan(0);
    expect(firings[firings.length - 1].dispatched).toBe(true); // the handler ran
  });

  it("a tenant B QC violation never holds tenant A's own auto-verify decision (RLS)", async () => {
    // Deliberately potassium, not glucose: the earlier "unresolved QC
    // violation" test above leaves a real, permanent, unresolved hold on
    // glucose for tenant A (matching the real gate's own analyte-scoped,
    // not lot-scoped, "over-block" behavior -- KB/ADR-0019 precedent) --
    // reusing glucose here would conflate "tenant A's own real hold" with
    // "tenant B's hold leaking," which is exactly the distinction this test
    // needs to keep clean. Potassium has no QC violation created against it
    // anywhere else in this file.
    await publishAutoVerifyRule();
    const { orderedTestId, patientId, specimenId } =
      await createFixture(POTASSIUM_CODE);
    const { observationId } = await seedFinalizedObservation({
      orderedTestId,
      analyteId: potassiumAnalyteId,
      patientId,
      specimenId,
      flags: ['N'],
      source: 'analyzer',
    });

    const tenantBDb = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await tenantBDb.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
    );
    const [tenantBLot] = await tenantBDb
      .insert(controlLot)
      .values({
        tenantId: TENANT_B,
        analyteId: potassiumAnalyteId,
        level: 'normal',
        unitId: potassiumUnitId,
        targetMean: '4.5',
        targetSd: '0.3',
        lotNumber: `AUTOVERIFY-QC-B-${randomUUID()}`,
      })
      .returning();
    const [tenantBQcObs] = await tenantBDb
      .insert(observation)
      .values({
        tenantId: TENANT_B,
        analyteId: potassiumAnalyteId,
        isControl: true,
        controlLotId: tenantBLot.id,
        dataType: 'quantity',
        valueNum: '200',
        status: 'preliminary',
        source: 'analyzer',
      })
      .returning();
    await tenantBDb.insert(qcRuleViolation).values({
      tenantId: TENANT_B,
      controlLotId: tenantBLot.id,
      observationId: tenantBQcObs.id,
      observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${tenantBQcObs.id})`,
      ruleCode: '1_3s',
      severity: 'rejection',
    });

    await app.get(OutboxRelayService).tick();

    const [row] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, observationId));
    expect(row.status).toBe('verified'); // tenant B's own QC hold never applies
  });
});
