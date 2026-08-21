import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  analyte,
  auditEvent,
  codeSystemValue,
  controlLot,
  createDb,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
// Deliberately NOT a real seeded analyte (e.g. Sodium/BUN/GLU): every real
// analyte is shared, tenant-wide state (ADR-0019 Decision 2 scopes the gate
// by analyteId alone), and this file's first draft used BUN/GLU directly --
// which broke the very first real run. qc-westgard.e2e-spec.ts's own
// "Westgard rule evaluation" describe block grabs `SELECT id FROM analyte
// LIMIT 10` (an arbitrary, non-deterministic slice of the seeded catalog)
// and deliberately never resolves what it creates (no resolve lifecycle
// existed before this task) -- BUN/GLU happened to fall inside that slice,
// so this file's own gate/resolve assertions collided with qc-westgard's
// leftover, permanently-unresolved rejection violations on the exact same
// analytes, in the same shared Postgres (not reset between spec files).
// Two synthetic, dedicated quantity analytes -- find-or-create by fixed
// code, matching observation.e2e-spec.ts's own TASK-051-SYNTH-CODED/TEXT
// precedent exactly -- make this file's own gate state structurally
// impossible for any other spec to ever touch.
const HELD_TEST_CODE = 'TASK-070-QC-GATE-HELD';
const UNRELATED_TEST_CODE = 'TASK-070-QC-GATE-UNRELATED';
const HELD_ANALYTE_NORMAL_VALUE = 15; // arbitrary -- no reference_range exists for a synthetic analyte, so no flags/criticals ever fire
const UNRELATED_ANALYTE_NORMAL_VALUE = 15;

interface RecordResultResponse {
  resourceId: string;
  after: {
    violations: { id: string; ruleCode: string; severity: string }[];
  };
}

interface ResolveResponse {
  resourceId: string;
  after: {
    id: string;
    resolvedAt: string | null;
    resolvedByUserId: string | null;
  };
}

/**
 * TASK-070 (FEAT-020, docs/plans/feat-020-qc-gating-of-result-release.md,
 * ADR-0019). Real Nest app, real Keycloak tokens, real Postgres, matching
 * critical-notification.e2e-spec.ts's own standard for anything mutating
 * clinical data. Proves the gate half (`FinalizationRollupInterceptor`'s new
 * third check) and the resolve half (`POST /v1/qc-rule-violations/:id/resolve`)
 * together, since ADR-0019 treats them as one small, tightly coupled unit
 * (proposal §1).
 */
