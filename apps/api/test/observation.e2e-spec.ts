import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const GLUCOSE_CODE = 'GLU';
const BUN_CODE = 'BUN';
const SODIUM_CODE = 'NA';

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
});
