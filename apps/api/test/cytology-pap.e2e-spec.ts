import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, synopticProtocolVersion } from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { getKeycloakFreshToken } from './get-keycloak-fresh-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

/**
 * FEAT-062 (docs/plans/feat-062-cytology-bethesda-pap-reporting.md). Proves
 * issue #541's own three ACs against a real, cited Bethesda System protocol,
 * reusing FEAT-057 (Case/Specimen/Block/Slide), FEAT-058 (synoptic-response
 * recording), and FEAT-059 (sign-out) entirely unchanged -- the first
 * feature this session to exercise all three together for a genuinely
 * non-histology case shape (a cytology specimen has no real "block," but
 * `case.controller.ts finalize()`'s own lineage-completeness check accepts
 * a 1-block-1-slide-per-part case unmodified, proposal §5/§6/§8).
 */
describe('Cytology Pap reporting (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens
  let tokenVerifier: string; // test-user-4: technologist+verifier -- verify + fresh step-up
  let papProtocolId: string;
  let papVersionId: string;

  async function createCytologyCase(): Promise<{
    caseId: string;
    orderedTestId: string;
  }> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Cytology', lastName: 'Fixture', sex: 'F' })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const glu = (
      catalogRes.body as { tests: { id: string; code: string }[] }
    ).tests.find((t) => t.code === 'GLU');
    if (!glu) {
      throw new Error("expected db/seed/chemistry-catalog.sql fixture 'GLU'");
    }

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glu.id] })
      .expect(201);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    // AC #3's own real point: a cytology specimen (no real paraffin block),
    // reusing case/specimen/block/slide literally, unmodified (proposal §5).
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'cervical_cytology' }] })
      .expect(201);
    const caseId = (caseRes.body as { resourceId: string }).resourceId;

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const [part] = (lineage.body as { parts: { id: string }[] }).parts;

    const blockRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/blocks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ specimenId: part.id })
      .expect(201);
    const blockId = (blockRes.body as { resourceId: string }).resourceId;
    await request(app.getHttpServer())
      .post(`/v1/blocks/${blockId}/slides`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const orderDetail = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderedTestId = (
      orderDetail.body as { orderedTests: { id: string }[] }
    ).orderedTests[0].id;

    return { caseId, orderedTestId };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenVerifier] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      // Real Authorization Code + PKCE flow, not Direct Grant -- finalize()
      // needs a genuinely fresh auth_time (FEAT-059's own StepUpGuard),
      // which Direct Grant tokens never carry on this realm (see
      // get-keycloak-fresh-token.ts's own header comment).
      getKeycloakFreshToken('test-user-4', 'test-password-4'),
    ]);

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const protocolsRes = await request(app.getHttpServer())
      .get('/v1/synoptic-protocols')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const pap = (
      protocolsRes.body as { protocols: { id: string; name: string }[] }
    ).protocols.find((p) => p.name === 'Cervical Cytology (Pap)');
    if (!pap) {
      throw new Error(
        "expected db/seed/synoptic-protocol-cytology-pap.sql's 'Cervical Cytology (Pap)' protocol",
      );
    }
    papProtocolId = pap.id;

    const [{ id: versionId }] = await db
      .select({ id: synopticProtocolVersion.id })
      .from(synopticProtocolVersion)
      .where(
        and(
          eq(synopticProtocolVersion.synopticProtocolId, papProtocolId),
          eq(synopticProtocolVersion.status, 'published'),
        ),
      )
      .limit(1);
    papVersionId = versionId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/synoptic-protocols lists the real, cited Bethesda protocol', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/synoptic-protocols')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const names = (
      res.body as { protocols: { name: string; sourceStandard: string }[] }
    ).protocols;
    const pap = names.find((p) => p.name === 'Cervical Cytology (Pap)');
    expect(pap?.sourceStandard).toBe('Bethesda');
  });

  it('AC #1: adequacy is captured as a coded Observation, distinct from every other element', async () => {
    const { caseId, orderedTestId } = await createCytologyCase();

    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: papVersionId,
        responses: [
          { elementKey: 'specimen_adequacy', value: 'satisfactory' },
          { elementKey: 'interpretation_category', value: 'nilm' },
        ],
      })
      .expect(201);
    const body = res.body as {
      tableObservationId: string;
      results: { elementKey: string; observationId: string }[];
    };
    const adequacy = body.results.find(
      (r) => r.elementKey === 'specimen_adequacy',
    );
    const interpretation = body.results.find(
      (r) => r.elementKey === 'interpretation_category',
    );
    if (!adequacy || !interpretation) {
      throw new Error(`expected both results, got ${JSON.stringify(body)}`);
    }
    // Two distinct, independently queryable discrete Observations -- not
    // folded into one opaque value.
    expect(adequacy.observationId).not.toBe(interpretation.observationId);
  });

  it('an unsatisfactory adequacy response requires a reason (the real conditional visibilityCondition)', async () => {
    const { caseId, orderedTestId } = await createCytologyCase();

    // Omitting adequacy_reason when specimen_adequacy is unsatisfactory --
    // the recorder's own real required-when-visible enforcement (reused
    // unchanged from FEAT-058), not new code this feature adds.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: papVersionId,
        responses: [
          {
            elementKey: 'specimen_adequacy',
            value: 'unsatisfactory_for_evaluation',
          },
          { elementKey: 'interpretation_category', value: 'nilm' },
        ],
      })
      .expect(400);
  });

  it('AC #2: interpretation category is validated against the real controlled Bethesda value set', async () => {
    const { caseId, orderedTestId } = await createCytologyCase();

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: papVersionId,
        responses: [
          { elementKey: 'specimen_adequacy', value: 'satisfactory' },
          {
            elementKey: 'interpretation_category',
            value: 'not_a_real_bethesda_category',
          },
        ],
      })
      .expect(400);

    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: papVersionId,
        responses: [
          { elementKey: 'specimen_adequacy', value: 'satisfactory' },
          { elementKey: 'interpretation_category', value: 'hsil' },
        ],
      })
      .expect(201);
    const body = res.body as {
      results: { elementKey: string; observationId: string }[];
    };
    expect(
      body.results.some((r) => r.elementKey === 'interpretation_category'),
    ).toBe(true);
  });

  it('AC #3: a Pap case can be signed out end to end via the FEAT-059 mechanism', async () => {
    const { caseId, orderedTestId } = await createCytologyCase();

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: papVersionId,
        responses: [
          { elementKey: 'specimen_adequacy', value: 'satisfactory' },
          { elementKey: 'interpretation_category', value: 'asc_us' },
        ],
      })
      .expect(201);

    // FEAT-063: a cervical cytology case now requires screening before
    // sign-out (case-tiering.ts's requiresTwoTierReview) -- unlike
    // case-sign-out.e2e-spec.ts's own histology fixture, which finalizes
    // directly.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // Same FEAT-059 mechanism proven for histology in
    // case-sign-out.e2e-spec.ts.
    const finalizeRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);
    const body = finalizeRes.body as {
      case: { status: string };
      reportVersion: { signature: string; contentHash: string };
    };
    expect(body.case.status).toBe('signed_out');
    expect(body.reportVersion.signature).toBeTruthy();
    expect(body.reportVersion.contentHash).toBeTruthy();
  });
});
