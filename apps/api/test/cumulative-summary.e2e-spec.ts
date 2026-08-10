import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  codeSystemValue,
  createDb,
  referenceRange,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-043 (docs/plans/feat-043-ai-cumulative-summaries.md): proves the new
 * GET .../summary route against the real HTTP stack, real Postgres, real
 * Keycloak. Fixture style mirrors cumulative-report.e2e-spec.ts's own
 * synthetic quantity analyte -- a different TEST/codeSystemValue code
 * (FEAT-043-SYNTH-A) so the two spec files' own fixture rows never collide.
 */
describe('Cumulative-report AI summary (e2e)', () => {
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
        firstName: 'CumulativeSummary',
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
  ): Promise<void> {
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
        code: 'FEAT-043-SYNTH-A',
        version: '1',
        display: 'FEAT-043 synthetic analyte (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });

    const [analyteRow] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csv.id,
        display: 'FEAT-043 Synthetic Analyte (non-clinical)',
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
        code: 'FEAT043-SYNTH-1',
        displayName: 'FEAT-043 Synthetic Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });
    testDefId = def.id;
    await db
      .insert(testAnalyte)
      .values({ tenantId: TENANT_A, testDefinitionId: testDefId, analyteId });
  });

  afterAll(async () => {
    await app.close();
  });

  it('a zero-history analyte gets the fixed "no verified results yet" summary, not an error', async () => {
    const patientId = await createPatient();

    const res = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}/summary`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    const body = res.body as { summary: string };
    if (!body.summary.includes('No verified')) {
      throw new Error(
        `expected the fixed empty-history summary, got ${JSON.stringify(body)}`,
      );
    }
  });

  it('correctly describes a real upward numeric trend, grounded in the actual finalized/verified values', async () => {
    const patientId = await createPatient();
    await createVerifiedResult(patientId, 20);
    await createVerifiedResult(patientId, 50);
    await createVerifiedResult(patientId, 80);

    const res = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}/summary`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    const body = res.body as { summary: string };
    if (
      !body.summary.includes('trending upward') ||
      !body.summary.includes('3 verified')
    ) {
      throw new Error(
        `expected an upward-trend summary, got ${JSON.stringify(body)}`,
      );
    }
    if (!body.summary.includes('20') || !body.summary.includes('80')) {
      throw new Error(
        `expected the real min/max values grounded in the summary, got ${JSON.stringify(body)}`,
      );
    }
  });

  it("the underlying ai_inference.invoke audit row's minimized context never includes a patient identifier or verifierUserId", async () => {
    const patientId = await createPatient();
    await createVerifiedResult(patientId, 42);

    await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/cumulative-report/${analyteId}/summary`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    const [row] = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`,
      );
      return tx
        .select({ after: auditEvent.after })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.tenantId, TENANT_A),
            eq(auditEvent.action, 'ai_inference.invoke'),
          ),
        )
        .orderBy(desc(auditEvent.sequence))
        .limit(1);
    });
    const after = row?.after as
      { minimizedContext: Record<string, unknown> } | undefined;
    if (!after) {
      throw new Error('expected an ai_inference.invoke audit row to exist');
    }
    const asString = JSON.stringify(after.minimizedContext);
    if (asString.includes(patientId)) {
      throw new Error(
        `minimized context leaked the patient id, got ${JSON.stringify(after.minimizedContext)}`,
      );
    }
    if (
      asString.includes('verifierUserId') ||
      asString.includes('observationId')
    ) {
      throw new Error(
        `minimized context leaked a field the summary doesn't need, got ${JSON.stringify(after.minimizedContext)}`,
      );
    }
  });

  it('returns 404 for a patient that does not exist, same as generate()', async () => {
    await request(app.getHttpServer())
      .get(
        `/v1/patients/99999999-9999-4999-8999-999999999999/cumulative-report/${analyteId}/summary`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(404);
  });
});
