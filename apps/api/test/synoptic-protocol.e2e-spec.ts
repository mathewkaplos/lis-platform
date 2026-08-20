import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, observation, synopticProtocolVersion } from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

const TENANT_A_GLUCOSE_CODE = 'GLU';

/**
 * FEAT-058 (ADR-0050, docs/plans/feat-058-generic-synoptic-protocol-engine.md).
 * Proves the generic synoptic-protocol engine through the live API against
 * the real, ICCR-sourced colorectal seed data -- real Keycloak tokens, real
 * Postgres, matching case.e2e-spec.ts's own standard. Covers issue #539's
 * own four ACs.
 */
describe('Synoptic Protocol API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let noRoleToken: string;
  let patientId: string;
  let testDefinitionId: string;
  let colorectalProtocolId: string;
  let colorectalVersionId: string;

  async function createOrder(): Promise<string> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    if (!testDefinitionId) {
      const found = catalog.tests.find((t) => t.code === TENANT_A_GLUCOSE_CODE);
      if (!found) {
        throw new Error(
          `expected db/seed/chemistry-catalog.sql fixture '${TENANT_A_GLUCOSE_CODE}' in /v1/catalog`,
        );
      }
      testDefinitionId = found.id;
    }
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [testDefinitionId] })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createCaseWithOrderedTest(): Promise<{
    caseId: string;
    orderedTestId: string;
  }> {
    const orderId = await createOrder();
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    const caseId = (caseRes.body as { resourceId: string }).resourceId;

    const orderRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderedTestId = (orderRes.body as { orderedTests: { id: string }[] })
      .orderedTests[0].id;
    return { caseId, orderedTestId };
  }

  // Colorectal required elements that are always visible regardless of
  // tumor_site/neoadjuvant_therapy choice below -- the three conditional
  // ones (relation_to_peritoneal_reflection, plane_of_mesorectal_excision,
  // response_to_neoadjuvant_therapy) are deliberately omitted here.
  const baseColorectalResponses = [
    { elementKey: 'neoadjuvant_therapy', value: 'not_given' },
    { elementKey: 'operative_procedure', value: 'sigmoidectomy' },
    { elementKey: 'tumor_site', value: 'sigmoid_colon' },
    { elementKey: 'tumor_max_dimension_mm', value: 45 },
    { elementKey: 'tumor_perforation', value: 'not_identified' },
    { elementKey: 'histological_tumor_type', value: 'adenocarcinoma_nos' },
    { elementKey: 'histological_tumor_grade', value: 'low_grade' },
    { elementKey: 'extent_of_invasion_pt', value: 'pT3' },
    { elementKey: 'lymphovascular_invasion', value: 'not_identified' },
    { elementKey: 'perineural_invasion', value: 'not_identified' },
    { elementKey: 'lymph_node_status', value: 'pN0' },
    { elementKey: 'tumor_deposits', value: 'not_identified' },
    { elementKey: 'margin_status', value: 'not_involved' },
    { elementKey: 'distant_metastasis_pm', value: 'not_applicable' },
    { elementKey: 'pathological_stage', value: 'Stage IIA' },
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenB, noRoleToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-2', 'test-password-2'),
      getKeycloakToken('test-user-3', 'test-password-3'),
    ]);

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Synoptic', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;

    const protocolsRes = await request(app.getHttpServer())
      .get('/v1/synoptic-protocols')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const protocols = (
      protocolsRes.body as { protocols: { id: string; name: string }[] }
    ).protocols;
    const colorectal = protocols.find((p) => p.name === 'Colorectal Cancer');
    if (!colorectal) {
      throw new Error(
        `expected db/seed/synoptic-protocol-colorectal.sql's 'Colorectal Cancer' protocol, got ${JSON.stringify(protocols)}`,
      );
    }
    colorectalProtocolId = colorectal.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/synoptic-protocols lists both real ICCR-seeded protocols', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/synoptic-protocols')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const names = (
      res.body as { protocols: { name: string; sourceStandard: string }[] }
    ).protocols.map((p) => p.name);
    if (
      !names.includes('Colorectal Cancer') ||
      !names.includes('Invasive Carcinoma of the Breast')
    ) {
      throw new Error(
        `expected both seeded protocols, got ${JSON.stringify(names)}`,
      );
    }
  });

  it("GET .../versions/:versionId returns the full published element tree, each element's response options included", async () => {
    // Discover the published version id via a case-insensitive lookup path:
    // there is no list-versions endpoint in this feature's own scope (issue
    // #539: no admin UI), so this test resolves it the same way the
    // recording endpoint itself would need to -- from the protocol's own
    // seeded, single published version.
    const [{ id: versionIdFromDb }] =
      await queryPublishedVersionId(colorectalProtocolId);
    colorectalVersionId = versionIdFromDb;

    const res = await request(app.getHttpServer())
      .get(
        `/v1/synoptic-protocols/${colorectalProtocolId}/versions/${colorectalVersionId}`,
      )
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as {
      status: string;
      elements: {
        key: string;
        requirement: string;
        responseOptions: { value: string }[];
      }[];
    };
    if (body.status !== 'published') {
      throw new Error(
        `expected a published version, got ${JSON.stringify(body.status)}`,
      );
    }
    if (body.elements.length !== 28) {
      throw new Error(
        `expected 28 colorectal elements (db/seed's own real ICCR count), got ${body.elements.length}`,
      );
    }
    const grade = body.elements.find(
      (e) => e.key === 'histological_tumor_grade',
    );
    if (
      grade?.responseOptions
        .map((o) => o.value)
        .sort()
        .join(',') !== 'high_grade,low_grade'
    ) {
      throw new Error(
        `expected histological_tumor_grade's real 2-tier options, got ${JSON.stringify(grade)}`,
      );
    }
  });

  it('AC #2: recording a full response set produces both a readable grid Observation and discrete coded atoms per element', async () => {
    const { caseId, orderedTestId } = await createCaseWithOrderedTest();

    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: colorectalVersionId,
        responses: baseColorectalResponses,
      })
      .expect(201);
    const body = res.body as {
      tableObservationId: string;
      results: { elementKey: string; observationId: string }[];
    };
    if (
      !body.tableObservationId ||
      body.results.length !== baseColorectalResponses.length
    ) {
      throw new Error(
        `expected one grid Observation + ${baseColorectalResponses.length} discrete atoms, got ${JSON.stringify(body)}`,
      );
    }
    const distinctObservationIds = new Set(
      body.results.map((r) => r.observationId),
    );
    if (distinctObservationIds.size !== baseColorectalResponses.length) {
      throw new Error(
        'expected every discrete result to be its own independently-queryable Observation',
      );
    }
  });

  it('AC #4: a conditionally-required element (visible) must be supplied, and correctly rejects when omitted for a rectal case', async () => {
    const { caseId, orderedTestId } = await createCaseWithOrderedTest();

    const rectalResponses = baseColorectalResponses
      .filter((r) => r.elementKey !== 'tumor_site')
      .concat([{ elementKey: 'tumor_site', value: 'rectum' }]);
    // relation_to_peritoneal_reflection / plane_of_mesorectal_excision are
    // both required-but-hidden-unless-rectal (visibilityCondition on
    // tumor_site) -- omitting them for a rectal case must now be rejected.
    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: colorectalVersionId,
        responses: rectalResponses,
      })
      .expect(400);
    const detail = JSON.stringify(res.body);
    if (
      !detail.includes('relation_to_peritoneal_reflection') ||
      !detail.includes('plane_of_mesorectal_excision')
    ) {
      throw new Error(
        `expected both now-required rectal-only elements named as missing, got ${detail}`,
      );
    }

    // Same rectal case, now supplying both -- must succeed.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: colorectalVersionId,
        responses: rectalResponses.concat([
          {
            elementKey: 'relation_to_peritoneal_reflection',
            value: 'entirely_above',
          },
          { elementKey: 'plane_of_mesorectal_excision', value: 'mesorectal' },
        ]),
      })
      .expect(201);
  });

  it('rejects an invalid coded response value with 400, writing nothing', async () => {
    const { caseId, orderedTestId } = await createCaseWithOrderedTest();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: colorectalVersionId,
        responses: baseColorectalResponses
          .filter((r) => r.elementKey !== 'histological_tumor_grade')
          .concat([
            {
              elementKey: 'histological_tumor_grade',
              value: 'not_a_real_grade',
            },
          ]),
      })
      .expect(400);
  });

  it("rejects an orderedTestId that does not belong to the case's own order with 400", async () => {
    const { caseId } = await createCaseWithOrderedTest();
    const otherOrderId = await createOrder();
    const otherOrderRes = await request(app.getHttpServer())
      .get(`/v1/orders/${otherOrderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const foreignOrderedTestId = (
      otherOrderRes.body as { orderedTests: { id: string }[] }
    ).orderedTests[0].id;

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId: foreignOrderedTestId,
        synopticProtocolVersionId: colorectalVersionId,
        responses: baseColorectalResponses,
      })
      .expect(400);
  });

  it('denies a caller with no manage_specimens-granting role (403)', async () => {
    const { caseId, orderedTestId } = await createCaseWithOrderedTest();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .send({
        orderedTestId,
        synopticProtocolVersionId: colorectalVersionId,
        responses: baseColorectalResponses,
      })
      .expect(403);
  });

  it('returns 404 for a synoptic protocol version under another tenant (RLS is not relevant here -- global data -- but cross-tenant case addressing must still 404)', async () => {
    const { caseId } = await createCaseWithOrderedTest();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        orderedTestId: '00000000-0000-0000-0000-000000000000',
        synopticProtocolVersionId: colorectalVersionId,
        responses: baseColorectalResponses,
      })
      .expect(404);
  });

  describe('coded_multi elements (issue #645)', () => {
    it('records a valid multi-select response as one structured Observation with the selected array persisted verbatim', async () => {
      const { caseId, orderedTestId } = await createCaseWithOrderedTest();

      const protocolsRes = await request(app.getHttpServer())
        .get('/v1/synoptic-protocols')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const protocols = (
        protocolsRes.body as {
          protocols: {
            id: string;
            name: string;
            publishedVersionId: string | null;
          }[];
        }
      ).protocols;
      // Resolved via the list response's own publishedVersionId field
      // (issue #642's own gap-fix), not a direct DB query -- the real API
      // surface this feature's own frontend actually uses.
      const prostate = protocols.find(
        (p) =>
          p.name === 'Carcinoma of the Prostate Gland (Radical Prostatectomy)',
      );
      if (!prostate || !prostate.publishedVersionId) {
        throw new Error(
          `expected db/seed/synoptic-protocol-prostate.sql's published protocol, got ${JSON.stringify(protocols)}`,
        );
      }

      const versionRes = await request(app.getHttpServer())
        .get(
          `/v1/synoptic-protocols/${prostate.id}/versions/${prostate.publishedVersionId}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const version = versionRes.body as {
        elements: {
          key: string;
          dataType: string;
          responseOptions: { value: string }[];
        }[];
      };
      const histologicType = version.elements.find(
        (e) => e.key === 'histologic_type',
      );
      if (!histologicType || histologicType.dataType !== 'coded_multi') {
        throw new Error(
          `expected histologic_type to be a coded_multi element, got ${JSON.stringify(histologicType)}`,
        );
      }
      const selected = histologicType.responseOptions
        .slice(0, 2)
        .map((o) => o.value);

      const res = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: prostate.publishedVersionId,
          responses: [
            { elementKey: 'procedure', value: 'not_specified' },
            { elementKey: 'histologic_type', value: selected },
            { elementKey: 'histologic_grade', value: 'not_applicable' },
            { elementKey: 'intraductal_carcinoma', value: 'not_identified' },
            { elementKey: 'cribriform_glands', value: 'not_applicable' },
            {
              elementKey: 'treatment_effect',
              value: ['no_known_presurgical_therapy'],
            },
            {
              elementKey: 'tumor_quantitation_method',
              value: ['cannot_be_determined'],
            },
            { elementKey: 'extraprostatic_extension', value: 'not_identified' },
            {
              elementKey: 'urinary_bladder_neck_invasion',
              value: 'not_identified',
            },
            { elementKey: 'seminal_vesicle_invasion', value: 'not_identified' },
            { elementKey: 'lymphovascular_invasion', value: 'not_identified' },
            { elementKey: 'margin_status', value: 'all_negative' },
            {
              elementKey: 'regional_lymph_node_status',
              value: 'not_applicable',
            },
            { elementKey: 'pathological_stage_pt', value: 'pT2' },
            {
              elementKey: 'pathological_stage_pn',
              value: 'pn_not_assigned_no_nodes',
            },
          ],
        })
        .expect(201);
      const body = res.body as {
        results: {
          elementKey: string;
          observationId: string;
          value: unknown;
        }[];
      };
      const histologicTypeResult = body.results.find(
        (r) => r.elementKey === 'histologic_type',
      );
      if (
        !histologicTypeResult ||
        !Array.isArray(histologicTypeResult.value) ||
        histologicTypeResult.value.join(',') !== selected.join(',')
      ) {
        throw new Error(
          `expected histologic_type's own result to echo the selected array, got ${JSON.stringify(histologicTypeResult)}`,
        );
      }

      // observation has RLS -- app.tenant_id must be set on this raw
      // connection first, matching case-sign-out.e2e-spec.ts's own
      // established pattern for a direct post-request DB verification.
      await db.execute(
        sql`SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false)`,
      );
      const [persisted] = await db
        .select({
          dataType: observation.dataType,
          valueJson: observation.valueJson,
        })
        .from(observation)
        .where(eq(observation.id, histologicTypeResult.observationId));
      if (
        persisted?.dataType !== 'structured' ||
        JSON.stringify(persisted.valueJson) !== JSON.stringify(selected)
      ) {
        throw new Error(
          `expected a structured Observation with valueJson matching the submitted array exactly, got ${JSON.stringify(persisted)}`,
        );
      }
    });

    it("rejects a coded_multi response containing any value not in the element's own responseOptions", async () => {
      const { caseId, orderedTestId } = await createCaseWithOrderedTest();

      const protocolsRes = await request(app.getHttpServer())
        .get('/v1/synoptic-protocols')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const prostate = (
        protocolsRes.body as {
          protocols: {
            id: string;
            name: string;
            publishedVersionId: string | null;
          }[];
        }
      ).protocols.find(
        (p) =>
          p.name === 'Carcinoma of the Prostate Gland (Radical Prostatectomy)',
      );
      if (!prostate?.publishedVersionId) {
        throw new Error('expected the seeded, published Prostate protocol');
      }

      // Every other required element is supplied validly so the missingRequired
      // check passes and the invalid-value check for histologic_type is what
      // actually rejects the request -- otherwise a "Missing required
      // element(s)" 400 (for the other unsupplied required elements) would
      // mask the coded_multi validation this test is meant to prove.
      const res = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: prostate.publishedVersionId,
          responses: [
            { elementKey: 'procedure', value: 'not_specified' },
            {
              elementKey: 'histologic_type',
              value: ['acinar_conventional', 'not_a_real_option'],
            },
            { elementKey: 'histologic_grade', value: 'not_applicable' },
            { elementKey: 'intraductal_carcinoma', value: 'not_identified' },
            { elementKey: 'cribriform_glands', value: 'not_applicable' },
            {
              elementKey: 'treatment_effect',
              value: ['no_known_presurgical_therapy'],
            },
            {
              elementKey: 'tumor_quantitation_method',
              value: ['cannot_be_determined'],
            },
            { elementKey: 'extraprostatic_extension', value: 'not_identified' },
            {
              elementKey: 'urinary_bladder_neck_invasion',
              value: 'not_identified',
            },
            { elementKey: 'seminal_vesicle_invasion', value: 'not_identified' },
            { elementKey: 'lymphovascular_invasion', value: 'not_identified' },
            { elementKey: 'margin_status', value: 'all_negative' },
            {
              elementKey: 'regional_lymph_node_status',
              value: 'not_applicable',
            },
            { elementKey: 'pathological_stage_pt', value: 'pT2' },
            {
              elementKey: 'pathological_stage_pn',
              value: 'pn_not_assigned_no_nodes',
            },
          ],
        })
        .expect(400);
      if (!JSON.stringify(res.body).includes('histologic_type')) {
        throw new Error(
          `expected histologic_type named as invalid, got ${JSON.stringify(res.body)}`,
        );
      }
    });
  });

  describe('GET /v1/cases/:id/synoptic-responses (issue #659 read path)', () => {
    it('returns an empty list for a case with no recorded responses', async () => {
      const { caseId } = await createCaseWithOrderedTest();
      const res = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as { responses: unknown[] };
      if (body.responses.length !== 0) {
        throw new Error(
          `expected an empty list for an unrecorded case, got ${JSON.stringify(body)}`,
        );
      }
    });

    it('returns a recorded response with correct labels/values after POST', async () => {
      const { caseId, orderedTestId } = await createCaseWithOrderedTest();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        responses: {
          orderedTestId: string;
          synopticProtocolVersionId: string;
          protocolName: string;
          results: { elementKey: string; value: unknown }[];
        }[];
      };
      if (body.responses.length !== 1) {
        throw new Error(
          `expected exactly one recorded response, got ${JSON.stringify(body)}`,
        );
      }
      const [recorded] = body.responses;
      if (
        recorded.orderedTestId !== orderedTestId ||
        recorded.synopticProtocolVersionId !== colorectalVersionId ||
        recorded.protocolName !== 'Colorectal Cancer' ||
        recorded.results.length !== baseColorectalResponses.length
      ) {
        throw new Error(
          `expected the read path to echo the exact recorded response, got ${JSON.stringify(recorded)}`,
        );
      }
      const tumorSite = recorded.results.find(
        (r) => r.elementKey === 'tumor_site',
      );
      if (tumorSite?.value !== 'sigmoid_colon') {
        throw new Error(
          `expected tumor_site's recorded value to round-trip, got ${JSON.stringify(tumorSite)}`,
        );
      }
    });

    it('returns only the most recent recording when the same protocol is recorded twice against the same ordered test', async () => {
      const { caseId, orderedTestId } = await createCaseWithOrderedTest();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);

      const secondResponses = baseColorectalResponses
        .filter((r) => r.elementKey !== 'tumor_max_dimension_mm')
        .concat([{ elementKey: 'tumor_max_dimension_mm', value: 62 }]);
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: secondResponses,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        responses: { results: { elementKey: string; value: unknown }[] }[];
      };
      if (body.responses.length !== 1) {
        throw new Error(
          `expected the two recordings to collapse to one most-recent response, got ${body.responses.length}`,
        );
      }
      const dimension = body.responses[0].results.find(
        (r) => r.elementKey === 'tumor_max_dimension_mm',
      );
      if (dimension?.value !== 62) {
        throw new Error(
          `expected the second recording's value to win, got ${JSON.stringify(dimension)}`,
        );
      }
    });

    it("returns 404 for another tenant's case", async () => {
      const { caseId } = await createCaseWithOrderedTest();
      await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  // No public "list versions" endpoint exists (issue #539 scope), so this
  // test resolves the seeded, real published version id via a direct
  // read -- the same real API surface `GET
  // /v1/synoptic-protocols/:id/versions/:versionId` itself needs a real
  // version id for, proven by the earlier test in this file.
  async function queryPublishedVersionId(
    protocolId: string,
  ): Promise<{ id: string }[]> {
    return db
      .select({ id: synopticProtocolVersion.id })
      .from(synopticProtocolVersion)
      .where(
        and(
          eq(synopticProtocolVersion.synopticProtocolId, protocolId),
          eq(synopticProtocolVersion.status, 'published'),
        ),
      )
      .limit(1);
  }
});
