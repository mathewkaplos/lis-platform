import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  observation,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const PBS_CODE = 'PBS';
const ANISOCYTOSIS_LOINC = '32242-7';

/**
 * FEAT-024 (ADR-0025): proves the new `ordinal` write path
 * (`resultEntrySchema`'s 4th discriminated-union branch) against the real
 * HTTP stack, real Postgres, real Keycloak -- matching every other write-
 * path spec's own standard (`observation.e2e-spec.ts`, `worklist.e2e-spec.ts`).
 * Scoped to the Peripheral Blood Smear catalog (`db/seed/haematology-
 * catalog.sql`'s own FEAT-024 section) -- not a re-test of quantity/coded/
 * text, which the existing suite already covers and this spec's own full-
 * suite regression run (develop Skill step 4) confirms is unaffected.
 */
describe('Peripheral film morphology (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let patientId: string;
  let anisocytosisAnalyteId: string;

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
    const found = catalog.tests.find((t) => t.code === PBS_CODE);
    if (!found) {
      throw new Error(`expected catalog fixture '${PBS_CODE}' in /v1/catalog`);
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
      .send({ orderId, specimenType: 'blood_edta' })
      .expect(201);
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
      .send({ firstName: 'PeripheralFilm', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    // Joins through code_system_value/analyte to pin the exact LOINC code,
    // not just "the first analyte linked to PBS" -- row order across the 4
    // morphology analytes isn't guaranteed by test_analyte alone.
    const [row] = await db
      .select({ analyteId: testAnalyte.analyteId })
      .from(testAnalyte)
      .innerJoin(
        testDefinition,
        eq(testAnalyte.testDefinitionId, testDefinition.id),
      )
      .innerJoin(analyte, eq(testAnalyte.analyteId, analyte.id))
      .innerJoin(
        codeSystemValue,
        eq(analyte.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        sql`${testDefinition.code} = ${PBS_CODE} AND ${codeSystemValue.code} = ${ANISOCYTOSIS_LOINC}`,
      )
      .limit(1);
    if (!row)
      throw new Error(`no Anisocytosis analyte found on test '${PBS_CODE}'`);
    anisocytosisAnalyteId = row.analyteId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('drafts a valid morphology grade with no flags, and persists it', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    const res = await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'ordinal', valueCode: '2+' })
      .expect(200);
    const body = res.body as {
      id: string;
      valueCode: string | null;
      flags: string[];
      notes: string | null;
    };

    if (body.valueCode !== '2+') {
      throw new Error(`expected valueCode '2+', got ${JSON.stringify(body)}`);
    }
    if (body.flags.length !== 0) {
      throw new Error(
        `expected no flags for an ordinal grade (no range/critical concept applies), got ${JSON.stringify(body.flags)}`,
      );
    }
    if (body.notes !== null) {
      throw new Error(
        `expected notes null when not provided, got ${JSON.stringify(body.notes)}`,
      );
    }
  });

  it('rejects an invalid grade string, not silently coerced or stored', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'ordinal', valueCode: 'severe' })
      .expect(400);
  });

  it('finalizes a grade with a narrative note, and both persist together (never a note-only write)', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    const res = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        dataType: 'ordinal',
        valueCode: '3+',
        notes: 'Marked anisocytosis, macro- and microcytes present.',
      })
      .expect(200);
    const body = res.body as {
      resourceId: string;
      after: {
        observation: {
          valueCode: string | null;
          notes: string | null;
          status: string;
        };
      };
    };
    if (
      body.after.observation.valueCode !== '3+' ||
      body.after.observation.notes !==
        'Marked anisocytosis, macro- and microcytes present.'
    ) {
      throw new Error(
        `expected grade+note both persisted, got ${JSON.stringify(body.after.observation)}`,
      );
    }

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({
        valueCode: observation.valueCode,
        notes: observation.notes,
        status: observation.status,
      })
      .from(observation)
      .where(eq(observation.id, body.resourceId));
    if (
      row?.valueCode !== '3+' ||
      row.notes !== 'Marked anisocytosis, macro- and microcytes present.' ||
      row.status !== 'preliminary'
    ) {
      throw new Error(
        `expected the persisted row to carry grade+note+preliminary status, got ${JSON.stringify(row)}`,
      );
    }
  });

  it('rejects a note-only submission with no grade (valueCode is required on the ordinal branch)', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'ordinal', notes: 'Some note with no grade' })
      .expect(400);
  });

  it("rejects a dataType mismatch -- a 'quantity' submission against an ordinal-catalogued analyte", async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum: 1 })
      .expect(400);
  });
});
