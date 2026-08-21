import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  auditEvent,
  codeSystemValue,
  conceptBlock,
  conceptBlockVersion,
  createDb,
  observation,
  synopticElement,
  synopticProtocol,
  synopticProtocolLinkedPanel,
  synopticProtocolVersion,
} from '@lis/db';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { makeInstanceResponseKey } from '@lis/domain';
import {
  composeConceptBlockVersion,
  composeProtocolVersionElements,
} from '../src/synoptic-protocol/concept-block-composer';
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
    specimenId: string;
  }> {
    const orderId = await createOrder();
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    const caseBody = caseRes.body as {
      resourceId: string;
      after: { partIds: string[] };
    };
    const caseId = caseBody.resourceId;
    const specimenId = caseBody.after.partIds[0];

    const orderRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderedTestId = (orderRes.body as { orderedTests: { id: string }[] })
      .orderedTests[0].id;
    return { caseId, orderedTestId, specimenId };
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
    // 28 real ICCR elements + 1 (issue #663: margin_distance_mm_precision,
    // the real CAP precision-qualifier sibling element).
    if (body.elements.length !== 29) {
      throw new Error(
        `expected 29 colorectal elements (28 real ICCR + 1 issue #663 precision-qualifier sibling), got ${body.elements.length}`,
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
    const { caseId, orderedTestId, specimenId } =
      await createCaseWithOrderedTest();

    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        specimenId,
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
    const { caseId, orderedTestId, specimenId } =
      await createCaseWithOrderedTest();

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
        specimenId,
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
        specimenId,
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
    const { caseId, orderedTestId, specimenId } =
      await createCaseWithOrderedTest();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        specimenId,
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
    const { caseId, orderedTestId, specimenId } =
      await createCaseWithOrderedTest();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .send({
        orderedTestId,
        specimenId,
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
        specimenId: '00000000-0000-0000-0000-000000000000',
        synopticProtocolVersionId: colorectalVersionId,
        responses: baseColorectalResponses,
      })
      .expect(404);
  });

  describe('coded_multi elements (issue #645)', () => {
    it('records a valid multi-select response as one structured Observation with the selected array persisted verbatim', async () => {
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

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
          specimenId,
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
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

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
          specimenId,
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
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
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
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
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
          specimenId,
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

  describe('Response versioning (issue #662)', () => {
    it('a first-ever recording has amendmentOf: null everywhere it appears', async () => {
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const postRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);
      const postBody = postRes.body as { amendmentOf: string | null };
      if (postBody.amendmentOf !== null) {
        throw new Error(
          `expected a first recording's own amendmentOf to be null, got ${JSON.stringify(postBody.amendmentOf)}`,
        );
      }

      const getRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const getBody = getRes.body as {
        responses: { amendmentOf: string | null }[];
      };
      if (getBody.responses[0]?.amendmentOf !== null) {
        throw new Error(
          `expected the read path's amendmentOf to also be null, got ${JSON.stringify(getBody.responses[0])}`,
        );
      }
    });

    it('recording a second time chains onto the first via amendmentOf/supersededBy, in the API response, the read path, and directly in the database', async () => {
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const firstRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);
      const firstBody = firstRes.body as {
        tableObservationId: string;
        results: { elementKey: string; observationId: string }[];
      };
      const firstTumorSiteObservationId = firstBody.results.find(
        (r) => r.elementKey === 'tumor_site',
      )?.observationId;

      const secondResponses = baseColorectalResponses
        .filter((r) => r.elementKey !== 'tumor_max_dimension_mm')
        .concat([{ elementKey: 'tumor_max_dimension_mm', value: 71 }]);
      const secondRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: secondResponses,
        })
        .expect(201);
      const secondBody = secondRes.body as {
        tableObservationId: string;
        amendmentOf: string | null;
        results: { elementKey: string; observationId: string }[];
      };

      // API response: the second recording names exactly what it amended.
      if (secondBody.amendmentOf !== firstBody.tableObservationId) {
        throw new Error(
          `expected the second recording's amendmentOf to point at the first grid Observation, got ${JSON.stringify(secondBody.amendmentOf)}`,
        );
      }

      // Read path: surfaces only the current version, with the same link.
      const getRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const getBody = getRes.body as {
        responses: { tableObservationId: string; amendmentOf: string | null }[];
      };
      if (
        getBody.responses.length !== 1 ||
        getBody.responses[0].tableObservationId !==
          secondBody.tableObservationId ||
        getBody.responses[0].amendmentOf !== firstBody.tableObservationId
      ) {
        throw new Error(
          `expected the read path to surface only the current version with the correct amendmentOf link, got ${JSON.stringify(getBody)}`,
        );
      }

      // Direct DB read -- the real proof, not inferred from API responses:
      // the predecessor grid Observation is genuinely supersededBy the new
      // one, and the same is true for the one discrete element whose value
      // actually changed between recordings.
      await db.execute(
        sql`SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false)`,
      );
      const [predecessorGrid] = await db
        .select({ supersededBy: observation.supersededBy })
        .from(observation)
        .where(eq(observation.id, firstBody.tableObservationId));
      if (predecessorGrid?.supersededBy !== secondBody.tableObservationId) {
        throw new Error(
          `expected the predecessor grid Observation's supersededBy to point at the new one, got ${JSON.stringify(predecessorGrid)}`,
        );
      }

      const secondTumorSiteObservationId = secondBody.results.find(
        (r) => r.elementKey === 'tumor_site',
      )?.observationId;
      const [predecessorElement] = await db
        .select({
          supersededBy: observation.supersededBy,
        })
        .from(observation)
        .where(eq(observation.id, firstTumorSiteObservationId!));
      if (predecessorElement?.supersededBy !== secondTumorSiteObservationId) {
        throw new Error(
          `expected the predecessor tumor_site Observation to be supersededBy the new one, got ${JSON.stringify(predecessorElement)}`,
        );
      }
      const [newElement] = await db
        .select({ amendmentOf: observation.amendmentOf })
        .from(observation)
        .where(eq(observation.id, secondTumorSiteObservationId));
      if (newElement?.amendmentOf !== firstTumorSiteObservationId) {
        throw new Error(
          `expected the new tumor_site Observation's own amendmentOf to point back at the predecessor, got ${JSON.stringify(newElement)}`,
        );
      }

      // Audit trail: the re-recording's own audit event names what it
      // corrected, closing the issue's own "no audit trail of the change"
      // complaint directly.
      const [auditRow] = await db
        .select({ after: auditEvent.after })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.action, 'synoptic.record'),
            eq(auditEvent.resourceId, secondBody.tableObservationId),
          ),
        );
      const auditAfter = auditRow?.after as
        { amendmentOf: string | null } | undefined;
      if (auditAfter?.amendmentOf !== firstBody.tableObservationId) {
        throw new Error(
          `expected the audit event's own after.amendmentOf to name the amended predecessor, got ${JSON.stringify(auditAfter)}`,
        );
      }
    });
  });

  describe('Quantity units and precision qualifier (issue #663)', () => {
    it("GET .../versions/:versionId resolves unitDisplay for the real, already-seeded '_mm' elements, and null for elements with no unit", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/v1/synoptic-protocols/${colorectalProtocolId}/versions/${colorectalVersionId}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        elements: {
          key: string;
          unitId: string | null;
          unitDisplay: string | null;
          parentElementId: string | null;
        }[];
      };
      for (const key of [
        'tumor_max_dimension_mm',
        'margin_distance_mm',
        'invasion_beyond_muscularis_propria_mm',
      ]) {
        const element = body.elements.find((e) => e.key === key);
        if (element?.unitDisplay !== 'mm' || !element.unitId) {
          throw new Error(
            `expected ${key} to have unitDisplay 'mm', got ${JSON.stringify(element)}`,
          );
        }
      }
      const noUnit = body.elements.find((e) => e.key === 'lymph_node_status');
      if (noUnit?.unitId !== null || noUnit?.unitDisplay !== null) {
        throw new Error(
          `expected an element with no declared unit to have unitId/unitDisplay both null, got ${JSON.stringify(noUnit)}`,
        );
      }
    });

    it('the real CAP precision-qualifier pattern is seeded as a sibling coded element nested under margin_distance_mm', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/v1/synoptic-protocols/${colorectalProtocolId}/versions/${colorectalVersionId}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        elements: {
          id: string;
          key: string;
          dataType: string;
          parentElementId: string | null;
          responseOptions: { value: string }[];
        }[];
      };
      const marginDistance = body.elements.find(
        (e) => e.key === 'margin_distance_mm',
      );
      const precision = body.elements.find(
        (e) => e.key === 'margin_distance_mm_precision',
      );
      if (
        !precision ||
        precision.dataType !== 'coded' ||
        precision.parentElementId !== marginDistance?.id ||
        precision.responseOptions
          .map((o) => o.value)
          .sort()
          .join(',') !== 'at_least,cannot_be_determined,exact'
      ) {
        throw new Error(
          `expected margin_distance_mm_precision nested under margin_distance_mm with the three real CAP options, got ${JSON.stringify({ marginDistance, precision })}`,
        );
      }
    });

    it('a full recording including both the unit-bearing quantity value and its precision-qualifier answer succeeds through the unmodified recorder', async () => {
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const responsesWithPrecision = baseColorectalResponses.concat([
        { elementKey: 'margin_distance_mm_precision', value: 'at_least' },
      ]);
      const res = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: responsesWithPrecision,
        })
        .expect(201);
      const body = res.body as {
        results: { elementKey: string; value: unknown }[];
      };
      const precisionResult = body.results.find(
        (r) => r.elementKey === 'margin_distance_mm_precision',
      );
      if (precisionResult?.value !== 'at_least') {
        throw new Error(
          `expected the precision-qualifier answer to record like any other coded element, got ${JSON.stringify(precisionResult)}`,
        );
      }
    });
  });

  describe('Conditional requirement tier (issue #664)', () => {
    // Not seed content (proposal §2/§5: no existing seeded element is
    // reclassified, and no new demonstration content is added to the real,
    // citation-heavy seed files for this) -- a test-only element inserted
    // directly, matching observation.e2e-spec.ts's own precedent for
    // proving a real mechanism without touching seed data. Hidden unless
    // 'neoadjuvant_therapy' (already in baseColorectalResponses) equals
    // 'given', reusing the exact visibilityCondition shape the seeded
    // response_to_neoadjuvant_therapy element already uses for real.
    async function createConditionalTestElement(): Promise<{ key: string }> {
      const key = `test_conditional_${randomUUID().slice(0, 8)}`;
      const [csv] = await db
        .insert(codeSystemValue)
        .values({
          system: 'ICCR-SYNOPTIC-TEST',
          code: key,
          version: '2022',
          display: 'Test conditional element (issue #664)',
        })
        .returning();
      const [a] = await db
        .insert(analyte)
        .values({
          codeSystemValueId: csv.id,
          display: csv.display,
          dataType: 'text',
        })
        .returning();
      await db.insert(synopticElement).values({
        synopticProtocolVersionId: colorectalVersionId,
        key,
        label: 'Test conditional element (issue #664)',
        dataType: 'text',
        requirement: 'conditional',
        analyteId: a.id,
        displayOrder: 999,
        visibilityCondition: {
          field: 'neoadjuvant_therapy',
          op: 'eq',
          value: 'given',
        },
      });
      return { key };
    }

    it('is enforced like a required element when visible, and rejects if omitted', async () => {
      const { key } = await createConditionalTestElement();
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const responsesWithNeoadjuvant = baseColorectalResponses
        .filter((r) => r.elementKey !== 'neoadjuvant_therapy')
        .concat([
          { elementKey: 'neoadjuvant_therapy', value: 'given' },
          // The seeded response_to_neoadjuvant_therapy element becomes
          // required too once neoadjuvant_therapy = 'given' -- must be
          // answered here so the *test-only* conditional element (`key`)
          // is the only thing left missing in the first assertion below.
          {
            elementKey: 'response_to_neoadjuvant_therapy',
            value: 'score_0_complete',
          },
        ]);

      const rejected = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: responsesWithNeoadjuvant,
        })
        .expect(400);
      if (!JSON.stringify(rejected.body).includes(key)) {
        throw new Error(
          `expected the conditional element to be named as missing when visible and omitted, got ${JSON.stringify(rejected.body)}`,
        );
      }

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: responsesWithNeoadjuvant.concat([
            { elementKey: key, value: 'answered' },
          ]),
        })
        .expect(201);
    });

    it('is skipped (not enforced) when hidden by its own visibilityCondition', async () => {
      await createConditionalTestElement();
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      // baseColorectalResponses already sets neoadjuvant_therapy = 'not_given'
      // -- the conditional element stays hidden, so omitting it must succeed.
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);
    });
  });

  describe('Repeating element groups (issue #666)', () => {
    // Not seed content, same #664 precedent -- a test-only repeatable group
    // inserted directly, modeled on CAP Breast's real multifocal Tumor
    // Characteristics section (identity field "Tumor Identifier", subordinate
    // field "Tumor Size"), not a synthetic example.
    async function insertTestElement(
      key: string,
      label: string,
      dataType: 'text' | 'quantity',
      opts: {
        parentElementId?: string;
        repeatable?: boolean;
        identityElementKey?: string;
        requirement?: 'required' | 'recommended' | 'conditional';
        visibilityCondition?: Record<string, unknown>;
      } = {},
    ) {
      const [csv] = await db
        .insert(codeSystemValue)
        .values({
          system: 'ICCR-SYNOPTIC-TEST',
          code: key,
          version: '2022',
          display: label,
        })
        .returning();
      const [a] = await db
        .insert(analyte)
        .values({ codeSystemValueId: csv.id, display: label, dataType })
        .returning();
      const [el] = await db
        .insert(synopticElement)
        .values({
          synopticProtocolVersionId: colorectalVersionId,
          parentElementId: opts.parentElementId ?? null,
          key,
          label,
          dataType,
          requirement: opts.requirement ?? 'required',
          analyteId: a.id,
          displayOrder: 999,
          repeatable: opts.repeatable ?? false,
          identityElementKey: opts.identityElementKey ?? null,
          visibilityCondition: opts.visibilityCondition ?? null,
        })
        .returning();
      return el;
    }

    async function createRepeatableTumorGroup(
      rootRequirement: 'required' | 'recommended' = 'recommended',
    ): Promise<{ rootKey: string; identityKey: string; sizeKey: string }> {
      const suffix = randomUUID().slice(0, 8);
      const rootKey = `test_tumor_characteristics_${suffix}`;
      const identityKey = `test_tumor_identifier_${suffix}`;
      const sizeKey = `test_tumor_size_mm_${suffix}`;

      const root = await insertTestElement(
        rootKey,
        'Tumor Characteristics (test)',
        'text',
        {
          repeatable: true,
          identityElementKey: identityKey,
          requirement: rootRequirement,
          // Issue #666's own recorder fix: a repeatable root's requiredness
          // respects its own visibilityCondition, same as any other element
          // (previously an unconditional bug -- see recorder). Gated behind
          // neoadjuvant_therapy = 'given' (baseColorectalResponses always
          // sets 'not_given') so a 'required' root stays harmlessly hidden
          // for every other test/spec file sharing this same seeded
          // colorectalVersionId, exactly like the #664 conditional test
          // element's own precedent.
          visibilityCondition:
            rootRequirement === 'required'
              ? { field: 'neoadjuvant_therapy', op: 'eq', value: 'given' }
              : undefined,
        },
      );
      await insertTestElement(identityKey, 'Tumor Identifier (test)', 'text', {
        parentElementId: root.id,
        requirement: 'required',
      });
      await insertTestElement(sizeKey, 'Tumor Size (test, mm)', 'quantity', {
        parentElementId: root.id,
        requirement: 'required',
      });

      return { rootKey, identityKey, sizeKey };
    }

    it('records two distinct instances, each independently retrievable via the read path (#659)', async () => {
      const { identityKey, sizeKey } = await createRepeatableTumorGroup();
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      const recorded = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses.concat([
            {
              elementKey: makeInstanceResponseKey(identityKey, 'i1'),
              value: '1',
            },
            { elementKey: makeInstanceResponseKey(sizeKey, 'i1'), value: 12 },
            {
              elementKey: makeInstanceResponseKey(identityKey, 'i2'),
              value: '2',
            },
            { elementKey: makeInstanceResponseKey(sizeKey, 'i2'), value: 8 },
          ]),
        })
        .expect(201);
      const recordedResults = (
        recorded.body as {
          results: {
            elementKey: string;
            value: unknown;
            observationId: string;
          }[];
        }
      ).results;
      const sizeI1 = recordedResults.find(
        (r) => r.elementKey === makeInstanceResponseKey(sizeKey, 'i1'),
      );
      const sizeI2 = recordedResults.find(
        (r) => r.elementKey === makeInstanceResponseKey(sizeKey, 'i2'),
      );
      if (
        sizeI1?.value !== 12 ||
        sizeI2?.value !== 8 ||
        sizeI1.observationId === sizeI2.observationId
      ) {
        throw new Error(
          `expected two independent instance Observations, got ${JSON.stringify({ sizeI1, sizeI2 })}`,
        );
      }

      const listRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const responses = (
        listRes.body as {
          responses: {
            synopticProtocolVersionId: string;
            results: { elementKey: string; value: unknown }[];
          }[];
        }
      ).responses;
      const match = responses.find(
        (r) => r.synopticProtocolVersionId === colorectalVersionId,
      );
      const readIdentityI1 = match?.results.find(
        (r) => r.elementKey === makeInstanceResponseKey(identityKey, 'i1'),
      );
      const readIdentityI2 = match?.results.find(
        (r) => r.elementKey === makeInstanceResponseKey(identityKey, 'i2'),
      );
      if (readIdentityI1?.value !== '1' || readIdentityI2?.value !== '2') {
        throw new Error(
          `expected both instances' identity values to round-trip through the read path, got ${JSON.stringify({ readIdentityI1, readIdentityI2 })}`,
        );
      }
    });

    it('does not require the group at all when zero instances are submitted and the root is only "recommended" (optional by default)', async () => {
      await createRepeatableTumorGroup('recommended');
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);
    });

    it('rejects a submitted instance missing one of its own required fields', async () => {
      const { identityKey, sizeKey } = await createRepeatableTumorGroup();
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      const rejected = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          // Instance 'i1' answers its identity field but omits the
          // required size field.
          responses: baseColorectalResponses.concat([
            {
              elementKey: makeInstanceResponseKey(identityKey, 'i1'),
              value: '1',
            },
          ]),
        })
        .expect(400);
      if (
        !JSON.stringify(rejected.body).includes(
          makeInstanceResponseKey(sizeKey, 'i1'),
        )
      ) {
        throw new Error(
          `expected the missing per-instance field to be named, got ${JSON.stringify(rejected.body)}`,
        );
      }
    });

    // Runs last in this describe block deliberately: a 'required' repeatable
    // root, once inserted, stays required for every subsequent recording
    // against this shared colorectalVersionId for the rest of the test run
    // (test elements accumulate, matching #664's own precedent of never
    // deleting them) -- ordered last so it can't leak into the
    // zero-instance/optional or per-instance-field tests above.
    it('rejects when the group itself is required, visible, and zero instances are submitted', async () => {
      const { rootKey } = await createRepeatableTumorGroup('required');
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      // The root's own visibilityCondition (neoadjuvant_therapy = 'given')
      // must be satisfied for it to be required at all -- also brings the
      // seeded response_to_neoadjuvant_therapy element into requiredness,
      // same override #664's own conditional-element test already needed.
      const responsesWithNeoadjuvant = baseColorectalResponses
        .filter((r) => r.elementKey !== 'neoadjuvant_therapy')
        .concat([
          { elementKey: 'neoadjuvant_therapy', value: 'given' },
          {
            elementKey: 'response_to_neoadjuvant_therapy',
            value: 'score_0_complete',
          },
        ]);

      const rejected = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: responsesWithNeoadjuvant,
        })
        .expect(400);
      if (!JSON.stringify(rejected.body).includes(rootKey)) {
        throw new Error(
          `expected the required-but-absent group to be named as missing, got ${JSON.stringify(rejected.body)}`,
        );
      }
    });
  });

  describe('Concept-block composition (issue #667)', () => {
    // Composed into a fresh, isolated, throwaway protocol version -- not
    // the shared colorectalVersionId. The real ICCR/CAP block content is
    // correctly modeled with a genuine, ungated `required` field (matching
    // the real standards, not a test simplification), so composing it onto
    // the widely-reused seeded colorectalVersionId would permanently
    // require that composed field for every later test/file recording
    // against that same shared version for the rest of the run -- caught
    // for real during this issue's own implementation (broke
    // image-attachment.e2e-spec.ts's own unrelated synoptic-finding
    // fixture). A throwaway version sidesteps this entirely and is also
    // the more honest test -- composition is a generic operation, not
    // colorectal-specific.
    async function createThrowawayProtocolVersion(): Promise<string> {
      const suffix = randomUUID().slice(0, 8);
      const [protocolRow] = await db
        .insert(synopticProtocol)
        .values({
          name: `Concept-block composition test fixture ${suffix}`,
          sourceStandard: 'ICCR',
          specimenType: 'test',
        })
        .returning();
      const [versionRow] = await db
        .insert(synopticProtocolVersion)
        .values({
          synopticProtocolId: protocolRow.id,
          version: 1,
          status: 'published',
        })
        .returning();
      return versionRow.id;
    }

    // Composes the real, seeded ICCR "Regional Lymph Nodes" concept block
    // (db/seed/concept-block-regional-lymph-nodes.sql -- the exact same
    // pN0-pN2b field colorectal's own hand-authored lymph_node_status
    // already uses) into a throwaway protocol version, then proves the
    // composed element is recordable/readable through the existing,
    // *unmodified* recorder (#658) and read path (#659) -- the issue's own
    // core promise that composition needs zero downstream changes.
    it('a composed element is recordable and readable exactly like a hand-authored one', async () => {
      const [blockVersion] = await db
        .select({ id: conceptBlockVersion.id })
        .from(conceptBlockVersion)
        .innerJoin(
          conceptBlock,
          eq(conceptBlock.id, conceptBlockVersion.conceptBlockId),
        )
        .where(
          and(
            eq(conceptBlock.key, 'regional_lymph_nodes'),
            eq(conceptBlockVersion.sourceStandard, 'ICCR'),
          ),
        )
        .limit(1);
      if (!blockVersion) {
        throw new Error(
          "expected db/seed/concept-block-regional-lymph-nodes.sql's ICCR 'regional_lymph_nodes' concept block version",
        );
      }

      const targetVersionId = await createThrowawayProtocolVersion();
      const { rootElementIds } = await db.transaction((tx) =>
        composeConceptBlockVersion(tx, {
          conceptBlockVersionId: blockVersion.id,
          targetProtocolVersionId: targetVersionId,
          parentElementId: null,
          keyPrefix: '',
          displayOrderOffset: 0,
        }),
      );
      if (rootElementIds.length !== 1) {
        throw new Error(
          `expected exactly one composed root element (the block's own single top-level lymph_node_status field), got ${rootElementIds.length}`,
        );
      }

      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const recorded = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: targetVersionId,
          responses: [{ elementKey: 'lymph_node_status', value: 'pN1a' }],
        })
        .expect(201);
      const recordedResults = (
        recorded.body as { results: { elementKey: string; value: unknown }[] }
      ).results;
      const composedResult = recordedResults.find(
        (r) => r.elementKey === 'lymph_node_status',
      );
      if (composedResult?.value !== 'pN1a') {
        throw new Error(
          `expected the composed element to record like any hand-authored one, got ${JSON.stringify(composedResult)}`,
        );
      }

      const listRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const responses = (
        listRes.body as {
          responses: {
            synopticProtocolVersionId: string;
            results: { elementKey: string; value: unknown }[];
          }[];
        }
      ).responses;
      const match = responses.find(
        (r) => r.synopticProtocolVersionId === targetVersionId,
      );
      const readComposedResult = match?.results.find(
        (r) => r.elementKey === 'lymph_node_status',
      );
      if (readComposedResult?.value !== 'pN1a') {
        throw new Error(
          `expected the composed element to round-trip through the read path unchanged, got ${JSON.stringify(readComposedResult)}`,
        );
      }
    });

    // Real bug caught during this issue's own implementation: a composed
    // field's visibilityCondition referencing a *sibling within the same
    // block* (the CAP variant's number_of_lymph_nodes_with_tumor, gated on
    // regional_lymph_node_status) must have that reference rewritten with
    // the same keyPrefix, or the composed sibling's real key never matches
    // the stale, unprefixed field name and the condition silently always
    // evaluates against an undefined context value.
    it('rewrites cross-field visibilityCondition references within a composed block', async () => {
      const [blockVersion] = await db
        .select({ id: conceptBlockVersion.id })
        .from(conceptBlockVersion)
        .innerJoin(
          conceptBlock,
          eq(conceptBlock.id, conceptBlockVersion.conceptBlockId),
        )
        .where(
          and(
            eq(conceptBlock.key, 'regional_lymph_nodes'),
            eq(conceptBlockVersion.sourceStandard, 'CAP'),
          ),
        )
        .limit(1);
      if (!blockVersion) {
        throw new Error(
          "expected db/seed/concept-block-regional-lymph-nodes.sql's CAP 'regional_lymph_nodes' concept block version",
        );
      }

      const keyPrefix = `cbtest_${randomUUID().slice(0, 8)}_`;
      const targetVersionId = await createThrowawayProtocolVersion();
      await db.transaction((tx) =>
        composeConceptBlockVersion(tx, {
          conceptBlockVersionId: blockVersion.id,
          targetProtocolVersionId: targetVersionId,
          parentElementId: null,
          keyPrefix,
          displayOrderOffset: 0,
        }),
      );
      const statusKey = `${keyPrefix}regional_lymph_node_status`;
      const countKey = `${keyPrefix}number_of_lymph_nodes_with_tumor`;
      const pnKey = `${keyPrefix}pathological_stage_pn`;

      // Direct structural proof the rewrite happened: the real CAP source
      // field is 'recommended' (never enforced-required regardless of
      // visibility, issue #664's own rule), so requiredness behavior can't
      // prove this -- check the composed row's own stored
      // visibilityCondition.field directly instead.
      const [composedCountElement] = await db
        .select({ visibilityCondition: synopticElement.visibilityCondition })
        .from(synopticElement)
        .where(
          and(
            eq(synopticElement.synopticProtocolVersionId, targetVersionId),
            eq(synopticElement.key, countKey),
          ),
        )
        .limit(1);
      const rewrittenField = (
        composedCountElement?.visibilityCondition as { field?: string } | null
      )?.field;
      if (rewrittenField !== statusKey) {
        throw new Error(
          `expected the composed element's visibilityCondition.field to be rewritten to '${statusKey}', got ${JSON.stringify(rewrittenField)}`,
        );
      }

      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: targetVersionId,
          responses: [
            { elementKey: statusKey, value: 'tumor_present' },
            { elementKey: countKey, value: 2 },
            { elementKey: pnKey, value: 'pN1' },
          ],
        })
        .expect(201);
    });
  });

  describe('Biomarker panel linking (issue #668)', () => {
    // Isolated, throwaway protocols -- same reasoning as the concept-block
    // composition tests above: a real, ungated `required` element left
    // behind on colorectalVersionId would permanently break every later
    // test/file recording against that shared version for the rest of the
    // run.
    async function createThrowawayProtocol(
      isPanel: boolean,
    ): Promise<{ protocolId: string; versionId: string }> {
      const suffix = randomUUID().slice(0, 8);
      const [protocolRow] = await db
        .insert(synopticProtocol)
        .values({
          name: `Biomarker panel linking test fixture ${suffix}`,
          sourceStandard: 'CAP',
          specimenType: 'test',
          isPanel,
        })
        .returning();
      const [versionRow] = await db
        .insert(synopticProtocolVersion)
        .values({
          synopticProtocolId: protocolRow.id,
          version: 1,
          status: 'published',
        })
        .returning();
      return { protocolId: protocolRow.id, versionId: versionRow.id };
    }

    async function insertTestElement(
      versionId: string,
      key: string,
      opts: { visibilityCondition?: Record<string, unknown> } = {},
    ) {
      const [csv] = await db
        .insert(codeSystemValue)
        .values({
          system: 'CAP-SYNOPTIC-TEST',
          code: key,
          version: '1',
          display: key,
        })
        .returning();
      const [a] = await db
        .insert(analyte)
        .values({ codeSystemValueId: csv.id, display: key, dataType: 'text' })
        .returning();
      await db.insert(synopticElement).values({
        synopticProtocolVersionId: versionId,
        key,
        label: key,
        dataType: 'text',
        requirement: 'required',
        analyteId: a.id,
        displayOrder: 0,
        visibilityCondition: opts.visibilityCondition ?? null,
      });
    }

    it("GET .../versions/:versionId surfaces an organ protocol's linked panels, each with its own published version id", async () => {
      const organ = await createThrowawayProtocol(false);
      const panel = await createThrowawayProtocol(true);
      await db.insert(synopticProtocolLinkedPanel).values({
        organProtocolId: organ.protocolId,
        panelProtocolId: panel.protocolId,
      });

      const res = await request(app.getHttpServer())
        .get(
          `/v1/synoptic-protocols/${organ.protocolId}/versions/${organ.versionId}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        linkedPanels: {
          id: string;
          name: string;
          publishedVersionId: string | null;
        }[];
      };
      const linked = body.linkedPanels.find((p) => p.id === panel.protocolId);
      if (linked?.publishedVersionId !== panel.versionId) {
        throw new Error(
          `expected the organ protocol to surface the linked panel's own published version id, got ${JSON.stringify(body.linkedPanels)}`,
        );
      }
    });

    it('a linked panel is independently recordable and readable through the existing, unmodified recorder/read path', async () => {
      const panel = await createThrowawayProtocol(true);
      await insertTestElement(panel.versionId, 'er_status');

      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const recorded = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: panel.versionId,
          responses: [{ elementKey: 'er_status', value: 'positive' }],
        })
        .expect(201);
      const results = (
        recorded.body as { results: { elementKey: string; value: unknown }[] }
      ).results;
      if (
        results.find((r) => r.elementKey === 'er_status')?.value !== 'positive'
      ) {
        throw new Error(
          `expected the linked panel's own response to record like any protocol, got ${JSON.stringify(results)}`,
        );
      }

      const listRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const responses = (
        listRes.body as {
          responses: {
            synopticProtocolVersionId: string;
            results: { elementKey: string; value: unknown }[];
          }[];
        }
      ).responses;
      const match = responses.find(
        (r) => r.synopticProtocolVersionId === panel.versionId,
      );
      if (
        match?.results.find((r) => r.elementKey === 'er_status')?.value !==
        'positive'
      ) {
        throw new Error(
          `expected the linked panel's response to round-trip through the read path unchanged, got ${JSON.stringify(match)}`,
        );
      }
    });

    // ICCR's "inline" embedding shape: composeProtocolVersionElements
    // copies one protocol version's own tree into another, including the
    // same cross-field visibilityCondition rewrite #667 established for
    // concept blocks.
    it("composeProtocolVersionElements inline-embeds a panel's tree into an organ protocol version, rewriting cross-field conditions", async () => {
      const panel = await createThrowawayProtocol(true);
      await insertTestElement(panel.versionId, 'her2_status');
      await insertTestElement(panel.versionId, 'her2_ihc_score', {
        visibilityCondition: {
          field: 'her2_status',
          op: 'eq',
          value: 'equivocal',
        },
      });

      const organ = await createThrowawayProtocol(false);
      const keyPrefix = `panel_${randomUUID().slice(0, 8)}_`;
      const { rootElementIds } = await db.transaction((tx) =>
        composeProtocolVersionElements(tx, {
          sourceProtocolVersionId: panel.versionId,
          targetProtocolVersionId: organ.versionId,
          parentElementId: null,
          keyPrefix,
          displayOrderOffset: 0,
        }),
      );
      if (rootElementIds.length !== 2) {
        throw new Error(
          `expected both panel elements to be composed as top-level elements, got ${rootElementIds.length}`,
        );
      }

      const [composedScoreElement] = await db
        .select({ visibilityCondition: synopticElement.visibilityCondition })
        .from(synopticElement)
        .where(
          and(
            eq(synopticElement.synopticProtocolVersionId, organ.versionId),
            eq(synopticElement.key, `${keyPrefix}her2_ihc_score`),
          ),
        )
        .limit(1);
      const rewrittenField = (
        composedScoreElement?.visibilityCondition as { field?: string } | null
      )?.field;
      if (rewrittenField !== `${keyPrefix}her2_status`) {
        throw new Error(
          `expected the composed element's visibilityCondition.field to be rewritten to '${keyPrefix}her2_status', got ${JSON.stringify(rewrittenField)}`,
        );
      }

      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: organ.versionId,
          responses: [
            { elementKey: `${keyPrefix}her2_status`, value: 'positive' },
          ],
        })
        .expect(201);
    });
  });

  describe('Breast Biomarker Panel (issue #551)', () => {
    // Real, seeded content (db/seed/synoptic-protocol-breast-biomarker.sql):
    // a real, cited CAP biomarker panel, linked to the existing seeded
    // ICCR breast organ protocol via #668's mechanism.
    async function resolveBreastBiomarkerPanel(): Promise<{
      panelId: string;
      panelVersionId: string;
    }> {
      const res = await request(app.getHttpServer())
        .get('/v1/synoptic-protocols')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const panel = (
        res.body as {
          protocols: {
            id: string;
            name: string;
            sourceStandard: string;
            publishedVersionId: string | null;
          }[];
        }
      ).protocols.find(
        (p) =>
          p.name === 'Breast Biomarker Panel (ER/PR/HER2)' &&
          p.sourceStandard === 'CAP',
      );
      if (!panel?.publishedVersionId) {
        throw new Error(
          "expected db/seed/synoptic-protocol-breast-biomarker.sql's 'Breast Biomarker Panel (ER/PR/HER2)' protocol",
        );
      }
      return { panelId: panel.id, panelVersionId: panel.publishedVersionId };
    }

    it("is linked from the existing breast organ protocol's own version response", async () => {
      const protocolsRes = await request(app.getHttpServer())
        .get('/v1/synoptic-protocols')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const breast = (
        protocolsRes.body as {
          protocols: {
            id: string;
            name: string;
            sourceStandard: string;
            publishedVersionId: string | null;
          }[];
        }
      ).protocols.find(
        (p) =>
          p.name === 'Invasive Carcinoma of the Breast' &&
          p.sourceStandard === 'ICCR',
      );
      if (!breast?.publishedVersionId) {
        throw new Error(
          "expected the seeded, published 'Invasive Carcinoma of the Breast' protocol",
        );
      }

      const versionRes = await request(app.getHttpServer())
        .get(
          `/v1/synoptic-protocols/${breast.id}/versions/${breast.publishedVersionId}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const linkedPanels = (
        versionRes.body as {
          linkedPanels: {
            name: string;
            sourceStandard: string;
            publishedVersionId: string | null;
          }[];
        }
      ).linkedPanels;
      const panel = linkedPanels.find(
        (p) => p.name === 'Breast Biomarker Panel (ER/PR/HER2)',
      );
      if (!panel?.publishedVersionId) {
        throw new Error(
          `expected the breast biomarker panel among linkedPanels, got ${JSON.stringify(linkedPanels)}`,
        );
      }
    });

    it('records a real ER-positive/PgR-positive/HER2-negative result, independently of the organ protocol, with HER2 ISH left unanswered (recommended, not required)', async () => {
      const { panelVersionId } = await resolveBreastBiomarkerPanel();
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      const recorded = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: panelVersionId,
          responses: [
            { elementKey: 'er_status', value: 'positive' },
            { elementKey: 'er_percentage_positive', value: 95 },
            { elementKey: 'er_intensity', value: 'strong_3plus' },
            { elementKey: 'pgr_status', value: 'positive' },
            { elementKey: 'pgr_percentage_positive', value: 80 },
            { elementKey: 'pgr_intensity', value: 'moderate_2plus' },
            { elementKey: 'her2_ihc_score', value: 'score_0' },
            // her2_ish_performed deliberately omitted -- 'recommended', not
            // 'required' (the design partner's own real usage: no in-house
            // ISH/FISH testing).
          ],
        })
        .expect(201);
      const results = (
        recorded.body as { results: { elementKey: string; value: unknown }[] }
      ).results;
      const er = results.find((r) => r.elementKey === 'er_status');
      const her2 = results.find((r) => r.elementKey === 'her2_ihc_score');
      if (er?.value !== 'positive' || her2?.value !== 'score_0') {
        throw new Error(
          `expected the real biomarker responses to record correctly, got ${JSON.stringify(results)}`,
        );
      }

      const listRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const responses = (
        listRes.body as {
          responses: {
            synopticProtocolVersionId: string;
            results: { elementKey: string; value: unknown }[];
          }[];
        }
      ).responses;
      const match = responses.find(
        (r) => r.synopticProtocolVersionId === panelVersionId,
      );
      if (!match) {
        throw new Error(
          `expected the panel's own response independently readable, got ${JSON.stringify(responses)}`,
        );
      }
    });

    it('rejects an omitted required core field (her2_ihc_score) even though HER2 ISH itself stays optional', async () => {
      const { panelVersionId } = await resolveBreastBiomarkerPanel();
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();

      const rejected = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: panelVersionId,
          responses: [
            { elementKey: 'er_status', value: 'negative' },
            { elementKey: 'pgr_status', value: 'negative' },
            // her2_ihc_score omitted -- 'required', must be rejected.
          ],
        })
        .expect(400);
      if (!JSON.stringify(rejected.body).includes('her2_ihc_score')) {
        throw new Error(
          `expected her2_ihc_score to be named as missing, got ${JSON.stringify(rejected.body)}`,
        );
      }
    });
  });

  describe('Response option terminology binding (issue #670)', () => {
    // Real, seeded content (db/seed/synoptic-response-option-terminology.sql):
    // colorectal's own histological_tumor_type option 'adenocarcinoma_nos'
    // is bound to its real ICD-O-3 code 8140/3.
    it('GET .../versions/:versionId resolves the ICD-O-3 binding for a real, seeded response option', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/v1/synoptic-protocols/${colorectalProtocolId}/versions/${colorectalVersionId}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        elements: {
          key: string;
          responseOptions: {
            value: string;
            codeSystemValueId: string | null;
            codeSystemCode: string | null;
            codeSystemDisplay: string | null;
          }[];
        }[];
      };
      const histType = body.elements.find(
        (e) => e.key === 'histological_tumor_type',
      );
      const bound = histType?.responseOptions.find(
        (o) => o.value === 'adenocarcinoma_nos',
      );
      if (
        !bound?.codeSystemValueId ||
        bound.codeSystemCode !== 'ICD-O-3 8140/3' ||
        bound.codeSystemDisplay !== 'Adenocarcinoma, NOS'
      ) {
        throw new Error(
          `expected adenocarcinoma_nos bound to ICD-O-3 8140/3, got ${JSON.stringify(bound)}`,
        );
      }
      // Opportunistic, not a backfill (issue's own instruction) -- an
      // unbound option on the same element is expected, not a gap.
      const unbound = histType?.responseOptions.find(
        (o) => o.value === 'other',
      );
      if (unbound?.codeSystemValueId !== null) {
        throw new Error(
          `expected 'other' to remain unbound, got ${JSON.stringify(unbound)}`,
        );
      }
    });

    it('a response bound to a terminology code records and reads exactly like any other coded response, end to end', async () => {
      const { caseId, orderedTestId, specimenId } =
        await createCaseWithOrderedTest();
      const recorded = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses
            .filter((r) => r.elementKey !== 'histological_tumor_type')
            .concat([
              {
                elementKey: 'histological_tumor_type',
                value: 'adenocarcinoma_nos',
              },
            ]),
        })
        .expect(201);
      const results = (
        recorded.body as { results: { elementKey: string; value: unknown }[] }
      ).results;
      if (
        results.find((r) => r.elementKey === 'histological_tumor_type')
          ?.value !== 'adenocarcinoma_nos'
      ) {
        throw new Error(
          `expected the code-bound response option to record like any other, got ${JSON.stringify(results)}`,
        );
      }
    });
  });

  describe('Part-scoped responses (issue #674)', () => {
    // A case with two eligible parts recorded against the SAME protocol --
    // both share the same orderedTestId (order.orderedTests[0], there is
    // no per-part ordered test in this schema), so specimenId is the only
    // thing that can distinguish their recordings.
    async function createCaseWithTwoParts(): Promise<{
      caseId: string;
      orderedTestId: string;
      specimenIdA: string;
      specimenIdB: string;
    }> {
      const orderId = await createOrder();
      const caseRes = await request(app.getHttpServer())
        .post('/v1/cases')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderId,
          parts: [{ specimenType: 'tissue' }, { specimenType: 'tissue' }],
        })
        .expect(201);
      const caseBody = caseRes.body as {
        resourceId: string;
        after: { partIds: string[] };
      };
      const orderRes = await request(app.getHttpServer())
        .get(`/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const orderedTestId = (
        orderRes.body as { orderedTests: { id: string }[] }
      ).orderedTests[0].id;
      return {
        caseId: caseBody.resourceId,
        orderedTestId,
        specimenIdA: caseBody.after.partIds[0],
        specimenIdB: caseBody.after.partIds[1],
      };
    }

    it('two parts recorded against the same protocol are each independently retrievable, and recording the second never supersedes the first', async () => {
      const { caseId, orderedTestId, specimenIdA, specimenIdB } =
        await createCaseWithTwoParts();

      const recordedA = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId: specimenIdA,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);
      const tableObservationIdA = (
        recordedA.body as { tableObservationId: string }
      ).tableObservationId;

      const recordedB = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          specimenId: specimenIdB,
          synopticProtocolVersionId: colorectalVersionId,
          responses: baseColorectalResponses,
        })
        .expect(201);
      const recordedBBody = recordedB.body as {
        tableObservationId: string;
        amendmentOf: string | null;
      };
      if (recordedBBody.amendmentOf !== null) {
        throw new Error(
          `expected part B's recording to be a first-ever recording (amendmentOf: null), not an amendment of part A's own grid, got ${JSON.stringify(recordedBBody)}`,
        );
      }

      // Part A's own grid must still be the current chain head -- recording
      // part B must never have superseded it.
      const [gridA] = await db
        .select({ supersededBy: observation.supersededBy })
        .from(observation)
        .where(eq(observation.id, tableObservationIdA))
        .limit(1);
      if (gridA?.supersededBy !== null) {
        throw new Error(
          `expected part A's grid Observation to remain un-superseded after recording part B, got ${JSON.stringify(gridA)}`,
        );
      }

      const listRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const responses = (
        listRes.body as {
          responses: {
            specimenId: string | null;
            tableObservationId: string;
          }[];
        }
      ).responses;
      const forA = responses.find((r) => r.specimenId === specimenIdA);
      const forB = responses.find((r) => r.specimenId === specimenIdB);
      if (
        forA?.tableObservationId !== tableObservationIdA ||
        forB?.tableObservationId !== recordedBBody.tableObservationId
      ) {
        throw new Error(
          `expected both parts' own responses independently retrievable and distinguishable, got ${JSON.stringify(responses)}`,
        );
      }
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
