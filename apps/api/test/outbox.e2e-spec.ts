import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  createDb,
  observation,
  order,
  orderedTest,
  outboxEvent,
  patient,
  specimen,
  specimenFulfillment,
  testAnalyte,
  testDefinition,
  writeOutboxEvent,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { OutboxHandlerRegistry } from '../src/outbox/outbox-handler.registry';
import { OutboxRelayService } from '../src/outbox/outbox-relay.service';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const GLUCOSE_CODE = 'GLU';

/**
 * FEAT-028 (ADR-0028): proves issue #37's literal AC -- "an event and its
 * triggering state change commit atomically or not at all" -- against a
 * real `verify()` call and a real, injected mid-transaction failure, plus
 * the relay's own delivery/retry semantics and tenant isolation.
 */
describe('Outbox (e2e)', () => {
  let app: INestApplication<App>;
  let verifierToken: string;
  let db: ReturnType<typeof createDb>;
  let glucoseAnalyteId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');

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

  /** A real, 'preliminary'-status observation ready for verify() -- direct
   * DB fixture setup, same style as gateway-ingest.e2e-spec.ts's own. */
  async function createPreliminaryObservation(): Promise<{
    orderedTestId: string;
    observationId: string;
  }> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `OUTBOX-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Outbox',
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
        accessionNumber: `OUTBOX-E2E-ACC-${Date.now()}-${randomUUID()}`,
        specimenType: 'blood_edta',
        status: 'received',
      })
      .returning();
    await db
      .insert(specimenFulfillment)
      .values({ tenantId: TENANT_A, specimenId: sp.id, orderedTestId: ot.id });
    const [obs] = await db
      .insert(observation)
      .values({
        tenantId: TENANT_A,
        orderedTestId: ot.id,
        analyteId: glucoseAnalyteId,
        specimenId: sp.id,
        patientId: pat.id,
        dataType: 'quantity',
        valueNum: '5.0',
        status: 'preliminary',
        source: 'manual',
      })
      .returning();

    return { orderedTestId: ot.id, observationId: obs.id };
  }

  it('writes the ObservationVerified outbox event atomically with the status update via a real POST /verify', async () => {
    const { orderedTestId, observationId } =
      await createPreliminaryObservation();

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${glucoseAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    const [obsRow] = await db
      .select({ status: observation.status })
      .from(observation)
      .where(eq(observation.id, observationId))
      .limit(1);
    expect(obsRow.status).toBe('verified');

    const [outboxRow] = await db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.tenantId, TENANT_A),
          eq(outboxEvent.eventType, 'ObservationVerified'),
          sql`${outboxEvent.payload}->>'id' = ${observationId}`,
        ),
      )
      .limit(1);
    expect(outboxRow).toBeDefined();
    expect(outboxRow.status).toBe('pending');
  });

  it('rolls back BOTH the domain change and the outbox row together on a mid-transaction failure -- the literal AC, proven by real rollback, not asserted from reading the code', async () => {
    const { observationId } = await createPreliminaryObservation();
    const txDb = createDb(process.env.APP_DATABASE_URL, { max: 1 });

    await expect(
      txDb.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`,
        );
        await tx
          .update(observation)
          .set({
            status: 'verified',
            verifierUserId: randomUUID(),
            verifiedAt: new Date(),
          })
          .where(eq(observation.id, observationId));
        await writeOutboxEvent(tx, {
          tenantId: TENANT_A,
          eventType: 'ObservationVerified',
          payload: { id: observationId },
        });
        throw new Error('simulated failure after both writes, before commit');
      }),
    ).rejects.toThrow('simulated failure');

    const [obsRow] = await db
      .select({ status: observation.status })
      .from(observation)
      .where(eq(observation.id, observationId))
      .limit(1);
    expect(obsRow.status).toBe('preliminary'); // unchanged -- the update never committed

    const outboxRows = await db
      .select()
      .from(outboxEvent)
      .where(sql`${outboxEvent.payload}->>'id' = ${observationId}`);
    expect(outboxRows).toEqual([]); // never committed either
  });

  describe('OutboxRelayService', () => {
    it('delivers a pending event to its registered handler and marks it processed', async () => {
      const eventType = `test-event-${randomUUID()}`;
      let delivered: unknown = null;
      app.get(OutboxHandlerRegistry).register(eventType, (payload) => {
        delivered = payload;
        return Promise.resolve();
      });

      const [inserted] = await db
        .insert(outboxEvent)
        .values({ tenantId: TENANT_A, eventType, payload: { hello: 'world' } })
        .returning();

      await app.get(OutboxRelayService).tick();

      const [row] = await db
        .select()
        .from(outboxEvent)
        .where(eq(outboxEvent.id, inserted.id))
        .limit(1);
      expect(row.status).toBe('processed');
      expect(row.processedAt).not.toBeNull();
      expect(delivered).toEqual({ hello: 'world' });
    });

    it('leaves the event pending and records attempts/lastError when the handler throws -- retryable, not silently dropped', async () => {
      const eventType = `test-event-fail-${randomUUID()}`;
      app.get(OutboxHandlerRegistry).register(eventType, () => {
        throw new Error('handler boom');
      });

      const [inserted] = await db
        .insert(outboxEvent)
        .values({ tenantId: TENANT_A, eventType, payload: {} })
        .returning();

      await app.get(OutboxRelayService).tick();

      const [row] = await db
        .select()
        .from(outboxEvent)
        .where(eq(outboxEvent.id, inserted.id))
        .limit(1);
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(1);
      expect(row.lastError).toContain('handler boom');
    });
  });

  it("excludes another tenant's outbox rows entirely (RLS)", async () => {
    const [inserted] = await db
      .insert(outboxEvent)
      .values({
        tenantId: TENANT_A,
        eventType: 'RlsCheckEvent',
        payload: { marker: randomUUID() },
      })
      .returning();

    const tenantBDb = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await tenantBDb.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
    );
    const rows = await tenantBDb
      .select()
      .from(outboxEvent)
      .where(eq(outboxEvent.id, inserted.id));
    expect(rows).toEqual([]);
  });
});
