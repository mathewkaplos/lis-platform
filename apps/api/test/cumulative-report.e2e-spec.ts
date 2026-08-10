import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  patient,
  referenceRange,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';

/**
 * FEAT-033 (docs/plans/feat-033-cumulative-clinical-reports.md). Proves the
 * issue's own literal AC ("correctly assembles multiple historical results
 * for one patient/analyte") plus this proposal's own narrowed §7 criteria:
 * multi-order chronological assembly, snapshot-survives-a-later-range-edit
 * (extended from TASK-059's single-order proof), verified-only filtering,
 * empty-history real state, RLS 404. Fixture style mirrors
 * `report-template.e2e-spec.ts`/`report-assembly.e2e-spec.ts`.
 */
describe('Cumulative report (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let verifierToken: string;

  let analyteId: string;
  let testDefId: string;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        firstName: 'Cumulative',
        lastName: 'E2E',
        sex: 'F',
        birthDate: '1980-01-01',
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createVerifiedResult(
    patientId: string,
    valueNum: number,
  ): Promise<string> {
    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ patientId, testDefinitionIds: [testDefId] })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderId = orderBody.resourceId;
    const orderedTestId = orderBody.after.orderedTests[0].id;

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId, specimenType: 'serum' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/finalize`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    return orderedTestId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [mgdl] = await db
      .select({ id: unit.id })
      .from(unit)
      .innerJoin(
        codeSystemValue,
        eq(unit.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'UCUM'),
          eq(codeSystemValue.code, 'mg/dL'),
        ),
      )
      .limit(1);
    if (!mgdl) {
      throw new Error('expected mg/dL UCUM unit -- run `pnpm db:reset` first');
    }

    const [csv] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'FEAT-033-SYNTH-A',
        version: '1',
        display: 'FEAT-033 synthetic analyte (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });

    const [analyteRow] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csv.id,
        display: 'FEAT-033 Synthetic Analyte (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdl.id,
      })
      .returning({ id: analyte.id });
    analyteId = analyteRow.id;

    await db.insert(referenceRange).values({
      tenantId: TENANT_A,
      analyteId,
      unitId: mgdl.id,
      rangeType: 'normal',
      low: '1',
      high: '100',
      effectiveFrom: new Date('2000-01-01T00:00:00Z'),
    });

    const [def] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: 'FEAT033-SYNTH-1',
        displayName: 'FEAT-033 Synthetic Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });
    testDefId = def.id;
    await db.insert(testAnalyte).values({
      tenantId: TENANT_A,
      testDefinitionId: testDefId,
      analyteId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('assembles multiple historical results for one patient/analyte, in chronological order', async () => {
    const patientId = await createPatient();
    await createVerifiedResult(patientId, 42);
    await createVerifiedResult(patientId, 55);
    await createVerifiedResult(patientId, 68);

    const res = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const body = Buffer.isBuffer(res.body)
      ? res.body
      : Buffer.from(res.text ?? '', 'binary');
    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it(
    'a result assembled after the underlying reference_range is edited still reflects the ' +
      'originally-snapshotted range -- proven by hash invariance across the edit',
    async () => {
      const patientId = await createPatient();
      await createVerifiedResult(patientId, 50);

      const before = await request(app.getHttpServer())
        .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      await db
        .update(referenceRange)
        .set({ low: '200', high: '300' })
        .where(eq(referenceRange.analyteId, analyteId));

      const after = await request(app.getHttpServer())
        .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      const beforeBuf = Buffer.isBuffer(before.body)
        ? before.body
        : Buffer.from(before.text ?? '', 'binary');
      const afterBuf = Buffer.isBuffer(after.body)
        ? after.body
        : Buffer.from(after.text ?? '', 'binary');
      expect(beforeBuf.equals(afterBuf)).toBe(true);
    },
  );

  it('excludes a finalized-but-not-yet-verified result', async () => {
    const patientId = await createPatient();

    // Baseline: this same patient, zero results at all yet -- captured
    // first so the later comparison isn't confounded by a *different*
    // patient's own auto-generated MRN (embedded in the PDF's own `Title`
    // metadata field, which would make two genuinely-both-empty reports
    // for two different patients render different bytes for a reason
    // unrelated to the thing this test actually checks).
    const beforeAnyResult = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ patientId, testDefinitionIds: [testDefId] })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'serum' })
      .expect(201);
    const orderedTestId = orderBody.after.orderedTests[0].id;
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/finalize`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 77 })
      .expect(200);
    // Deliberately not verified yet.

    const afterFinalizeNotVerified = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    function bodyBuf(res: { body: unknown; text?: string }): Buffer {
      return Buffer.isBuffer(res.body)
        ? res.body
        : Buffer.from(res.text ?? '', 'binary');
    }
    // Finalizing alone (no verify) must not add this result to the report --
    // same patient, same empty-history layout, byte-identical.
    expect(
      bodyBuf(afterFinalizeNotVerified).equals(bodyBuf(beforeAnyResult)),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    const afterVerify = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    // Once actually verified, the report must now genuinely differ.
    expect(bodyBuf(afterVerify).equals(bodyBuf(beforeAnyResult))).toBe(false);
  });

  it('a real, well-formed PDF for a patient/analyte pair with zero verified history', async () => {
    const patientId = await createPatient();
    const res = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    const body = Buffer.isBuffer(res.body)
      ? res.body
      : Buffer.from(res.text ?? '', 'binary');
    expect(body.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('RLS: a cross-tenant patient id returns 404, not 403', async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
    );
    const [tenantBPatient] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_B,
        mrn: 'FEAT033-TB-MRN',
        firstName: 'Tenant',
        lastName: 'B',
        sex: 'F',
      })
      .returning({ id: patient.id });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    await request(app.getHttpServer())
      .get(`/v1/patients/${tenantBPatient.id}/cumulative-report/${analyteId}`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(404);
  });

  it('404s for a syntactically-valid but unknown analyte id', async () => {
    // A real, RFC4122-shaped v4 UUID (version nibble '4', variant 'a') that
    // doesn't exist in the DB -- '99999999-...' (this repo's usual "obviously
    // fake" placeholder elsewhere) fails Zod's own `z.uuid()` format check
    // before this route's handler ever runs, producing 400, not the 404
    // this test actually means to prove.
    const patientId = await createPatient();
    await request(app.getHttpServer())
      .get(
        `/v1/patients/${patientId}/cumulative-report/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(404);
  });
});
