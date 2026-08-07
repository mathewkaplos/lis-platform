import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  analyte,
  auditEvent,
  controlLot,
  createDb,
  observation,
  order,
  orderedTest,
  patient,
  specimen,
  specimenFulfillment,
  testDefinition,
  unit,
} from '@lis/db';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-063 (FEAT-018): proves ADR-0015's schema mechanism against real
 * Postgres -- control_lot's own RLS isolation, and the chk_observation_subject
 * CHECK constraint enforcing every observation row is unambiguously a patient
 * result or a QC result, never neither, never both. No HTTP endpoint exists
 * yet (this task's own scope is schema/migration only, per the approved
 * proposal §2) -- same direct-`@lis/db` pattern as
 * reference-range-resolution.e2e-spec.ts (TASK-049) and
 * rls-isolation-check.ts (TASK-024), living under apps/api/test/ so it runs
 * under CI's existing `pnpm --filter api test:e2e` step.
 *
 * TENANT_A is the chemistry-catalog seed's fixed tenant, same as every other
 * spec in this suite. TENANT_B is a dedicated tenant used only by this file's
 * own RLS negative test, never written to by anything else.
 */
describe('control_lot schema (e2e)', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  const TENANT_B = '00000000-0000-0000-0000-000000000099';

  // max: 1 -- same reasoning as reference-range-resolution.e2e-spec.ts: a
  // single physical connection for the whole spec, so set_config() can't be
  // silently dropped by a different pooled connection picking up a later
  // query.
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  async function setTenant(tenantId: string) {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`,
    );
  }

  beforeAll(async () => {
    await setTenant(TENANT_A);
  });

  describe('RLS isolation', () => {
    it('a control_lot row created under one tenant is invisible to another tenant session', async () => {
      await setTenant(TENANT_A);
      const [analyteRow] = await db
        .select({ id: analyte.id })
        .from(analyte)
        .limit(1);
      const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
      if (!analyteRow || !unitRow) {
        throw new Error(
          'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
        );
      }

      const [lot] = await db
        .insert(controlLot)
        .values({
          tenantId: TENANT_A,
          analyteId: analyteRow.id,
          level: 'normal',
          unitId: unitRow.id,
          targetMean: '5.0',
          targetSd: '0.2',
          lotNumber: `CONTROL-LOT-RLS-${Date.now()}`,
        })
        .returning();

      await setTenant(TENANT_A);
      const visibleToOwnTenant = await db
        .select()
        .from(controlLot)
        .where(eq(controlLot.id, lot.id));
      expect(visibleToOwnTenant).toHaveLength(1);

      await setTenant(TENANT_B);
      const visibleToWrongTenant = await db
        .select()
        .from(controlLot)
        .where(eq(controlLot.id, lot.id));
      expect(visibleToWrongTenant).toHaveLength(0);

      await setTenant(TENANT_A);
    });
  });

  // drizzle wraps the real Postgres error (which names the violated
  // constraint) in DrizzleQueryError.cause -- the top-level .message is just
  // "Failed query: insert into ...", so the constraint name must be checked
  // against .cause.message, not asserted via .rejects.toThrow() directly.
  async function expectCheckViolation(insert: Promise<unknown>) {
    let caught: unknown;
    try {
      await insert;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('chk_observation_subject');
  }

  describe('chk_observation_subject CHECK constraint', () => {
    // Shared fixtures for the patient-flow shape (mirrors
    // rls-isolation-check.ts's own insertFixtures).
    async function createPatientFlowFixtures() {
      const [testDef] = await db
        .select()
        .from(testDefinition)
        .where(sql`tenant_id = ${TENANT_A}`)
        .limit(1);
      const [analyteRow] = await db
        .select({ id: analyte.id })
        .from(analyte)
        .limit(1);
      if (!testDef || !analyteRow) {
        throw new Error(
          'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
        );
      }
      const [pat] = await db
        .insert(patient)
        .values({
          tenantId: TENANT_A,
          mrn: `CHK-TEST-${Date.now()}`,
          firstName: 'Chk',
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
          testDefinitionId: testDef.id,
        })
        .returning();
      const [sp] = await db
        .insert(specimen)
        .values({
          tenantId: TENANT_A,
          accessionNumber: `CHK-TEST-${Date.now()}`,
          specimenType: 'blood_edta',
        })
        .returning();
      await db.insert(specimenFulfillment).values({
        tenantId: TENANT_A,
        specimenId: sp.id,
        orderedTestId: ot.id,
      });
      return {
        patientId: pat.id,
        orderedTestId: ot.id,
        specimenId: sp.id,
        analyteId: analyteRow.id,
      };
    }

    async function createControlLot() {
      const [analyteRow] = await db
        .select({ id: analyte.id })
        .from(analyte)
        .limit(1);
      const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
      const [lot] = await db
        .insert(controlLot)
        .values({
          tenantId: TENANT_A,
          analyteId: analyteRow.id,
          level: 'normal',
          unitId: unitRow.id,
          targetMean: '5.0',
          targetSd: '0.2',
          lotNumber: `CHK-TEST-${Date.now()}`,
        })
        .returning();
      return { controlLotId: lot.id, analyteId: analyteRow.id };
    }

    it('accepts a valid patient-shaped row (isControl=false, patientId set, controlLotId null)', async () => {
      await setTenant(TENANT_A);
      const { patientId, orderedTestId, specimenId, analyteId } =
        await createPatientFlowFixtures();

      const [row] = await db
        .insert(observation)
        .values({
          tenantId: TENANT_A,
          orderedTestId,
          analyteId,
          specimenId,
          patientId,
          dataType: 'quantity',
          valueNum: '5.0',
          source: 'manual',
        })
        .returning();

      expect(row.isControl).toBe(false);
      expect(row.patientId).toBe(patientId);
      expect(row.controlLotId).toBeNull();
    });

    it('accepts a valid QC-shaped row (isControl=true, controlLotId set, patientId/orderedTestId/specimenId null)', async () => {
      await setTenant(TENANT_A);
      const { controlLotId, analyteId } = await createControlLot();

      const [row] = await db
        .insert(observation)
        .values({
          tenantId: TENANT_A,
          analyteId,
          isControl: true,
          controlLotId,
          dataType: 'quantity',
          valueNum: '5.1',
          source: 'manual',
        })
        .returning();

      expect(row.isControl).toBe(true);
      expect(row.controlLotId).toBe(controlLotId);
      expect(row.patientId).toBeNull();
      expect(row.orderedTestId).toBeNull();
      expect(row.specimenId).toBeNull();
    });

    it('rejects isControl=false with controlLotId set (contradicts the patient shape)', async () => {
      await setTenant(TENANT_A);
      const { patientId, orderedTestId, specimenId, analyteId } =
        await createPatientFlowFixtures();
      const { controlLotId } = await createControlLot();

      await expectCheckViolation(
        db.insert(observation).values({
          tenantId: TENANT_A,
          orderedTestId,
          analyteId,
          specimenId,
          patientId,
          controlLotId, // contradiction: isControl is false (default) but controlLotId is set
          dataType: 'quantity',
          valueNum: '5.0',
          source: 'manual',
        }),
      );
    });

    it('rejects isControl=true with patientId set (contradicts the QC shape)', async () => {
      await setTenant(TENANT_A);
      const { patientId, analyteId } = await createPatientFlowFixtures();
      const { controlLotId } = await createControlLot();

      await expectCheckViolation(
        db.insert(observation).values({
          tenantId: TENANT_A,
          analyteId,
          isControl: true,
          controlLotId,
          patientId, // contradiction: isControl is true but patientId is also set
          dataType: 'quantity',
          valueNum: '5.0',
          source: 'manual',
        }),
      );
    });
  });
});

/**
 * TASK-064 (FEAT-018 revision): the real HTTP surface over TASK-063's
 * schema -- `POST/GET /v1/control-lots/:id/results`. Real Nest app, real
 * Keycloak tokens, real Postgres, matching observation.e2e-spec.ts's own
 * standard for anything mutating clinical data.
 */
describe('Control lot QC result API (e2e)', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string; // test-user-2, TENANT_B -- proves cross-tenant 404 (engineering/api-design entry #7)
  let controlLotId: string;
  let quantityAnalyteId: string;

  async function auditAfterFor(
    action: string,
    resourceId: string,
  ): Promise<unknown> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({ after: auditEvent.after })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, action),
          eq(auditEvent.resourceId, resourceId),
        ),
      )
      .orderBy(desc(auditEvent.sequence))
      .limit(1);
    return row?.after ?? null;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');
    tokenB = await getKeycloakToken('test-user-2', 'test-password-2');

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [analyteRow] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .limit(1);
    const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
    if (!analyteRow || !unitRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    quantityAnalyteId = analyteRow.id;
    const [lot] = await db
      .insert(controlLot)
      .values({
        tenantId: TENANT_A,
        analyteId: analyteRow.id,
        level: 'normal',
        unitId: unitRow.id,
        targetMean: '5.0',
        targetSd: '0.2',
        lotNumber: `TASK-064-HTTP-${Date.now()}`,
      })
      .returning();
    controlLotId = lot.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .post(`/v1/control-lots/${controlLotId}/results`)
      .send({ dataType: 'quantity', valueNum: 5.2 })
      .expect(401);
  });

  it('records a QC result and returns it with controlLotId, not orderedTestId/patientId', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/control-lots/${controlLotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 5.2 })
      .expect(201);

    const body = res.body as {
      resourceId: string;
      after: {
        id: string;
        controlLotId: string;
        analyteId: string;
        dataType: string;
        valueNum: number;
        source: string;
      };
    };
    expect(body.after.controlLotId).toBe(controlLotId);
    expect(body.after.analyteId).toBe(quantityAnalyteId);
    expect(body.after.dataType).toBe('quantity');
    expect(body.after.valueNum).toBe(5.2);
    expect(body.after.source).toBe('manual');
    expect(body.after).not.toHaveProperty('orderedTestId');
    expect(body.after).not.toHaveProperty('patientId');
    expect(body.resourceId).toBe(body.after.id);

    // Audited (ADR-0015's own Consequences note) -- proven against the real
    // persisted audit_event row, not just trusted from the response.
    const after = await auditAfterFor('observation.qc_record', body.resourceId);
    expect(after).not.toBeNull();
  });

  it("rejects a dataType mismatch against the control lot analyte's own catalog dataType", async () => {
    await request(app.getHttpServer())
      .post(`/v1/control-lots/${controlLotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'coded', valueCode: 'POS' })
      .expect(400);
  });

  it('404s on a control lot that does not exist', async () => {
    await request(app.getHttpServer())
      .get(`/v1/control-lots/${randomUUID()}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  it("404s on another tenant's control lot -- cross-tenant existence is never leaked (engineering/api-design entry #7)", async () => {
    await request(app.getHttpServer())
      .get(`/v1/control-lots/${controlLotId}/results`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('every POST is a new row, never an upsert -- multiple results for the same lot all persist as a real time series, most recent first', async () => {
    const first = await request(app.getHttpServer())
      .post(`/v1/control-lots/${controlLotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 4.9 })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/v1/control-lots/${controlLotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 5.3 })
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/control-lots/${controlLotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = listRes.body as { id: string }[];
    const ids = body.map((r) => r.id);

    const firstId = (first.body as { resourceId: string }).resourceId;
    const secondId = (second.body as { resourceId: string }).resourceId;

    // Both new rows present alongside every earlier result this describe
    // block already created for the same lot -- proves accumulation, not
    // replacement.
    expect(ids).toContain(firstId);
    expect(ids).toContain(secondId);
    expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));
  });
});
