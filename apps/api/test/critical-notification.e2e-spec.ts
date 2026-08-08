import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  auditEvent,
  createDb,
  criticalNotification,
  observation,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { CriticalNotificationEscalationService } from '../src/critical-notification/critical-notification-escalation.service';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000099';
// Sodium: a real, seeded critical threshold (120/160, domain/critical-values
// Skill entry #3) on a single-analyte test_definition -- same fixture
// observation.e2e-spec.ts's own critical (LL) test uses. Its own ordered_test
// always has exactly one required analyte, so finalizing it always trips
// FinalizationRollupInterceptor's 409 (TASK-056) on the very first call --
// this spec asserts creation via the persisted DB row and audit event,
// matching observation.e2e-spec.ts's own established pattern for this exact
// structural reason, not via a clean 200 HTTP body.
const SODIUM_CODE = 'NA';
const SODIUM_CRITICAL_LOW_VALUE = 115; // below the real 120 critical-low threshold

/**
 * TASK-065 (FEAT-021, docs/plans/feat-021-critical-notification-read-back-escalation.md,
 * ADR-0016). Real Nest app, real Keycloak tokens, real Postgres, matching
 * observation.e2e-spec.ts's own standard for anything mutating clinical
 * data.
 */
describe('Critical notification API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let verifierToken: string; // test-user-4, TENANT_A -- carries the `verify` capability this controller's acknowledge route requires
  let tokenB: string; // test-user-2, TENANT_B -- proves cross-tenant 404 (engineering/api-design entry #7)
  let patientId: string;
  let sodiumAnalyteId: string;

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
    if (!row) {
      throw new Error(`no analyte found for test code '${testCode}'`);
    }
    return row.analyteId;
  }

  async function createOrder(): Promise<{
    orderId: string;
    orderedTestId: string;
  }> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    const found = catalog.tests.find((t) => t.code === SODIUM_CODE);
    if (!found) {
      throw new Error(
        `expected catalog fixture '${SODIUM_CODE}' in /v1/catalog`,
      );
    }

    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [found.id] })
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

  /** Finalizes Sodium with a real critical-low value. Always 409s (TASK-056
   * -- see this file's own header comment for why); the observation write
   * and its `observation.finalize` audit event still commit underneath it,
   * per that task's own resolved decision. Returns the resulting
   * observation id, looked up directly since the 409 response carries none. */
  async function finalizeSodiumCritical(
    orderedTestId: string,
  ): Promise<string> {
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: SODIUM_CRITICAL_LOW_VALUE })
      .expect(409);

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({ id: observation.id })
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, orderedTestId),
          eq(observation.analyteId, sodiumAnalyteId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new Error(
        'expected the observation write to persist despite the 409',
      );
    }
    return row.id;
  }

  async function latestFinalizeAuditAfter(
    observationId: string,
  ): Promise<{ criticalNotificationId?: string | null } | null> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({ after: auditEvent.after })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, 'observation.finalize'),
          eq(auditEvent.resourceId, observationId),
        ),
      )
      .orderBy(desc(auditEvent.sequence))
      .limit(1);
    return (
      (row?.after as { criticalNotificationId?: string | null } | null) ?? null
    );
  }

  async function notificationsForObservation(
    observationId: string,
  ): Promise<(typeof criticalNotification.$inferSelect)[]> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    return db
      .select()
      .from(criticalNotification)
      .where(eq(criticalNotification.observationId, observationId));
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');
    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');
    tokenB = await getKeycloakToken('test-user-2', 'test-password-2');

    sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Critical',
        lastName: 'Notification',
        sex: 'F',
        birthDate: '1980-01-01',
      })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('creation hook (finalize())', () => {
    it('creates exactly one pending critical_notification the first time an analyte is critical-flagged, folded into the same finalize audit event', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);

      const notifications = await notificationsForObservation(observationId);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].status).toBe('pending');
      expect(notifications[0].tenantId).toBe(TENANT_A);

      const auditAfter = await latestFinalizeAuditAfter(observationId);
      expect(auditAfter?.criticalNotificationId).toBe(notifications[0].id);
    });

    it('does not create a duplicate on a subsequent re-finalize of the same still-critical, not-yet-acknowledged analyte', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const firstObservationId = await finalizeSodiumCritical(orderedTestId);
      const firstNotifications =
        await notificationsForObservation(firstObservationId);
      expect(firstNotifications).toHaveLength(1);

      // Re-finalize the same (not-yet-verified) analyte -- upsertObservation
      // updates the same row in place (TASK-053), so this is the same
      // observation id, still critical, still not acknowledged.
      const secondObservationId = await finalizeSodiumCritical(orderedTestId);
      expect(secondObservationId).toBe(firstObservationId);

      const notificationsAfterSecondFinalize =
        await notificationsForObservation(firstObservationId);
      expect(notificationsAfterSecondFinalize).toHaveLength(1);
      expect(notificationsAfterSecondFinalize[0].id).toBe(
        firstNotifications[0].id,
      );

      const auditAfter = await latestFinalizeAuditAfter(firstObservationId);
      expect(auditAfter?.criticalNotificationId).toBe(firstNotifications[0].id);
    });
  });

  describe('POST /v1/critical-notifications/:id/acknowledge', () => {
    async function createPendingNotification(): Promise<string> {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);
      return notification.id;
    }

    it('rejects an unauthenticated request', async () => {
      const notificationId = await createPendingNotification();
      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .send({ readBack: 'confirmed with Dr. Lee' })
        .expect(401);
    });

    it('requires the verify capability -- a technologist-only token is rejected', async () => {
      const notificationId = await createPendingNotification();
      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .set('Authorization', `Bearer ${tokenA}`) // test-user: technologist only, no verify capability
        .send({ readBack: 'confirmed with Dr. Lee' })
        .expect(403);
    });

    it('captures the read-back, sets acknowledgedAt/acknowledgedByUserId, and is audited', async () => {
      const notificationId = await createPendingNotification();

      const res = await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          readBack: 'confirmed with Dr. Lee, value repeated back correctly',
        })
        .expect(200);
      const body = res.body as {
        resourceId: string;
        after: {
          id: string;
          status: string;
          readBack: string | null;
          acknowledgedAt: string | null;
          acknowledgedByUserId: string | null;
        };
      };
      expect(body.after.status).toBe('acknowledged');
      expect(body.after.readBack).toBe(
        'confirmed with Dr. Lee, value repeated back correctly',
      );
      expect(body.after.acknowledgedAt).not.toBeNull();
      expect(body.after.acknowledgedByUserId).not.toBeNull();
      expect(body.resourceId).toBe(notificationId);

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({ after: auditEvent.after })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.action, 'critical_notification.acknowledge'),
            eq(auditEvent.resourceId, notificationId),
          ),
        )
        .limit(1);
      expect(row).toBeDefined();
    });

    it('rejects an empty (or whitespace-only) read-back with 400', async () => {
      const notificationId = await createPendingNotification();
      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: '   ' })
        .expect(400);
    });

    it('rejects acknowledging an already-acknowledged notification with 409', async () => {
      const notificationId = await createPendingNotification();
      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'first read-back' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'second attempt' })
        .expect(409);
    });

    it("404s on another tenant's notification -- cross-tenant existence is never leaked (engineering/api-design entry #7)", async () => {
      const notificationId = await createPendingNotification();
      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notificationId}/acknowledge`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ readBack: 'wrong tenant' })
        .expect(404);
    });

    it('404s on a notification id that does not exist', async () => {
      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${randomUUID()}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'confirmed' })
        .expect(404);
    });
  });

  describe('GET /v1/critical-notifications', () => {
    it('is queryable independently of observation.verify() state, and the status filter reflects acknowledge()', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);

      const pendingRes = await request(app.getHttpServer())
        .get('/v1/critical-notifications')
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const pendingIds = (pendingRes.body as { id: string }[]).map((n) => n.id);
      expect(pendingIds).toContain(notification.id);

      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notification.id}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'confirmed' })
        .expect(200);

      const pendingAfterAck = await request(app.getHttpServer())
        .get('/v1/critical-notifications')
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(
        (pendingAfterAck.body as { id: string }[]).map((n) => n.id),
      ).not.toContain(notification.id);

      const acknowledgedRes = await request(app.getHttpServer())
        .get('/v1/critical-notifications')
        .query({ status: 'acknowledged' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(
        (acknowledgedRes.body as { id: string }[]).map((n) => n.id),
      ).toContain(notification.id);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/v1/critical-notifications')
        .expect(401);
    });
  });

  describe('RLS isolation', () => {
    it('a critical_notification row created under one tenant is invisible to another tenant session', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const visibleToOwnTenant = await db
        .select()
        .from(criticalNotification)
        .where(eq(criticalNotification.id, notification.id));
      expect(visibleToOwnTenant).toHaveLength(1);

      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
      );
      const visibleToWrongTenant = await db
        .select()
        .from(criticalNotification)
        .where(eq(criticalNotification.id, notification.id));
      expect(visibleToWrongTenant).toHaveLength(0);

      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
    });
  });

  /**
   * TASK-066 (FEAT-021, ADR-0017). `@Interval` fires every 5 minutes in real
   * use -- far too slow for a test -- so these call
   * `CriticalNotificationEscalationService.escalateOverdue()` directly (a
   * real NestJS testing pattern: grab the provider instance off the same
   * app module already booted for this spec), and backdate a real
   * `critical_notification.createdAt` via direct `@lis/db` access to
   * simulate it being overdue, rather than manipulating the global
   * `CRITICAL_NOTIFICATION_ESCALATION_MINUTES` env var (which every other
   * test in this file, and every other spec file sharing this same env,
   * would also read).
   */
  describe('CriticalNotificationEscalationService (TASK-066)', () => {
    async function backdateCreatedAt(
      notificationId: string,
      minutesAgo: number,
    ): Promise<void> {
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      await db
        .update(criticalNotification)
        .set({ createdAt: new Date(Date.now() - minutesAgo * 60 * 1000) })
        .where(eq(criticalNotification.id, notificationId));
    }

    it('escalates a critical_notification still pending past the configured window, audited', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);

      // Default window is 30 minutes (ADR-0017 revision) -- 60 minutes ago
      // is unambiguously overdue regardless of test env overrides.
      await backdateCreatedAt(notification.id, 60);

      const escalationService = app.get(CriticalNotificationEscalationService);
      await escalationService.escalateOverdue();

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [updated] = await db
        .select()
        .from(criticalNotification)
        .where(eq(criticalNotification.id, notification.id));
      expect(updated.status).toBe('escalated');
      expect(updated.escalationLevel).toBe(1);
      expect(updated.lastEscalatedAt).not.toBeNull();

      const [auditRow] = await db
        .select({ after: auditEvent.after })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.action, 'critical_notification.escalate'),
            eq(auditEvent.resourceId, notification.id),
          ),
        )
        .orderBy(desc(auditEvent.sequence))
        .limit(1);
      expect(auditRow).toBeDefined();
      const after = auditRow.after as { status: string };
      expect(after.status).toBe('escalated');
    });

    it('does not escalate a notification still within the escalation window', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);
      // createdAt left at "now" -- not overdue.

      const escalationService = app.get(CriticalNotificationEscalationService);
      await escalationService.escalateOverdue();

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [unchanged] = await db
        .select()
        .from(criticalNotification)
        .where(eq(criticalNotification.id, notification.id));
      expect(unchanged.status).toBe('pending');
      expect(unchanged.escalationLevel).toBe(0);
    });

    it('does not escalate an already-acknowledged notification even if old', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);

      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notification.id}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'confirmed' })
        .expect(200);
      await backdateCreatedAt(notification.id, 60);

      const escalationService = app.get(CriticalNotificationEscalationService);
      await escalationService.escalateOverdue();

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [unchanged] = await db
        .select()
        .from(criticalNotification)
        .where(eq(criticalNotification.id, notification.id));
      expect(unchanged.status).toBe('acknowledged');
    });
  });

  /**
   * TASK-066 (ADR-0017). Proves the migration's own AC directly against a
   * real Postgres instance, connected as `lis_scheduler` itself -- not
   * inferred from the escalation job's own behavior above, which only ever
   * exercises the happy path through that role.
   */
  describe('lis_scheduler role (ADR-0017)', () => {
    it('can read tenant_id of pending critical_notification rows, but no other column', async () => {
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      await finalizeSodiumCritical(orderedTestId);

      const schedulerConn = createDb(process.env.SCHEDULER_DATABASE_URL, {
        max: 1,
      });
      const rows = await schedulerConn
        .select({ tenantId: criticalNotification.tenantId })
        .from(criticalNotification);
      expect(rows.some((r) => r.tenantId === TENANT_A)).toBe(true);

      await expect(
        schedulerConn.select().from(criticalNotification),
      ).rejects.toThrow();
    });

    it('cannot read any other table', async () => {
      const schedulerConn = createDb(process.env.SCHEDULER_DATABASE_URL, {
        max: 1,
      });
      await expect(schedulerConn.select().from(observation)).rejects.toThrow();
    });

    it('sees zero rows once a notification is acknowledged (policy restricted to status = pending)', async () => {
      // lis_scheduler has no grant on the `id` column at all (only
      // tenant_id/created_at, per 0018/0020) -- filtering WHERE id = ...
      // would itself be a permission-denied query, the same class of bug
      // this file's own escalation tests just found for `created_at`. This
      // test isolates "this run's own row" via a created_at lower-bound
      // instead, using only granted columns.
      const testStartedAt = new Date();
      const { orderId, orderedTestId } = await createOrder();
      await receive(orderId);
      const observationId = await finalizeSodiumCritical(orderedTestId);
      const [notification] = await notificationsForObservation(observationId);

      const schedulerConn = createDb(process.env.SCHEDULER_DATABASE_URL, {
        max: 1,
      });
      const beforeAck = await schedulerConn
        .select({ tenantId: criticalNotification.tenantId })
        .from(criticalNotification)
        .where(gt(criticalNotification.createdAt, testStartedAt));
      expect(beforeAck.some((r) => r.tenantId === TENANT_A)).toBe(true);

      await request(app.getHttpServer())
        .post(`/v1/critical-notifications/${notification.id}/acknowledge`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'confirmed' })
        .expect(200);

      const afterAck = await schedulerConn
        .select({ tenantId: criticalNotification.tenantId })
        .from(criticalNotification)
        .where(gt(criticalNotification.createdAt, testStartedAt));
      expect(afterAck).toHaveLength(0);
    });
  });
});
