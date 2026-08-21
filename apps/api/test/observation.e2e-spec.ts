import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  codeSystemValue,
  controlLot,
  createDb,
  observation,
  patient,
  resultHistory,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';
const BUN_CODE = 'BUN';
const SODIUM_CODE = 'NA';
const POTASSIUM_CODE = 'K';
// TASK-055: LIPID (db/seed/chemistry-catalog.sql step 12) is the one seeded
// test_definition with more than one test_analyte link (Total Cholesterol,
// HDL, Triglycerides, plus the calculated LDL) -- needed so an ordered test
// stays 'in_process' (enterable) after only one of its analytes is
// finalized/verified, isolating upsertObservation's own new verified-row
// pre-check from the unrelated ordered_test-status guard that would
// otherwise also produce a 409 once every analyte is finalized.
const LIPID_CODE = 'LIPID';
const TOTAL_CHOLESTEROL_LOINC = '2093-3';
// TASK-056: synthetic test_definition code for the Sodium+BUN two-analyte
// panel created in beforeAll below (see its own comment there for why).
const SODIUM_BUN_SYNTH_PANEL_CODE = 'TASK-056-SYNTH-PANEL';

/**
 * TASK-051 (FEAT-014 revision): first real writer to `observation`, first
 * real HTTP caller of `resolveObservationRange`/`computeFlags` (TASK-049/
 * 050). Real Keycloak tokens, real Postgres, matching order.e2e-spec.ts's
 * own standard for anything mutating clinical data.
 *
 * Two synthetic (non-clinical) `coded`/`text` catalog fixtures are inserted
 * directly via `@lis/db` (proposal §4/§8) -- no admin endpoint exists to
 * create a `test_definition`/`analyte` through HTTP, and the seeded
 * chemistry catalog is 14/14 `quantity` (`domain/clinical-chemistry` entry
 * #6). Everything else in this spec goes through the real HTTP stack.
 */
