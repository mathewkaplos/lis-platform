import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  codeSystemValue,
  createDb,
  observation,
  testAnalyte,
  testDefinition,
} from '@lis/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const PBS_CODE = 'PBS';
const ANISOCYTOSIS_LOINC = '32242-7';

/**
 * FEAT-042 (docs/plans/feat-042-ai-narrative-drafting-advisory.md): proves
 * the draft-narrative route and the notesAiOriginated/notesAiDisposition
 * disposition-tracking behavior against the real HTTP stack, real Postgres,
 * real Keycloak -- matching peripheral-film.e2e-spec.ts's own standard for
 * this exact catalog.
 */
describe('Peripheral film AI narrative drafting (e2e)', () => {
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

  async function draftGrade(
    orderedTestId: string,
    grade: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'ordinal', valueCode: grade })
      .expect(200);
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
      .send({ firstName: 'AiNarrative', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
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

  it('drafts a real, grade-specific narrative -- never the generic stub message', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);
    await draftGrade(orderedTestId, '2+');

    const res = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/draft-narrative`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(200);
    const body = res.body as { narrative: string };

    if (
      !body.narrative ||
      body.narrative.includes('no live model configured')
    ) {
      throw new Error(
        `expected a real templated narrative, got ${JSON.stringify(body)}`,
      );
    }
    if (!body.narrative.toLowerCase().includes('anisocytosis')) {
      throw new Error(
        `expected the narrative to actually be about anisocytosis, got ${JSON.stringify(body)}`,
      );
    }
  });

  it('refuses to draft a narrative before any grade has been drafted', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/draft-narrative`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(409);
  });

  it('draft-narrative persists nothing -- the observation notes stay null until finalize actually runs', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);
    await draftGrade(orderedTestId, '1+');

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/draft-narrative`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(200);

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [row] = await db
      .select({
        notes: observation.notes,
        notesAiOriginated: observation.notesAiOriginated,
      })
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, orderedTestId),
          eq(observation.analyteId, anisocytosisAnalyteId),
        ),
      );
    if (row?.notes !== null || row?.notesAiOriginated !== false) {
      throw new Error(
        `expected draft-narrative to persist nothing, got ${JSON.stringify(row)}`,
      );
    }
  });

  it('finalizing with the AI text unedited persists notesAiOriginated=true, disposition=accepted', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);
    await draftGrade(orderedTestId, '2+');

    const draftRes = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/draft-narrative`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(200);
    const { narrative } = draftRes.body as { narrative: string };

    const finalizeRes = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        dataType: 'ordinal',
        valueCode: '2+',
        notes: narrative,
        notesAiOriginated: true,
        notesAiDisposition: 'accepted',
      })
      .expect(200);
    const body = finalizeRes.body as {
      after: {
        observation: {
          notes: string | null;
          notesAiOriginated: boolean;
          notesAiDisposition: string | null;
        };
      };
    };
    if (
      body.after.observation.notes !== narrative ||
      body.after.observation.notesAiOriginated !== true ||
      body.after.observation.notesAiDisposition !== 'accepted'
    ) {
      throw new Error(
        `expected AI-origin markers persisted, got ${JSON.stringify(body.after.observation)}`,
      );
    }
  });

  it('finalizing with edited AI text persists disposition=edited', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);
    await draftGrade(orderedTestId, '3+');

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/draft-narrative`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(200);

    const finalizeRes = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        dataType: 'ordinal',
        valueCode: '3+',
        notes: 'Marked anisocytosis, edited by the technologist for clarity.',
        notesAiOriginated: true,
        notesAiDisposition: 'edited',
      })
      .expect(200);
    const body = finalizeRes.body as {
      after: { observation: { notesAiDisposition: string | null } };
    };
    if (body.after.observation.notesAiDisposition !== 'edited') {
      throw new Error(
        `expected disposition 'edited', got ${JSON.stringify(body.after.observation)}`,
      );
    }
  });

  it('a hand-typed note (draft-narrative never called) persists no AI markers at all', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    const finalizeRes = await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        dataType: 'ordinal',
        valueCode: '1+',
        notes: 'Technologist-authored note, no AI involved.',
      })
      .expect(200);
    const body = finalizeRes.body as {
      after: {
        observation: {
          notesAiOriginated: boolean;
          notesAiDisposition: string | null;
        };
      };
    };
    if (
      body.after.observation.notesAiOriginated !== false ||
      body.after.observation.notesAiDisposition !== null
    ) {
      throw new Error(
        `expected no AI markers on a hand-typed note, got ${JSON.stringify(body.after.observation)}`,
      );
    }
  });

  it('rejects notesAiOriginated/notesAiDisposition sent independently of each other', async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        dataType: 'ordinal',
        valueCode: '1+',
        notesAiDisposition: 'accepted',
      })
      .expect(400);
  });

  it("the underlying ai_inference.invoke audit row's minimized context never includes any patient/order identifier", async () => {
    const { orderId, orderedTestId } = await createOrder();
    await receive(orderId);
    await draftGrade(orderedTestId, '2+');

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${anisocytosisAnalyteId}/draft-narrative`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(200);

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
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
    if (
      asString.includes(orderedTestId) ||
      asString.includes(orderId) ||
      asString.includes(patientId)
    ) {
      throw new Error(
        `minimized context leaked an identifier, got ${JSON.stringify(after.minimizedContext)}`,
      );
    }
    if (
      !('analyteDisplay' in after.minimizedContext) ||
      !('grade' in after.minimizedContext)
    ) {
      throw new Error(
        `expected only analyteDisplay/grade in minimized context, got ${JSON.stringify(after.minimizedContext)}`,
      );
    }
  });
});
