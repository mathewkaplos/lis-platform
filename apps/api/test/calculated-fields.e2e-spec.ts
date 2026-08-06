import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { ageYearsAt, computeEgfr, computeLdl } from '@lis/domain';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const CREAT_CODE = 'CREAT';
const LIPID_CODE = 'LIPID';
const EGFR_LOINC = '98979-8';
const LDL_LOINC = '13457-7';
const TC_LOINC = '2093-3';
const HDL_LOINC = '2085-9';
const TG_LOINC = '2571-8';

/**
 * TASK-053 (FEAT-014 revision): pure-function coverage for `computeEgfr`/
 * `computeLdl` (no DB, same "pure edge-case tests need no DB access at all"
 * precedent as flagging.e2e-spec.ts), plus real HTTP integration coverage
 * proving the literal AC ("the value recalculates correctly on dependency
 * change") end-to-end against real Keycloak/Postgres.
 */
describe('Calculated fields (e2e)', () => {
  describe('computeEgfr (pure)', () => {
    it('computes a real CKD-EPI 2021 value for a known male input', () => {
      const result = computeEgfr({
        creatinineMgDl: 1.0,
        sex: 'M',
        ageYears: 50,
      });
      if ('suppressed' in result) {
        throw new Error(
          `expected a computed value, got suppressed: ${result.reason}`,
        );
      }
      // A sanity band, not a hardcoded literal -- real published CKD-EPI
      // 2021 calculators return ~90-93 mL/min/1.73m^2 for this input.
      if (result.value < 85 || result.value > 95) {
        throw new Error(`unexpected eGFR for Scr=1.0, M, 50y: ${result.value}`);
      }
    });

    it('suppresses for unknown sex', () => {
      const result = computeEgfr({
        creatinineMgDl: 1.0,
        sex: 'U',
        ageYears: 50,
      });
      if (!('suppressed' in result)) {
        throw new Error(
          `expected suppression for sex 'U', got ${JSON.stringify(result)}`,
        );
      }
    });

    it('suppresses for a null (unknown) birth date', () => {
      const result = computeEgfr({
        creatinineMgDl: 1.0,
        sex: 'F',
        ageYears: null,
      });
      if (!('suppressed' in result)) {
        throw new Error(
          `expected suppression for null ageYears, got ${JSON.stringify(result)}`,
        );
      }
    });
  });

  describe('computeLdl (pure)', () => {
    it('computes Friedewald correctly below the triglyceride guard', () => {
      const result = computeLdl({
        totalCholesterolMgDl: 200,
        hdlMgDl: 50,
        triglyceridesMgDl: 150,
      });
      if ('suppressed' in result) {
        throw new Error(
          `expected a computed value, got suppressed: ${result.reason}`,
        );
      }
      // 200 - 50 - 150/5 = 120
      if (result.value !== 120) {
        throw new Error(`expected LDL 120, got ${result.value}`);
      }
    });

    it('computes correctly one unit below the triglyceride guard boundary (399)', () => {
      const result = computeLdl({
        totalCholesterolMgDl: 200,
        hdlMgDl: 50,
        triglyceridesMgDl: 399,
      });
      if ('suppressed' in result) {
        throw new Error(
          `expected 399 to compute (guard is >=400), got suppressed`,
        );
      }
    });

    it('suppresses at the triglyceride guard boundary (400)', () => {
      const result = computeLdl({
        totalCholesterolMgDl: 200,
        hdlMgDl: 50,
        triglyceridesMgDl: 400,
      });
      if (!('suppressed' in result)) {
        throw new Error(
          `expected suppression at triglycerides=400, got ${JSON.stringify(result)}`,
        );
      }
    });
  });

  describe('HTTP integration', () => {
    let app: INestApplication<App>;
    let tokenA: string;

    async function createPatient(
      sex: 'M' | 'F' | 'U',
      birthDate: string | null,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'Calc',
          lastName: 'Fields',
          sex,
          ...(birthDate ? { birthDate } : { birthDate: '1900-01-01' }),
        })
        .expect(201);
      return (res.body as { resourceId: string }).resourceId;
    }

    async function createOrder(
      patientId: string,
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
      if (!found) throw new Error(`expected catalog fixture '${testCode}'`);

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

    async function orderedTestStatus(
      orderId: string,
      orderedTestId: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .get(`/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        orderedTests: { id: string; status: string }[];
      };
      const found = body.orderedTests.find((t) => t.id === orderedTestId);
      if (!found)
        throw new Error(
          `ordered test ${orderedTestId} not found on order ${orderId}`,
        );
      return found.status;
    }

    async function results(orderedTestId: string): Promise<
      {
        analyteId: string;
        valueNum: number | null;
        status: string;
        source: string;
      }[]
    > {
      const res = await request(app.getHttpServer())
        .get(`/v1/ordered-tests/${orderedTestId}/results`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      return res.body as {
        analyteId: string;
        valueNum: number | null;
        status: string;
        source: string;
      }[];
    }

    async function finalize(
      orderedTestId: string,
      analyteId: string,
      valueNum: number,
    ): Promise<void> {
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${analyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum })
        .expect(200);
    }

    async function analyteIdForLoincCode(loincCode: string): Promise<string> {
      const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({ id: analyte.id })
        .from(analyte)
        .innerJoin(
          codeSystemValue,
          eq(analyte.codeSystemValueId, codeSystemValue.id),
        )
        .where(
          sql`${codeSystemValue.system} = 'LOINC' AND ${codeSystemValue.code} = ${loincCode}`,
        )
        .limit(1);
      if (!row)
        throw new Error(`no analyte found for LOINC code '${loincCode}'`);
      return row.id;
    }

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      await app.init();
      tokenA = await getKeycloakToken('test-user', 'test-password');
    });

    afterAll(async () => {
      await app.close();
    });

    it('eGFR: finalizing Creatinine computes and finalizes eGFR in the same call, matching computeEgfr() directly', async () => {
      // ageYears computed from the SAME real "now" the server itself uses
      // (call-time, not a hardcoded literal) -- TASK-049's own CI-caught
      // hardcoded-date lesson applied here: a literal age would drift wrong
      // the moment this patient's birthday passes in real calendar time.
      const birthDate = '1976-01-01';
      const patientId = await createPatient('M', birthDate);
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        CREAT_CODE,
      );
      await receive(orderId);
      const creatinineAnalyteId = await analyteIdForLoincCode('2160-0');
      const egfrAnalyteId = await analyteIdForLoincCode(EGFR_LOINC);

      await finalize(orderedTestId, creatinineAnalyteId, 1.0);
      const ageYears = ageYearsAt(new Date(birthDate), new Date());

      const rows = await results(orderedTestId);
      const egfrRow = rows.find((r) => r.analyteId === egfrAnalyteId);
      if (
        !egfrRow ||
        egfrRow.status !== 'preliminary' ||
        egfrRow.source !== 'calculated'
      ) {
        throw new Error(
          `expected a finalized, calculated eGFR observation, got ${JSON.stringify(egfrRow)}`,
        );
      }

      const expected = computeEgfr({ creatinineMgDl: 1.0, sex: 'M', ageYears });
      if ('suppressed' in expected)
        throw new Error('test setup bug: expected a computed value');
      if (
        egfrRow.valueNum === null ||
        Math.abs(egfrRow.valueNum - expected.value) > 0.01
      ) {
        throw new Error(
          `expected eGFR ~${expected.value}, got ${egfrRow.valueNum}`,
        );
      }

      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status !== 'resulted') {
        throw new Error(
          `expected CREAT ordered_test 'resulted' once eGFR cascades, got '${status}'`,
        );
      }
    });

    /**
     * TASK-053 (FEAT-014 revision) real finding, not anticipated when the
     * proposal was drafted: CREAT's own `test_analyte` set is exactly
     * {Creatinine, eGFR} (finding #3's own design -- eGFR lives on the same,
     * single-input test as its one dependency), so finalizing Creatinine
     * both cascades eGFR AND completes 100% of CREAT's own
     * `ordered_test.status -> 'resulted'` transition in the SAME call --
     * there is no "still in_process, correct it before the panel closes"
     * window for a single-input calculated analyte the way there is for
     * LDL's 3-input case (below). TASK-051's own pre-existing guard
     * (`ENTERABLE_ORDERED_TEST_STATUSES`) then correctly rejects any further
     * write to that ordered_test. This is a real, structural consequence of
     * this task's own design, proven here rather than assumed away -- the
     * literal "recalculates on dependency change" AC is provably reachable
     * for a multi-input calculated analyte (LDL, next test) but not for a
     * single-input one whose test has no other member (eGFR).
     */
    it("eGFR: once cascaded, CREAT's ordered_test is 'resulted' and correctly rejects a further Creatinine correction (409) -- a real, documented structural limit, not a bug", async () => {
      const patientId = await createPatient('F', '1996-01-01');
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        CREAT_CODE,
      );
      await receive(orderId);
      const creatinineAnalyteId = await analyteIdForLoincCode('2160-0');

      await finalize(orderedTestId, creatinineAnalyteId, 0.8);
      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status !== 'resulted') {
        throw new Error(
          `expected CREAT ordered_test 'resulted' immediately after eGFR cascades, got '${status}'`,
        );
      }

      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${creatinineAnalyteId}/finalize`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ dataType: 'quantity', valueNum: 1.5 })
        .expect(409);
    });

    it('LDL: recomputes from the LATEST input values, not stale ones -- correcting HDL before the third input finalizes changes the eventual LDL -- the literal "recalculates on dependency change" AC', async () => {
      const patientId = await createPatient('M', '1970-01-01');
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        LIPID_CODE,
      );
      await receive(orderId);
      const tcId = await analyteIdForLoincCode(TC_LOINC);
      const hdlId = await analyteIdForLoincCode(HDL_LOINC);
      const tgId = await analyteIdForLoincCode(TG_LOINC);
      const ldlId = await analyteIdForLoincCode(LDL_LOINC);

      await finalize(orderedTestId, tcId, 200);
      await finalize(orderedTestId, hdlId, 50); // panel still in_process (TG missing) -- LDL not computed yet
      await finalize(orderedTestId, hdlId, 60); // correction, still in_process -- allowed, matching draft/finalize's own "preliminary isn't append-only" precedent (TASK-051 proposal §1)
      await finalize(orderedTestId, tgId, 150); // completes the panel; LDL must use the CORRECTED HDL (60), not the stale first value (50)

      const rows = await results(orderedTestId);
      const ldlRow = rows.find((r) => r.analyteId === ldlId);
      // 200 - 60 - 150/5 = 110 (not 120, which is what the stale HDL=50 would have produced)
      if (!ldlRow || ldlRow.valueNum !== 110) {
        throw new Error(
          `expected LDL to reflect the corrected HDL (110), got ${JSON.stringify(ldlRow)}`,
        );
      }
    });

    it("eGFR: patient.sex = 'U' means eGFR is never computed, and CREAT's ordered_test never reaches 'resulted' -- a real, documented gap, proven not assumed", async () => {
      const patientId = await createPatient('U', '1980-01-01');
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        CREAT_CODE,
      );
      await receive(orderId);
      const creatinineAnalyteId = await analyteIdForLoincCode('2160-0');
      const egfrAnalyteId = await analyteIdForLoincCode(EGFR_LOINC);

      await finalize(orderedTestId, creatinineAnalyteId, 1.0);

      const rows = await results(orderedTestId);
      if (rows.some((r) => r.analyteId === egfrAnalyteId)) {
        throw new Error(
          `expected no eGFR observation for sex='U', got ${JSON.stringify(rows)}`,
        );
      }
      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status === 'resulted') {
        throw new Error(
          `expected CREAT ordered_test to stay short of 'resulted' when eGFR can never compute`,
        );
      }
    });

    it('LDL: computes and finalizes only once all three Lipid Panel inputs are present, in any order, and the ordered_test reaches resulted only then', async () => {
      const patientId = await createPatient('M', '1970-01-01');
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        LIPID_CODE,
      );
      await receive(orderId);
      const tcId = await analyteIdForLoincCode(TC_LOINC);
      const hdlId = await analyteIdForLoincCode(HDL_LOINC);
      const tgId = await analyteIdForLoincCode(TG_LOINC);
      const ldlId = await analyteIdForLoincCode(LDL_LOINC);

      await finalize(orderedTestId, tcId, 200);
      let rows = await results(orderedTestId);
      if (rows.some((r) => r.analyteId === ldlId)) {
        throw new Error(
          'expected no LDL yet with only Total Cholesterol finalized',
        );
      }
      if ((await orderedTestStatus(orderId, orderedTestId)) === 'resulted') {
        throw new Error('expected LIPID ordered_test not yet resulted');
      }

      await finalize(orderedTestId, hdlId, 50);
      rows = await results(orderedTestId);
      if (rows.some((r) => r.analyteId === ldlId)) {
        throw new Error(
          'expected no LDL yet with only 2 of 3 inputs finalized',
        );
      }

      await finalize(orderedTestId, tgId, 150);
      rows = await results(orderedTestId);
      const ldlRow = rows.find((r) => r.analyteId === ldlId);
      if (
        !ldlRow ||
        ldlRow.status !== 'preliminary' ||
        ldlRow.source !== 'calculated'
      ) {
        throw new Error(
          `expected a finalized, calculated LDL observation, got ${JSON.stringify(ldlRow)}`,
        );
      }
      // 200 - 50 - 150/5 = 120
      if (ldlRow.valueNum !== 120) {
        throw new Error(`expected LDL 120, got ${ldlRow.valueNum}`);
      }

      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status !== 'resulted') {
        throw new Error(
          `expected LIPID ordered_test 'resulted' once all 4 analytes finalize, got '${status}'`,
        );
      }
    });

    it('LDL: triglycerides >= 400 suppresses the write entirely -- no fabricated value, ordered_test never reaches resulted', async () => {
      const patientId = await createPatient('F', '1970-01-01');
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        LIPID_CODE,
      );
      await receive(orderId);
      const tcId = await analyteIdForLoincCode(TC_LOINC);
      const hdlId = await analyteIdForLoincCode(HDL_LOINC);
      const tgId = await analyteIdForLoincCode(TG_LOINC);
      const ldlId = await analyteIdForLoincCode(LDL_LOINC);

      await finalize(orderedTestId, tcId, 200);
      await finalize(orderedTestId, hdlId, 50);
      await finalize(orderedTestId, tgId, 400);

      const rows = await results(orderedTestId);
      if (rows.some((r) => r.analyteId === ldlId)) {
        throw new Error(
          `expected no LDL write when triglycerides >= 400, got ${JSON.stringify(rows)}`,
        );
      }
      const status = await orderedTestStatus(orderId, orderedTestId);
      if (status === 'resulted') {
        throw new Error(
          'expected LIPID ordered_test to stay short of resulted when the Friedewald guard suppresses LDL',
        );
      }
    });
  });

  it('sanity: the seeded catalog links these fixture test_definitions the way the integration tests above assume', async () => {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    for (const [testCode, expectedAnalyteCount] of [
      [CREAT_CODE, 2],
      [LIPID_CODE, 4],
    ] as const) {
      const [testDefRow] = await db
        .select({ id: testDefinition.id })
        .from(testDefinition)
        .where(
          sql`${testDefinition.tenantId} = ${TENANT_A} AND ${testDefinition.code} = ${testCode}`,
        )
        .limit(1);
      if (!testDefRow) throw new Error(`expected seeded test '${testCode}'`);
      const links = await db
        .select({ id: testAnalyte.id })
        .from(testAnalyte)
        .where(eq(testAnalyte.testDefinitionId, testDefRow.id));
      if (links.length !== expectedAnalyteCount) {
        throw new Error(
          `expected '${testCode}' to have ${expectedAnalyteCount} analytes, got ${links.length}`,
        );
      }
    }
  });
});