describe('Result entry API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  // TASK-055: test-user-4 carries both 'technologist' and 'pathologist' realm
  // roles under the SAME tenant (TENANT_A) as tokenA/test-user (infra/
  // keycloak/lis-realm.json) -- test-user-2, the other seeded verifier, is
  // deliberately in TENANT_B (rls-isolation-check.ts's own convention), so
  // it can never see this spec's own TENANT_A fixtures. test-user-4 is the
  // only seeded user that can both enter and verify a result in one tenant.
  let verifierToken: string;
  let patientId: string;
  // Fixed, not per-run-unique: repeated local runs (unlike CI's always-fresh
  // Postgres) reuse the same synthetic rows via find-or-create below, rather
  // than accumulating a new test_definition/analyte pair on every run.
  const codedTestCode = 'TASK-051-SYNTH-CODED';
  const textTestCode = 'TASK-051-SYNTH-TEXT';

  async function createOrder(
    testCodes: string[],
  ): Promise<{ orderId: string; orderedTestIds: string[] }> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    const testDefinitionIds = testCodes.map((code) => {
      const found = catalog.tests.find((t) => t.code === code);
      if (!found) {
        throw new Error(`expected catalog fixture '${code}' in /v1/catalog`);
      }
      return found.id;
    });

    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds })
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    return {
      orderId: body.resourceId,
      orderedTestIds: body.after.orderedTests.map((t) => t.id),
    };
  }

  async function receive(orderId: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'serum' })
      .expect(201);
  }

  async function auditCount(): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  /**
   * TASK-054 (FEAT-015 proposal §7/§8): reads the real, persisted
   * `audit_event.after` jsonb payload for the most recent
   * `observation.finalize` event on a given observation id -- not just the
   * HTTP response body, which (per audit.interceptor.ts) happens to be the
   * exact same object `writeAuditEvent` was called with, but proving the
   * new `criticalDetected` field against the actual audited row is the
   * stronger, direct claim TASK-054's own AC asks for.
   */
  async function latestFinalizeAuditAfter(
    resourceId: string,
  ): Promise<{ criticalDetected?: boolean } | null> {
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
          eq(auditEvent.resourceId, resourceId),
        ),
      )
      .orderBy(desc(auditEvent.sequence))
      .limit(1);
    return (row?.after as { criticalDetected?: boolean } | null) ?? null;
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
    if (!found)
      throw new Error(
        `ordered test ${orderedTestId} not found on order ${orderId}`,
      );
    return found.status;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');
    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Result',
        lastName: 'Entry',
        sex: 'F',
        birthDate: '1985-06-15',
      })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;

    // Synthetic coded/text catalog fixtures (non-clinical, spec-local only) --
    // direct @lis/db access, no admin endpoint exists to create these. Find-
    // or-create by natural key (fixed codes above), matching
    // db/seed/chemistry-catalog.sql's own idempotent-insert convention, so
    // repeated local runs reuse one row instead of accumulating garbage.
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    for (const { csvCode, dataType, testCode } of [
      {
        csvCode: 'TASK-051-SYNTH-CODED-ANALYTE',
        dataType: 'coded',
        testCode: codedTestCode,
      },
      {
        csvCode: 'TASK-051-SYNTH-TEXT-ANALYTE',
        dataType: 'text',
        testCode: textTestCode,
      },
    ] as const) {
      await db
        .insert(codeSystemValue)
        .values({
          system: 'TEST',
          code: csvCode,
          version: '1',
          display: `TASK-051 synthetic ${dataType} analyte (non-clinical, spec-local only)`,
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
          display: `TASK-051 Synthetic ${dataType} Analyte`,
          dataType,
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
          displayName: `TASK-051 Synthetic ${dataType} Test`,
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
    }

    // TASK-056 (FEAT-015 revision, #115): a synthetic two-analyte panel
    // wrapping two ALREADY-SEEDED analytes -- Sodium (one of only 4
    // golden-dataset analytes with a real critical row, `domain/
    // critical-values` entry #3) and BUN (ordinary, no critical row) --
    // under one new test_definition. Needed because every seeded
    // single-analyte chemistry test_definition makes its own analyte
    // trivially "the panel's last remaining analyte" the instant it's
    // finalized at all (no room for a distinct, earlier finalize of a
    // *different* analyte first), and LIPID (the only seeded multi-analyte
    // test_definition) has no analyte with a critical row at all -- neither
    // existing shape can exercise "verify a critical analyte, then finalize
    // a later, different analyte on the same panel," which this task's own
    // positive-path test needs. Synthetic test_definition/test_analyte rows
    // only; no new analyte/code_system_value rows (both already exist).
    await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: SODIUM_BUN_SYNTH_PANEL_CODE,
        displayName:
          'TASK-056 Synthetic Sodium+BUN Panel (non-clinical composition of two real, already-seeded analytes)',
      })
      .onConflictDoNothing();
    const [synthPanelDef] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        sql`${testDefinition.tenantId} = ${TENANT_A} AND ${testDefinition.code} = ${SODIUM_BUN_SYNTH_PANEL_CODE}`,
      )
      .limit(1);

    for (const testCode of [SODIUM_CODE, BUN_CODE]) {
      const [linkedAnalyte] = await db
        .select({ analyteId: testAnalyte.analyteId })
        .from(testAnalyte)
        .innerJoin(
          testDefinition,
          sql`${testAnalyte.testDefinitionId} = ${testDefinition.id}`,
        )
        .where(sql`${testDefinition.code} = ${testCode}`)
        .limit(1);
      await db
        .insert(testAnalyte)
        .values({
          tenantId: TENANT_A,
          testDefinitionId: synthPanelDef.id,
          analyteId: linkedAnalyte.analyteId,
        })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('drafts a quantity result: live flags computed and snapshotted, ordered_test received -> in_process, unaudited', async () => {
    // Sodium (NA), not Glucose: Glucose's only 'normal' row requires
    // condition:'fasting' (db/seed/chemistry-catalog.sql) and this API has
    // no field to submit clinical context like fasting state (proposal
    // §11 finding) -- Sodium's normal range has no condition/sex dimension,
    // so it resolves regardless. Glucose is still used below for the
    // critical-value case, since its critical rows are condition-wildcard.
    const { orderId, orderedTestIds } = await createOrder([SODIUM_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;
    const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

    const before = await auditCount();

    const res = await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 140 })
      .expect(200);
    const body = res.body as {
      dataType: string;
      valueNum: number;
      flags: string[];
      status: string;
      refLow: number | null;
      refHigh: number | null;
    };
    if (body.dataType !== 'quantity' || body.valueNum !== 140) {
      throw new Error(`unexpected draft body: ${JSON.stringify(body)}`);
    }
    if (JSON.stringify(body.flags) !== JSON.stringify(['N'])) {
      throw new Error(
        `expected ['N'] for an in-range value, got ${JSON.stringify(body.flags)}`,
      );
    }
    if (body.status !== 'registered') {
      throw new Error(`expected draft status 'registered', got ${body.status}`);
    }
    if (body.refLow !== 136 || body.refHigh !== 145) {
      throw new Error(
        `expected the real Sodium normal range 136/145 snapshotted, got ${body.refLow}/${body.refHigh}`,
      );
    }

    const status = await orderedTestStatus(orderId, orderedTestId);
    if (status !== 'in_process') {
      throw new Error(
        `expected ordered_test 'in_process' after first draft, got '${status}'`,
      );
    }

    const after = await auditCount();
    if (after !== before) {
      throw new Error(
        `expected draft to be unaudited, before=${before} after=${after}`,
      );
    }
  });

  it('a critical value flags HH/LL live, on draft, before any finalize', async () => {
    const { orderId, orderedTestIds } = await createOrder([GLUCOSE_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;

    const res = await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${await glucoseAnalyteId()}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 600 })
      .expect(200);
    const body = res.body as { flags: string[] };
    if (JSON.stringify(body.flags) !== JSON.stringify(['HH'])) {
      throw new Error(
        `expected ['HH'] for a critical-high value, got ${JSON.stringify(body.flags)}`,
      );
    }
  });

  it('finalizes without a prior draft (type-and-finalize in one call), audited, ordered_test -> resulted', async () => {
    const { orderId, orderedTestIds } = await createOrder([BUN_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;
    const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

    const before = await auditCount();

    const res = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 15 })
      .expect(200);
    const body = res.body as {
      resourceId: string;
      // TASK-053 (FEAT-014 revision §1 finding #4): finalize()'s before/
      // after are always { observation, calculatedDependent } now, uniform
      // whether or not this call cascades a calculated recompute.
      before: { observation: unknown; calculatedDependent: unknown };
      after: {
        observation: { status: string; flags: string[] };
        calculatedDependent: unknown;
      };
    };
    if (body.before.observation !== null) {
      throw new Error(
        `expected null before.observation (no prior draft), got ${JSON.stringify(body.before.observation)}`,
      );
    }
    if (body.after.observation.status !== 'preliminary') {
      throw new Error(
        `expected finalize status 'preliminary', got ${body.after.observation.status}`,
      );
    }

    const status = await orderedTestStatus(orderId, orderedTestId);
    if (status !== 'resulted') {
      throw new Error(
        `expected ordered_test 'resulted' once its one analyte is finalized, got '${status}'`,
      );
    }

    const after = await auditCount();
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row for finalize, before=${before} after=${after}`,
      );
    }

    // Further writes are rejected once resulted.
    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 16 })
      .expect(409);
  });

  /**
   * TASK-054 (FEAT-015, #113) originally, updated by TASK-056 (#115): Sodium
   * is a single-analyte panel (its own test_definition has exactly one
   * test_analyte link), so finalizing it at all is *also* always "the
   * panel's last remaining analyte" -- meaning this exact call is now the
   * literal scenario TASK-056's own finalization-block guard exists to
   * catch (no prior `verify()` call on a real critical value). The response
   * is therefore now 409, not 200 (`FinalizationRollupInterceptor`), while
   * the observation write and its `observation.finalize` audit event
   * (including `criticalDetected: true`) still commit normally underneath
   * it -- proposal §10 Q1's resolved transactional sub-question, proven here
   * directly against the database, not just inferred from the HTTP status.
   * See the dedicated "Finalization block on unacknowledged critical (409)"
   * describe block below for the full positive/negative TASK-056 coverage.
   */
  it("finalizing a real critical (LL) value as a panel's last remaining analyte, unverified, is rejected 409 -- but the observation write and its audit event still commit", async () => {
    const { orderId, orderedTestIds } = await createOrder([SODIUM_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;
    const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

    const before = await auditCount();

    const res = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 115 }) // real Sodium critical-low threshold is 120
      .expect(409);
    const problem = res.body as { detail: string };
    if (!/critical/i.test(problem.detail) || !/1\b/.test(problem.detail)) {
      throw new Error(
        `expected a generic 409 detail naming 1 pending critical, got ${JSON.stringify(problem.detail)}`,
      );
    }

    // The audit_event row for this finalize still commits -- only the
    // ordered_test roll-up is blocked, not the whole request's transaction.
    const after = await auditCount();
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row for finalize even though the call itself 409s, before=${before} after=${after}`,
      );
    }

    // Look the observation up directly (the 409 response carries no
    // resourceId) to prove the write itself was persisted, per this task's
    // own resolved decision.
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({
        id: observation.id,
        status: observation.status,
        flags: observation.flags,
      })
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, orderedTestId),
          eq(observation.analyteId, sodiumAnalyteId),
        ),
      )
      .limit(1);
    if (!row || row.status !== 'preliminary') {
      throw new Error(
        `expected the observation write to persist as 'preliminary' despite the 409, got ${JSON.stringify(row)}`,
      );
    }
    if (JSON.stringify(row.flags) !== JSON.stringify(['LL'])) {
      throw new Error(
        `expected ['LL'] for 115 (below the real 120 critical-low threshold), got ${JSON.stringify(row.flags)}`,
      );
    }

    const auditAfter = await latestFinalizeAuditAfter(row.id);
    if (auditAfter?.criticalDetected !== true) {
      throw new Error(
        `expected the persisted audit_event.after payload to still carry criticalDetected: true, got ${JSON.stringify(auditAfter)}`,
      );
    }

    // Only the ordered_test roll-up itself is blocked.
    const status = await orderedTestStatus(orderId, orderedTestId);
    if (status === 'resulted') {
      throw new Error(
        `expected ordered_test NOT to advance to 'resulted' while the critical is unacknowledged, got '${status}'`,
      );
    }
  });

  /**
   * TASK-054 negative case: a non-critical finalize must not report
   * `criticalDetected: true` -- proves the field is a real, conditional
   * signal, not one that's always true regardless of the observation's
   * own flags.
   */
  it('finalizing a normal (non-critical) value sets criticalDetected:false on the finalize audit event', async () => {
    const { orderId, orderedTestIds } = await createOrder([SODIUM_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;
    const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

    const res = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 140 }) // within the real 136/145 normal range
      .expect(200);
    const body = res.body as {
      resourceId: string;
      after: { observation: { flags: string[] }; criticalDetected: boolean };
    };
    if (
      JSON.stringify(body.after.observation.flags) !== JSON.stringify(['N'])
    ) {
      throw new Error(
        `expected ['N'] for an in-range value, got ${JSON.stringify(body.after.observation.flags)}`,
      );
    }
    if (body.after.criticalDetected !== false) {
      throw new Error(
        `expected after.criticalDetected === false on the HTTP response, got ${JSON.stringify(body.after)}`,
      );
    }

    const auditAfter = await latestFinalizeAuditAfter(body.resourceId);
    if (auditAfter?.criticalDetected !== false) {
      throw new Error(
        `expected the persisted audit_event.after payload to carry criticalDetected: false, got ${JSON.stringify(auditAfter)}`,
      );
    }
  });

  /**
   * TASK-056 (FEAT-015, #115): Constitution Law #3's finalization block made
   * real. The guard lives in `FinalizationRollupInterceptor`, not inside
   * `finalize()`'s own request transaction (see that interceptor's own doc
   * comment) -- proposal §10 Q1's resolved reading: the `finalize()` call
   * that would complete a panel returns 409 itself while any critical on the
   * panel remains unverified, but the analyte's own observation write (and
   * its audit event) still commits regardless. Acknowledgement is exactly
   * TASK-055's `observation.status = 'verified'` (§10 Q2) -- no new column,
   * no new endpoint.
   */
  describe('Finalization block on unacknowledged critical (409) (TASK-056)', () => {
    /**
     * Positive path (proposal §7/§8, widened by TASK-066): the SAME real
     * critical (Sodium at 115, real critical-low threshold 120) that 409s
     * unverified above completes normally once BOTH verified AND its
     * `critical_notification` acknowledged -- proves the widened guard is
     * not permanently stuck, only conditional on the full acknowledgement
     * TASK-066 now requires (verification alone is no longer sufficient,
     * see the regression test right below this one). Uses the synthetic
     * Sodium+BUN panel (see beforeAll) so Sodium can be finalized, verified,
     * and acknowledged WHILE the panel still has a second, unfinalized
     * analyte (BUN) -- i.e. every acknowledgement step happens strictly
     * before the call that completes the panel.
     */
    it('a verified AND acknowledged critical no longer blocks the roll-up: the panel completes (200, resulted) (TASK-056, widened by TASK-066)', async () => {
      const { orderId, orderedTestIds } = await createOrder([
        SODIUM_BUN_SYNTH_PANEL_CODE,
      ]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);
      const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

      // Sodium finalizes first, critical (LL) -- NOT the panel's last
      // remaining analyte yet (BUN is still unfinalized), so this call is
      // unaffected by the guard (allFinalized is false) and succeeds 200.
      const sodiumRes = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 115 })
        .expect(200);
      const sodiumBody = sodiumRes.body as {
        after: { criticalNotificationId: string | null };
      };
      const criticalNotificationId = sodiumBody.after.criticalNotificationId;
      if (!criticalNotificationId) {
        throw new Error(
          `expected a criticalNotificationId on Sodium's own finalize response, got ${JSON.stringify(sodiumBody.after)}`,
        );
      }

      const midStatus = await orderedTestStatus(orderId, orderedTestId);
      if (midStatus === 'resulted') {
        throw new Error(
          `expected the panel NOT yet 'resulted' with BUN still unfinalized, got '${midStatus}'`,
        );
      }

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      // TASK-066: verification alone is no longer sufficient -- the
      // documented read-back must be captured too, before the panel is
      // complete.
      await request(app.getHttpServer())
        .post(
          `/v1/critical-notifications/${criticalNotificationId}/acknowledge`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ readBack: 'confirmed with on-call physician' })
        .expect(200);

      // BUN is now the panel's last remaining analyte -- the roll-up runs,
      // finds Sodium's critical both verified and acknowledged, and
      // completes normally.
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 15 })
        .expect(200);

      const finalStatus = await orderedTestStatus(orderId, orderedTestId);
      if (finalStatus !== 'resulted') {
        throw new Error(
          `expected ordered_test 'resulted' once BUN finalizes with Sodium's critical both verified and acknowledged, got '${finalStatus}'`,
        );
      }
    });

    /**
     * TASK-066's own regression test: proves the widening actually took
     * effect, not just that the already-covered verified+acknowledged case
     * above still passes. Identical setup to the positive-path test above,
     * except the read-back is never captured -- before TASK-066, this
     * exact scenario (verified, not acknowledged) returned 200/resulted;
     * after TASK-066, it must 409, since a verified-but-unacknowledged
     * critical no longer satisfies Constitution Law #3's own "documented
     * notification with read-back" clause.
     */
    it('a verified but NOT acknowledged critical still blocks the roll-up (TASK-066 widened gate)', async () => {
      const { orderId, orderedTestIds } = await createOrder([
        SODIUM_BUN_SYNTH_PANEL_CODE,
      ]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);
      const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 115 })
        .expect(200);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
      // No acknowledge() call -- the critical_notification stays 'pending'.

      const res = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 15 })
        .expect(409);
      const problem = res.body as { detail: string };
      if (
        !/critical/i.test(problem.detail) ||
        !/acknowledg/i.test(problem.detail)
      ) {
        throw new Error(
          `expected a 409 detail naming pending acknowledgement, got ${JSON.stringify(problem.detail)}`,
        );
      }

      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status === 'resulted') {
        throw new Error(
          `expected ordered_test NOT to advance to 'resulted' while verified-but-unacknowledged, got '${status}'`,
        );
      }
    });

    /**
     * Negative path, same synthetic panel: BUN finalizes last exactly as
     * above, but Sodium's critical is never verified first -- the last
     * analyte's own finalize call is rejected 409, and (same proof as the
     * inline Sodium-alone test above) the write persists and the panel does
     * not advance.
     */
    it("an unverified critical elsewhere on the panel blocks the last analyte's own finalize call with 409, panel stays not-resulted", async () => {
      const { orderId, orderedTestIds } = await createOrder([
        SODIUM_BUN_SYNTH_PANEL_CODE,
      ]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);
      const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 115 })
        .expect(200);
      // No verify() call on Sodium.

      const res = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 15 })
        .expect(409);
      const problem = res.body as {
        detail: string;
        code: string;
        reason?: string;
        heldObservation?: { valueNum: number | null; status: string };
      };
      if (!/critical/i.test(problem.detail)) {
        throw new Error(
          `expected a generic critical-pending 409 detail, got ${JSON.stringify(problem.detail)}`,
        );
      }
      // ADR-0021 / issue #400: the 409 body itself now proves the write
      // committed, in place of the DB re-query this test previously needed
      // to work around the 409 carrying no id at all.
      if (
        problem.code !== 'panel_hold' ||
        problem.reason !== 'unacknowledged_critical'
      ) {
        throw new Error(
          `expected code: 'panel_hold', reason: 'unacknowledged_critical', got ${JSON.stringify({ code: problem.code, reason: problem.reason })}`,
        );
      }
      if (
        problem.heldObservation?.valueNum !== 15 ||
        problem.heldObservation.status !== 'preliminary'
      ) {
        throw new Error(
          `expected the 409 body to echo BUN's own just-committed write (valueNum: 15, status: 'preliminary'), got ${JSON.stringify(problem.heldObservation)}`,
        );
      }

      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status === 'resulted') {
        throw new Error(
          `expected ordered_test NOT to advance to 'resulted', got '${status}'`,
        );
      }
    });

    /**
     * Regression case (proposal §7/§8's third bullet): a panel with no
     * critical analyte at all completes exactly as before this task --
     * zero behavior change for the overwhelming majority (10 of 14) of
     * golden-dataset analytes, per `domain/critical-values` entry #3.
     */
    it('a panel with no critical analyte at all is unaffected: completes 200/resulted exactly as before this task', async () => {
      const { orderId, orderedTestIds } = await createOrder([GLUCOSE_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const glucoseId = await glucoseAnalyteId();

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${glucoseId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 90 }) // ordinary, in-range
        .expect(200);

      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status !== 'resulted') {
        throw new Error(
          `expected ordered_test 'resulted' for a non-critical panel, unaffected by this task's guard, got '${status}'`,
        );
      }
    });
  });

  it("rejects result entry before specimen reception (ordered_test still 'ordered')", async () => {
    const { orderedTestIds } = await createOrder([GLUCOSE_CODE]);
    const [orderedTestId] = orderedTestIds;

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${await glucoseAnalyteId()}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 85 })
      .expect(409);
  });

  it("rejects a dataType mismatch against the analyte's own catalog dataType", async () => {
    const { orderId, orderedTestIds } = await createOrder([GLUCOSE_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${await glucoseAnalyteId()}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'text', valueText: 'not a number' })
      .expect(400);
  });

  it('persists coded and text results correctly per dataType (synthetic, non-clinical fixtures) -- the literal AC', async () => {
    const { orderId: codedOrderId, orderedTestIds: codedIds } =
      await createOrder([codedTestCode]);
    await receive(codedOrderId);
    const codedAnalyteId = await analyteIdForTestCode(codedTestCode);

    const codedRes = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${codedIds[0]}/results/${codedAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'coded', valueCode: 'detected' })
      .expect(200);
    const codedBody = codedRes.body as {
      after: {
        observation: {
          dataType: string;
          valueCode: string;
          valueNum: number | null;
          flags: string[];
        };
      };
    };
    if (
      codedBody.after.observation.dataType !== 'coded' ||
      codedBody.after.observation.valueCode !== 'detected'
    ) {
      throw new Error(
        `unexpected coded result: ${JSON.stringify(codedBody.after.observation)}`,
      );
    }
    if (
      codedBody.after.observation.valueNum !== null ||
      codedBody.after.observation.flags.length !== 0
    ) {
      throw new Error(
        `expected no range/flags for a coded result, got ${JSON.stringify(codedBody.after.observation)}`,
      );
    }

    const { orderId: textOrderId, orderedTestIds: textIds } = await createOrder(
      [textTestCode],
    );
    await receive(textOrderId);
    const textAnalyteId = await analyteIdForTestCode(textTestCode);

    const textRes = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${textIds[0]}/results/${textAnalyteId}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        dataType: 'text',
        valueText: 'Comment: sample slightly haemolysed',
      })
      .expect(200);
    const textBody = textRes.body as {
      after: { observation: { dataType: string; valueText: string } };
    };
    if (
      textBody.after.observation.dataType !== 'text' ||
      textBody.after.observation.valueText !==
        'Comment: sample slightly haemolysed'
    ) {
      throw new Error(
        `unexpected text result: ${JSON.stringify(textBody.after.observation)}`,
      );
    }
  });

  /**
   * TASK-053 (FEAT-014 revision) real finding: re-`draft`ing (or
   * re-`finalize`ing) the SAME analyte twice previously crashed with a 500 --
   * `upsertObservation`'s UPDATE branch keyed its WHERE clause on both `id`
   * AND `createdAt`, and `createdAt` (read back as a millisecond-precision
   * JS `Date`) never round-trips exactly back to the real microsecond-
   * precision `timestamptz` Postgres actually stored, so the UPDATE matched
   * zero rows. No test in this file (or TASK-051's own original suite) had
   * ever called draft/finalize twice on the same (orderedTestId, analyteId)
   * pair before TASK-053's own testing surfaced it. Fixed by keying the
   * UPDATE on `id` alone.
   */
  it('re-drafting the same analyte twice with a different value both succeeds and persists the latest value (regression: a prior UPDATE-matched-zero-rows bug)', async () => {
    const { orderId, orderedTestIds } = await createOrder([SODIUM_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;
    const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 138 })
      .expect(200);

    const secondRes = await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 142 })
      .expect(200);
    const secondBody = secondRes.body as { valueNum: number };
    if (secondBody.valueNum !== 142) {
      throw new Error(
        `expected the second draft's value (142) to persist, got ${secondBody.valueNum}`,
      );
    }

    const listRes = await request(app.getHttpServer())
      .get(`/v1/ordered-tests/${orderedTestId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const list = listRes.body as { analyteId: string; valueNum: number }[];
    if (list.length !== 1 || list[0].valueNum !== 142) {
      throw new Error(
        `expected exactly one observation row with the latest value, got ${JSON.stringify(list)}`,
      );
    }
  });

  it('lists current observations (draft and final) for an ordered test', async () => {
    const { orderId, orderedTestIds } = await createOrder([GLUCOSE_CODE]);
    await receive(orderId);
    const [orderedTestId] = orderedTestIds;
    const glucoseId = await glucoseAnalyteId();

    await request(app.getHttpServer())
      .put(`/v1/ordered-tests/${orderedTestId}/results/${glucoseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 90 })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/ordered-tests/${orderedTestId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const list = listRes.body as { analyteId: string; valueNum: number }[];
    if (
      list.length !== 1 ||
      list[0].analyteId !== glucoseId ||
      list[0].valueNum !== 90
    ) {
      throw new Error(`unexpected results list: ${JSON.stringify(list)}`);
    }
  });

  // Resolved once per suite run via the real /v1/catalog + a direct analyte
  // lookup keyed by the seeded Glucose LOINC display -- avoids hardcoding a
  // uuid that would only be valid after a specific db:reset run.
  let cachedGlucoseAnalyteId: string | undefined;
  async function glucoseAnalyteId(): Promise<string> {
    cachedGlucoseAnalyteId ??= await analyteIdForTestCode(GLUCOSE_CODE);
    return cachedGlucoseAnalyteId;
  }

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

  // TASK-055: `analyteIdForTestCode` resolves via a single test_definition ->
  // one analyte join, which is ambiguous for LIPID (4 linked analytes,
  // `.limit(1)` would return an arbitrary one) -- looked up by LOINC code
  // directly instead, the same join `findAnalyteByLoincCode` (the
  // controller's own private helper) uses internally.
  async function analyteIdForLoincCode(loincCode: string): Promise<string> {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({ analyteId: analyte.id })
      .from(analyte)
      .innerJoin(
        codeSystemValue,
        sql`${analyte.codeSystemValueId} = ${codeSystemValue.id}`,
      )
      .where(
        sql`${codeSystemValue.system} = 'LOINC' AND ${codeSystemValue.code} = ${loincCode}`,
      )
      .limit(1);
    if (!row) {
      throw new Error(`no analyte found for LOINC code '${loincCode}'`);
    }
    return row.analyteId;
  }

  /**
   * TASK-055 (FEAT-015 revision §7/§8): the verification action + the
   * upsertObservation append-only pre-check. A `verifier`-roled caller
   * (test-user-4) transitions a `'preliminary'` observation to `'verified'`;
   * a `technologist`-roled caller (tokenA) is rejected 403; verifying a
   * non-`'preliminary'` row (never finalized, or already verified) is
   * rejected 409; and once verified, `upsertObservation`'s new pre-check
   * (not the trigger itself) turns a later draft/finalize attempt against
   * the same analyte into a 409 rather than an unhandled 500.
   */
  describe('Verification action + append-only pre-check (TASK-055)', () => {
    it('a verifier transitions a preliminary observation to verified, with verifierUserId/verifiedAt set, audited', async () => {
      const { orderId, orderedTestIds } = await createOrder([BUN_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 15 })
        .expect(200);

      const before = await auditCount();

      const res = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
      const body = res.body as {
        resourceId: string;
        before: { observation: { status: string } | null };
        after: { observation: { status: string } };
      };
      if (body.after.observation.status !== 'verified') {
        throw new Error(
          `expected status 'verified' after verify, got ${JSON.stringify(body.after)}`,
        );
      }
      if (body.before.observation?.status !== 'preliminary') {
        throw new Error(
          `expected before.observation.status 'preliminary', got ${JSON.stringify(body.before)}`,
        );
      }

      const after = await auditCount();
      if (after !== before + 1) {
        throw new Error(
          `expected exactly one new audit_event row for verify, before=${before} after=${after}`,
        );
      }

      // Assert verifierUserId/verifiedAt directly on the row (proposal §7
      // AC's own literal "on the row" wording) -- not currently exposed
      // through observationSchema/the HTTP response (out of this task's
      // own scope, proposal §2).
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({
          status: observation.status,
          verifierUserId: observation.verifierUserId,
          verifiedAt: observation.verifiedAt,
        })
        .from(observation)
        .where(eq(observation.id, body.resourceId))
        .limit(1);
      if (!row || row.status !== 'verified') {
        throw new Error(
          `expected persisted status 'verified', got ${JSON.stringify(row)}`,
        );
      }
      if (!row.verifierUserId || !row.verifiedAt) {
        throw new Error(
          `expected verifierUserId/verifiedAt both set, got ${JSON.stringify(row)}`,
        );
      }
    });

    it('a technologist (no verify capability) is rejected 403 on verify, with no mutation or audit row', async () => {
      const { orderId, orderedTestIds } = await createOrder([SODIUM_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 140 })
        .expect(200);

      const before = await auditCount();
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
      const after = await auditCount();
      if (after !== before) {
        throw new Error(
          `expected no new audit_event row on 403, before=${before} after=${after}`,
        );
      }

      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status !== 'resulted') {
        throw new Error(
          `expected the underlying finalize to be unaffected by the rejected verify attempt, got '${status}'`,
        );
      }
    });

    it("verifying a draft-only ('registered') observation is rejected 409", async () => {
      const { orderId, orderedTestIds } = await createOrder([GLUCOSE_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const glucoseId = await glucoseAnalyteId();

      await request(app.getHttpServer())
        .put(`/v1/ordered-tests/${orderedTestId}/results/${glucoseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 90 })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/results/${glucoseId}/verify`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(409);
    });

    it('double-verifying an already-verified observation is rejected 409', async () => {
      const { orderId, orderedTestIds } = await createOrder([BUN_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 15 })
        .expect(200);
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(409);
    });

    it('verifying an analyte with no result at all is rejected 404', async () => {
      const { orderId, orderedTestIds } = await createOrder([GLUCOSE_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const glucoseId = await glucoseAnalyteId();

      await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/results/${glucoseId}/verify`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(404);
    });

    /**
     * The pre-check added to `upsertObservation` (proposal §1 finding #3),
     * proven through the real HTTP stack rather than a unit test of the
     * private method directly. Uses LIPID (4 linked analytes) specifically
     * so the ordered_test stays 'in_process' (enterable) after only Total
     * Cholesterol finalizes -- isolating this 409 from the unrelated
     * ordered-test-status guard in loadWriteContext, which would otherwise
     * also produce a 409 once every analyte on the panel is finalized.
     */
    it('draft/finalize against an already-verified observation is rejected 409, not 500 (upsertObservation pre-check)', async () => {
      const { orderId, orderedTestIds } = await createOrder([LIPID_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const cholesterolId = await analyteIdForLoincCode(
        TOTAL_CHOLESTEROL_LOINC,
      );

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${cholesterolId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 180 })
        .expect(200);

      // finalize() only advances ordered_test -> 'resulted' once every
      // required analyte is finalized (draft() is the only route that
      // advances 'received' -> 'in_process', and this test calls finalize()
      // directly per TASK-051's own "type-and-finalize in one call" AC) --
      // what matters here is that it's still 'received' or 'in_process'
      // (ENTERABLE_ORDERED_TEST_STATUSES), i.e. NOT 'resulted', so the 409s
      // asserted below can only come from upsertObservation's own new
      // verified-row pre-check, not loadWriteContext's ordered-test guard.
      const statusAfterOneFinalize = await orderedTestStatus(
        orderId,
        orderedTestId,
      );
      if (statusAfterOneFinalize === 'resulted') {
        throw new Error(
          `expected the ordered test NOT to be 'resulted' with 3 of 4 LIPID analytes still unfinalized, got '${statusAfterOneFinalize}'`,
        );
      }

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${cholesterolId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      // Draft: the ordered test is still 'in_process' (enterable), so this
      // 409 can only come from upsertObservation's own new pre-check, not
      // loadWriteContext's ordered-test-status guard.
      await request(app.getHttpServer())
        .put(`/v1/ordered-tests/${orderedTestId}/results/${cholesterolId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 200 })
        .expect(409);

      // Finalize: same pre-check, reached via the other write route.
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${cholesterolId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 200 })
        .expect(409);
    });
  });

  /**
   * TASK-055 (FEAT-015 revision §10 Q3): trigger-only proof of "amendment
   * correctly creates a new version" -- no public amendment endpoint exists
   * in this task's own scope. Mirrors `rls-isolation-check.ts`'s own
   * amendment-fixture insert (lines ~161-171): a direct @lis/db insert of a
   * second observation with `amendmentOf` set to a verified row's id,
   * exercising the real `fn_observation_link_created_at` +
   * `fn_observation_supersede` trigger chain end-to-end through this task's
   * own fixtures (not only through the pre-existing isolation-check script).
   */
  describe('Append-only trigger proof: amendment supersession (TASK-055)', () => {
    it('inserting a new observation with amendmentOf set to a verified row archives result_history and sets supersededBy', async () => {
      const { orderId, orderedTestIds } = await createOrder([SODIUM_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const sodiumAnalyteId = await analyteIdForTestCode(SODIUM_CODE);

      const finalizeRes = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 140 })
        .expect(200);
      const observationId = (finalizeRes.body as { resourceId: string })
        .resourceId;

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${sodiumAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );

      const [predecessorBefore] = await db
        .select({
          patientId: observation.patientId,
          specimenId: observation.specimenId,
        })
        .from(observation)
        .where(eq(observation.id, observationId))
        .limit(1);

      // Direct @lis/db insert, same shape as rls-isolation-check.ts's own
      // amendment fixture -- only amendmentOf is set by the caller;
      // amendment_of_created_at is auto-populated by
      // fn_observation_link_created_at (0008 migration).
      await db.insert(observation).values({
        tenantId: TENANT_A,
        orderedTestId,
        analyteId: sodiumAnalyteId,
        specimenId: predecessorBefore.specimenId,
        patientId: predecessorBefore.patientId,
        dataType: 'quantity',
        valueNum: '142',
        source: 'manual',
        amendmentOf: observationId,
      });

      const [predecessorAfter] = await db
        .select({ supersededBy: observation.supersededBy })
        .from(observation)
        .where(eq(observation.id, observationId))
        .limit(1);
      if (!predecessorAfter.supersededBy) {
        throw new Error(
          `expected the verified predecessor's superseded_by to be set by fn_observation_supersede, got ${JSON.stringify(predecessorAfter)}`,
        );
      }

      const historyRows = await db
        .select({
          observationId: resultHistory.observationId,
          status: resultHistory.status,
          supersededBy: resultHistory.supersededBy,
        })
        .from(resultHistory)
        .where(eq(resultHistory.observationId, observationId));
      if (historyRows.length !== 1) {
        throw new Error(
          `expected exactly one result_history row archiving the predecessor, got ${JSON.stringify(historyRows)}`,
        );
      }
      if (
        historyRows[0].status !== 'verified' ||
        historyRows[0].supersededBy !== predecessorAfter.supersededBy
      ) {
        throw new Error(
          `expected the archived row to carry the predecessor's final ('verified') status and the same superseded_by, got ${JSON.stringify(historyRows[0])}`,
        );
      }
    });

    it('a direct UPDATE against an already-verified row is rejected by fn_observation_append_only', async () => {
      const { orderId, orderedTestIds } = await createOrder([BUN_CODE]);
      await receive(orderId);
      const [orderedTestId] = orderedTestIds;
      const bunAnalyteId = await analyteIdForTestCode(BUN_CODE);

      const finalizeRes = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 15 })
        .expect(200);
      const observationId = (finalizeRes.body as { resourceId: string })
        .resourceId;

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${bunAnalyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );

      let threw = false;
      try {
        await db.execute(
          sql`UPDATE observation SET value_num = '999' WHERE id = ${observationId}`,
        );
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error(
          'expected a standalone UPDATE against an already-verified row to be rejected by fn_observation_append_only',
        );
      }
    });
  });

  describe('Prior result read path (TASK-057)', () => {
    // A fresh, dedicated patient -- not this file's own shared `patientId`
    // fixture, which every other `it` block above also writes Glucose/BUN/
    // Sodium/etc observations against. Reusing it here would make this
    // test's own prior-list assertions depend on execution order relative to
    // every other test in this file (`engineering/testing` Skill entry #8's
    // own caution about order-dependent state), rather than the deliberate,
    // fully-isolated two-order scenario the proposal's own testing plan (§8)
    // asks for.
    let priorPatientId: string;
    let glucoseTestDefinitionId: string;

    async function createGlucoseOrder(): Promise<{
      orderId: string;
      orderedTestId: string;
    }> {
      const res = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          patientId: priorPatientId,
          testDefinitionIds: [glucoseTestDefinitionId],
        })
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

    beforeAll(async () => {
      const patientRes = await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'Prior',
          lastName: 'Context',
          sex: 'F',
          birthDate: '1990-01-01',
        })
        .expect(201);
      priorPatientId = (patientRes.body as { resourceId: string }).resourceId;

      const catalogRes = await request(app.getHttpServer())
        .get('/v1/catalog')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const catalog = catalogRes.body as {
        tests: { id: string; code: string }[];
      };
      const found = catalog.tests.find((t) => t.code === GLUCOSE_CODE);
      if (!found) {
        throw new Error(
          `expected catalog fixture '${GLUCOSE_CODE}' in /v1/catalog`,
        );
      }
      glucoseTestDefinitionId = found.id;
    });

    it("a patient with two orders for the same analyte surfaces the first order's finalized result as the second order's own prior result", async () => {
      const glucoseId = await glucoseAnalyteId();

      const order1 = await createGlucoseOrder();
      await receive(order1.orderId);

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${order1.orderedTestId}/results/${glucoseId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 88 })
        .expect(200);

      // Before any earlier order exists for this brand-new, dedicated
      // patient, this ordered test's own prior list is empty.
      const priorBeforeRes = await request(app.getHttpServer())
        .get(
          `/v1/ordered-tests/${order1.orderedTestId}/results/${glucoseId}/prior`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      if ((priorBeforeRes.body as unknown[]).length !== 0) {
        throw new Error(
          `expected an empty prior list before any earlier order exists, got ${JSON.stringify(priorBeforeRes.body)}`,
        );
      }

      const order2 = await createGlucoseOrder();
      await receive(order2.orderId);

      // TASK-055 (uses tokenA, the technologist-roled session that just
      // finalized order1's own result) -- this read path is a plain,
      // unmutating read (`engineering/api-design` entry #6), not gated
      // behind the `verify` capability, so any authenticated caller who can
      // see this ordered test at all can also see its prior context.
      const priorRes = await request(app.getHttpServer())
        .get(
          `/v1/ordered-tests/${order2.orderedTestId}/results/${glucoseId}/prior`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const prior = priorRes.body as {
        orderedTestId: string;
        valueNum: number | null;
      }[];
      if (
        prior.length !== 1 ||
        prior[0].orderedTestId !== order1.orderedTestId ||
        prior[0].valueNum !== 88
      ) {
        throw new Error(
          `expected exactly one prior result, from order1 (orderedTestId=${order1.orderedTestId}, valueNum=88), got ${JSON.stringify(prior)}`,
        );
      }

      // order2's own current result is never its own "prior" -- a fresh
      // ordered test with no result of its own yet still returns the same
      // one prior entry, not itself.
      const priorForOrder2AgainRes = await request(app.getHttpServer())
        .get(
          `/v1/ordered-tests/${order2.orderedTestId}/results/${glucoseId}/prior`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const priorAgain = priorForOrder2AgainRes.body as {
        orderedTestId: string;
      }[];
      if (priorAgain.some((p) => p.orderedTestId === order2.orderedTestId)) {
        throw new Error(
          `expected order2's own ordered test to never appear in its own prior list, got ${JSON.stringify(priorAgain)}`,
        );
      }
    });

    it('rejects a prior-result lookup against an unknown ordered test id with 404', async () => {
      const glucoseId = await glucoseAnalyteId();
      await request(app.getHttpServer())
        .get(`/v1/ordered-tests/${randomUUID()}/results/${glucoseId}/prior`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  /**
   * FEAT-025 (ADR-0023): the full write-path proof that `resolveDeltaCheck`
   * (unit-covered directly against `@lis/db` in delta-check.e2e-spec.ts,
   * mirroring flagging.e2e-spec.ts's own pattern) is actually wired into the
   * real HTTP finalize path -- a real prior VERIFIED result, a real second
   * order, a real 'D' in the HTTP response's own `flags`. Potassium (seeded
   * `delta_check_rule.thresholdPercent = 30`, normal range 3.5-5.1): 3.9 ->
   * 5.07 is a +30% change (flags 'D') while staying inside the normal range
   * (flags 'N', not 'H') -- deliberately isolates the delta flag from any
   * severity flag, proving `mergeDeltaFlag` is additive, not just "D instead
   * of a severity flag would also happen to pass."
   */
  describe('Delta check (FEAT-025, ADR-0023)', () => {
    it("a result exceeding the configured delta threshold from the patient's prior verified result flags 'D' and sets previousObservationId", async () => {
      const potassiumId = await analyteIdForTestCode(POTASSIUM_CODE);

      const order1 = await createOrder([POTASSIUM_CODE]);
      await receive(order1.orderId);
      const [orderedTestId1] = order1.orderedTestIds;
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId1}/results/${potassiumId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 3.9 })
        .expect(200);
      const verifyRes = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId1}/results/${potassiumId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
      const verifiedObservationId = (verifyRes.body as { resourceId: string })
        .resourceId;

      const order2 = await createOrder([POTASSIUM_CODE]);
      await receive(order2.orderId);
      const [orderedTestId2] = order2.orderedTestIds;
      const res = await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId2}/results/${potassiumId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 5.07 })
        .expect(200);
      const body = res.body as {
        resourceId: string;
        after: { observation: { flags: string[] } };
      };

      if (!body.after.observation.flags.includes('D')) {
        throw new Error(
          `expected 'D' in flags for a +30% change against a 30% threshold, got ${JSON.stringify(body.after.observation.flags)}`,
        );
      }
      if (
        body.after.observation.flags.includes('H') ||
        body.after.observation.flags.includes('HH')
      ) {
        throw new Error(
          `expected no severity flag (5.07 is within the normal 3.5-5.1 range) -- this test isolates 'D' deliberately, got ${JSON.stringify(body.after.observation.flags)}`,
        );
      }

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({ previousObservationId: observation.previousObservationId })
        .from(observation)
        .where(eq(observation.id, body.resourceId))
        .limit(1);
      if (row?.previousObservationId !== verifiedObservationId) {
        throw new Error(
          `expected previousObservationId to link to order1's verified observation (${verifiedObservationId}), got ${JSON.stringify(row)}`,
        );
      }
    });

    it('a draft with no eligible prior verified observation for this patient/analyte never flags D, and previousObservationId stays null on the row', async () => {
      // A brand-new patient (not the shared `patientId` fixture) has, by
      // construction, zero verified Potassium history -- the cleanest real
      // proof of the "no eligible prior" branch, no ordering-of-tests
      // assumption needed against the shared fixture's own growing history.
      const freshPatientRes = await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'DeltaCheck',
          lastName: 'NoPrior',
          sex: 'F',
          birthDate: '1990-01-01',
        })
        .expect(201);
      const freshPatientId = (freshPatientRes.body as { resourceId: string })
        .resourceId;

      const potassiumId = await analyteIdForTestCode(POTASSIUM_CODE);
      const catalogRes = await request(app.getHttpServer())
        .get('/v1/catalog')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const testDefinitionId = (
        catalogRes.body as { tests: { id: string; code: string }[] }
      ).tests.find((t) => t.code === POTASSIUM_CODE)?.id;
      if (!testDefinitionId) {
        throw new Error(`expected catalog fixture '${POTASSIUM_CODE}'`);
      }
      const orderRes = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          patientId: freshPatientId,
          testDefinitionIds: [testDefinitionId],
        })
        .expect(201);
      const orderBody = orderRes.body as {
        resourceId: string;
        after: { orderedTests: { id: string }[] };
      };
      await receive(orderBody.resourceId);
      const orderedTestId = orderBody.after.orderedTests[0].id;

      const res = await request(app.getHttpServer())
        .put(`/v1/ordered-tests/${orderedTestId}/results/${potassiumId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 4.0 })
        .expect(200);
      // draft() (PUT) returns the flat ObservationDto directly (`id`), not
      // finalize()/verify()'s `{resourceId, before, after}` action-response
      // shape -- draft is a plain resource upsert, not an action.
      const body = res.body as { id: string; flags: string[] };
      if (body.flags.includes('D')) {
        throw new Error(
          `expected no 'D' flag with no eligible prior verified observation, got ${JSON.stringify(body.flags)}`,
        );
      }

      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({ previousObservationId: observation.previousObservationId })
        .from(observation)
        .where(eq(observation.id, body.id))
        .limit(1);
      if (row?.previousObservationId !== null) {
        throw new Error(
          `expected previousObservationId null with no eligible prior, got ${JSON.stringify(row)}`,
        );
      }
    });
  });

  describe('observation.ordered_test_id/specimen_id FK (issue #260, ADR-0005)', () => {
    // Issue #260's own stated bar: Postgres must actually reject the insert
    // -- not just "the migration file contains the ALTER TABLE statement".
    // randomUUID() here is guaranteed not to match any real ordered_test/
    // specimen row. A real patientId is required on every insert below so
    // chk_observation_subject's own patient-shaped branch (is_control=false
    // AND patient_id IS NOT NULL) is satisfied first -- otherwise Postgres
    // rejects on that CHECK before ever reaching the FK being tested here.
    async function realPatientId(db: ReturnType<typeof createDb>) {
      const [pat] = await db
        .insert(patient)
        .values({
          tenantId: TENANT_A,
          mrn: `FK-260-CHECK-${Date.now()}-${randomUUID()}`,
          firstName: 'FK260',
          lastName: 'Check',
          sex: 'U',
        })
        .returning();
      return pat.id;
    }

    it('rejects a direct insert with a non-existent ordered_test_id', async () => {
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );

      await expect(
        db.insert(observation).values({
          tenantId: TENANT_A,
          patientId: await realPatientId(db),
          orderedTestId: randomUUID(),
          analyteId: await glucoseAnalyteId(),
          dataType: 'quantity',
          valueNum: '5.0',
          source: 'manual',
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('rejects a direct insert with a non-existent specimen_id', async () => {
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );

      await expect(
        db.insert(observation).values({
          tenantId: TENANT_A,
          patientId: await realPatientId(db),
          specimenId: randomUUID(),
          analyteId: await glucoseAnalyteId(),
          dataType: 'quantity',
          valueNum: '5.0',
          source: 'manual',
        }),
      ).rejects.toMatchObject({ cause: { code: '23503' } });
    });

    it('still accepts a QC-shaped row with both columns null (ADR-0015 unaffected)', async () => {
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );

      const [lot] = await db
        .insert(controlLot)
        .values({
          tenantId: TENANT_A,
          analyteId: await glucoseAnalyteId(),
          level: 'normal',
          unitId: (await db.select({ id: unit.id }).from(unit).limit(1))[0].id,
          targetMean: '5.0',
          targetSd: '0.2',
          lotNumber: `FK-260-CHECK-${Date.now()}`,
        })
        .returning();

      const [row] = await db
        .insert(observation)
        .values({
          tenantId: TENANT_A,
          isControl: true,
          controlLotId: lot.id,
          analyteId: await glucoseAnalyteId(),
          dataType: 'quantity',
          valueNum: '5.0',
          source: 'manual',
        })
        .returning();

      expect(row.orderedTestId).toBeNull();
      expect(row.specimenId).toBeNull();
    });
  });
});