describe('QC release gate + resolve action (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user, TENANT_A -- technologist, enter_result only
  let verifierToken: string; // test-user-4, TENANT_A -- technologist + verifier, no resolve_qc
  let qaToken: string; // test-user-5, TENANT_A -- qa, resolve_qc only (ADR-0019 Decision 3)
  // Deliberately test-user-6, not test-user-2: test-user-2 (TENANT_B) carries
  // only 'pathologist', which CapabilityGuard would reject with 403 before ever
  // reaching the tenant-scoped lookup -- proving the cross-tenant 404 needs a
  // second tenant's principal that actually holds resolve_qc (infra/keycloak/
  // README.md's own note on this).
  let qaTokenB: string; // test-user-6, TENANT_B -- qa, proves cross-tenant 404 on resolve
  let patientId: string;
  let heldAnalyteId: string;
  let unrelatedAnalyteId: string;
  let unitId: string;

  async function createOrder(
    testCode: string,
  ): Promise<{ orderId: string; orderedTestId: string }> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    const found = catalog.tests.find((t) => t.code === testCode);
    if (!found) {
      throw new Error(`expected catalog fixture '${testCode}' in /v1/catalog`);
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

  async function finalize(
    orderedTestId: string,
    analyteId: string,
    valueNum: number,
    expectedStatus: 200 | 409,
  ) {
    return request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum })
      .expect(expectedStatus);
  }

  async function orderedTestStatus(
    orderId: string,
    orderedTestId: string,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as { orderedTests: { id: string; status: string }[] };
    const found = body.orderedTests.find((t) => t.id === orderedTestId);
    if (!found) {
      throw new Error(
        `ordered test ${orderedTestId} not found on order ${orderId}`,
      );
    }
    return found.status;
  }

  async function createLot(analyteId: string): Promise<string> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [lot] = await db
      .insert(controlLot)
      .values({
        tenantId: TENANT_A,
        analyteId,
        level: 'normal',
        unitId,
        targetMean: '5.0',
        targetSd: '0.2',
        lotNumber: `QC-GATE-E2E-${Date.now()}-${Math.random()}`,
      })
      .returning();
    return lot.id;
  }

  async function postQcResult(
    lotId: string,
    valueNum: number,
  ): Promise<RecordResultResponse> {
    const res = await request(app.getHttpServer())
      .post(`/v1/control-lots/${lotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum })
      .expect(201);
    return res.body as RecordResultResponse;
  }

  async function resolveViolation(
    violationId: string,
    token: string,
    expectedStatus: number,
  ) {
    return request(app.getHttpServer())
      .post(`/v1/qc-rule-violations/${violationId}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(expectedStatus);
  }

  /** Creates one rejection-severity (1-3s, z=3.5) violation on a fresh lot
   * for the given analyte, returning its id. */
  async function createRejectionViolation(analyteId: string): Promise<string> {
    const lotId = await createLot(analyteId);
    const body = await postQcResult(lotId, 5.7); // z = 3.5 -> 1-3s rejection
    const violation = body.after.violations.find((v) => v.ruleCode === '1_3s');
    if (!violation) {
      throw new Error('expected a 1_3s rejection violation to be created');
    }
    return violation.id;
  }

  /** Find-or-create one synthetic, single-analyte quantity test_definition,
   * matching observation.e2e-spec.ts's own TASK-051-SYNTH precedent. No
   * reference_range row is ever created for these analytes -- deliberately,
   * so finalize() never has anything to flag/criticals-gate on, isolating
   * every test in this file to the QC gate alone. */
  async function findOrCreateSyntheticQuantityTest(
    db: ReturnType<typeof createDb>,
    csvCode: string,
    testCode: string,
  ): Promise<string> {
    await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: csvCode,
        version: '1',
        display: `TASK-070 synthetic quantity analyte (non-clinical, spec-local only)`,
      })
      .onConflictDoNothing();
    const [csv] = await db
      .select({ id: codeSystemValue.id })
      .from(codeSystemValue)
      .where(
        sql`${codeSystemValue.system} = 'TEST' AND ${codeSystemValue.code} = ${csvCode}`,
      )
      .limit(1);

    await db
      .insert(analyte)
      .values({
        codeSystemValueId: csv.id,
        display: `TASK-070 Synthetic Quantity Analyte (${csvCode})`,
        dataType: 'quantity',
      })
      .onConflictDoNothing();
    const [analyteRow] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .where(sql`${analyte.codeSystemValueId} = ${csv.id}`)
      .limit(1);

    await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: testCode,
        displayName: `TASK-070 Synthetic Test (${testCode})`,
      })
      .onConflictDoNothing();
    const [testDefRow] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        sql`${testDefinition.tenantId} = ${TENANT_A} AND ${testDefinition.code} = ${testCode}`,
      )
      .limit(1);

    await db
      .insert(testAnalyte)
      .values({
        tenantId: TENANT_A,
        testDefinitionId: testDefRow.id,
        analyteId: analyteRow.id,
      })
      .onConflictDoNothing();

    return analyteRow.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');
    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');
    qaToken = await getKeycloakToken('test-user-5', 'test-password-5');
    qaTokenB = await getKeycloakToken('test-user-6', 'test-password-6');

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
    if (!unitRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    unitId = unitRow.id;

    heldAnalyteId = await findOrCreateSyntheticQuantityTest(
      db,
      'TASK-070-QC-GATE-HELD-ANALYTE',
      HELD_TEST_CODE,
    );
    unrelatedAnalyteId = await findOrCreateSyntheticQuantityTest(
      db,
      'TASK-070-QC-GATE-UNRELATED-ANALYTE',
      UNRELATED_TEST_CODE,
    );

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'QC',
        lastName: 'Gate',
        sex: 'F',
        birthDate: '1975-03-10',
      })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks the rollup on an unresolved rejection violation, and resolving it clears the hold (ADR-0019 AC 1-2)', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);

    const { orderId, orderedTestId } = await createOrder(HELD_TEST_CODE);
    await receive(orderId);

    // finalize()'s own observation write still succeeds -- the gate's 409
    // is thrown from the second, independently-committed rollup transaction
    // (finalization-rollup.interceptor.ts's own header comment), so this
    // call 409s but the value is recorded.
    const heldRes = await finalize(
      orderedTestId,
      heldAnalyteId,
      HELD_ANALYTE_NORMAL_VALUE,
      409,
    );
    // ADR-0021 / issue #400: the QC-hold branch shares the exact same
    // post-commit-veto mechanism as the unacknowledged-critical branch
    // (already covered in observation.e2e-spec.ts) -- proves it got the
    // same panel_hold/heldObservation treatment, not just the branch #400
    // happened to reproduce.
    const heldProblem = heldRes.body as {
      code: string;
      reason?: string;
      heldObservation?: { valueNum: number | null; status: string };
    };
    expect(heldProblem.code).toBe('panel_hold');
    expect(heldProblem.reason).toBe('qc_violation');
    expect(heldProblem.heldObservation?.valueNum).toBe(
      HELD_ANALYTE_NORMAL_VALUE,
    );
    expect(heldProblem.heldObservation?.status).toBe('preliminary');
    expect(await orderedTestStatus(orderId, orderedTestId)).not.toBe(
      'resulted',
    );

    await resolveViolation(violationId, qaToken, 200);

    await finalize(
      orderedTestId,
      heldAnalyteId,
      HELD_ANALYTE_NORMAL_VALUE,
      200,
    );
    expect(await orderedTestStatus(orderId, orderedTestId)).toBe('resulted');
  });

  it('never gates on a warning-only (1-2s alone) violation', async () => {
    const lotId = await createLot(heldAnalyteId);
    const body = await postQcResult(lotId, 5.46); // z = 2.3 -> 1-2s warning only
    expect(body.after.violations.every((v) => v.severity === 'warning')).toBe(
      true,
    );

    const { orderId, orderedTestId } = await createOrder(HELD_TEST_CODE);
    await receive(orderId);

    await finalize(
      orderedTestId,
      heldAnalyteId,
      HELD_ANALYTE_NORMAL_VALUE,
      200,
    );
    expect(await orderedTestStatus(orderId, orderedTestId)).toBe('resulted');
  });

  it('holds are scoped per analyte, not global -- an unrelated analyte completes normally while another is held', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);

    const { orderId, orderedTestId } = await createOrder(UNRELATED_TEST_CODE);
    await receive(orderId);
    await finalize(
      orderedTestId,
      unrelatedAnalyteId,
      UNRELATED_ANALYTE_NORMAL_VALUE,
      200,
    );
    expect(await orderedTestStatus(orderId, orderedTestId)).toBe('resulted');

    // Cleanup: don't leave an unresolved rejection violation on a real,
    // shared seeded analyte dangling past this test (see this file's own
    // header comment).
    await resolveViolation(violationId, qaToken, 200);
  });

  it('rejects an already-resolved violation with 409, not a silent overwrite', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);
    await resolveViolation(violationId, qaToken, 200);
    await resolveViolation(violationId, qaToken, 409);
  });

  it('resolve requires resolve_qc -- technologist and verifier are both denied, only qa is granted (ADR-0019 Decision 3)', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);

    await resolveViolation(violationId, tokenA, 403);
    await resolveViolation(violationId, verifierToken, 403);
    await resolveViolation(violationId, qaToken, 200);
  });

  it('a violation created under one tenant is invisible (404) to another tenant on resolve', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);

    await resolveViolation(violationId, qaTokenB, 404);

    // Cleanup under the owning tenant's own qa token.
    await resolveViolation(violationId, qaToken, 200);
  });

  it('resolve is audited, recording who and when', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);
    const res = await resolveViolation(violationId, qaToken, 200);
    const body = res.body as ResolveResponse;
    expect(body.after.resolvedAt).not.toBeNull();
    expect(body.after.resolvedByUserId).not.toBeNull();

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({ after: auditEvent.after })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, 'qc_rule_violation.resolve'),
          eq(auditEvent.resourceId, violationId),
        ),
      )
      .orderBy(desc(auditEvent.sequence))
      .limit(1);
    expect(row).toBeDefined();
    expect(
      (row?.after as { resolvedByUserId?: string | null } | null)
        ?.resolvedByUserId,
    ).not.toBeNull();
  });

  it('GET /v1/qc-rule-violations defaults to unresolved-only, and ?resolved=true surfaces what was just cleared', async () => {
    const violationId = await createRejectionViolation(heldAnalyteId);

    const unresolvedRes = await request(app.getHttpServer())
      .get('/v1/qc-rule-violations')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const unresolved = unresolvedRes.body as {
      id: string;
      analyteId: string;
      resolvedAt: string | null;
    }[];
    expect(unresolved.some((v) => v.id === violationId)).toBe(true);
    expect(unresolved.every((v) => v.resolvedAt === null)).toBe(true);
    expect(unresolved.find((v) => v.id === violationId)?.analyteId).toBe(
      heldAnalyteId,
    );

    await resolveViolation(violationId, qaToken, 200);

    const afterResolveRes = await request(app.getHttpServer())
      .get('/v1/qc-rule-violations')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const stillUnresolved = afterResolveRes.body as { id: string }[];
    expect(stillUnresolved.some((v) => v.id === violationId)).toBe(false);

    const resolvedRes = await request(app.getHttpServer())
      .get('/v1/qc-rule-violations')
      .query({ resolved: 'true' })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const resolved = resolvedRes.body as {
      id: string;
      resolvedAt: string | null;
    }[];
    expect(resolved.some((v) => v.id === violationId)).toBe(true);
    expect(
      resolved.find((v) => v.id === violationId)?.resolvedAt,
    ).not.toBeNull();
  });
});
