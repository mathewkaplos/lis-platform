import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A_GLUCOSE_CODE = 'GLU';

/**
 * FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md,
 * issue #795). First e2e coverage for `/v1/specimen-processing-batches` --
 * a brand-new route/table with no prior consumers.
 */
describe('Specimen processing batch QC (e2e)', () => {
  let app: INestApplication<App>;
  let tokenTechnologist: string; // test-user: technologist, tenant A -- no record_processing_qc
  let tokenPathologist: string; // test-user-4: technologist+pathologist, tenant A -- record_processing_qc
  let tokenTenantB: string; // test-user-2: tenant B
  let testDefinitionId: string;

  async function createPatient(lastName: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenTechnologist}`)
      .send({ firstName: 'ProcessingQc', lastName, sex: 'U' })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrder(patientId: string): Promise<string> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenTechnologist}`)
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
      .set('Authorization', `Bearer ${tokenTechnologist}`)
      .send({ patientId, testDefinitionIds: [testDefinitionId] })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createCase(orderId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenTechnologist}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  function validBatchBody(
    caseId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      histoTechName: 'Jane Histotech',
      grossingDate: new Date().toISOString(),
      slidesForwardedDate: new Date().toISOString(),
      tissueFixation: 'adequate',
      processing: 'optimal',
      sectionThickness: 'acceptable',
      tissueFoldsTears: 'absent',
      stainingQuality: 'acceptable',
      coverslipping: 'no_artefacts',
      tissueOrientation: 'satisfactory',
      comments: 'All good.',
      cases: [{ caseId, slideCount: 3, pathologistRemarks: 'Clean sections.' }],
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenTechnologist, tokenPathologist, tokenTenantB] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user-2', 'test-password-2'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a pathologist can record a batch covering one or more cases', async () => {
    const patientId = await createPatient(`Record-${Date.now()}`);
    const orderId = await createOrder(patientId);
    const caseId = await createCase(orderId);

    const res = await request(app.getHttpServer())
      .post('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenPathologist}`)
      .send(validBatchBody(caseId))
      .expect(201);

    const body = res.body as {
      resourceId: string;
      after: { cases: { caseId: string; slideCount: number }[] };
    };
    if (!body.resourceId) {
      throw new Error(`expected a resourceId, got ${JSON.stringify(body)}`);
    }
    const recordedCase = body.after.cases.find((c) => c.caseId === caseId);
    if (!recordedCase || recordedCase.slideCount !== 3) {
      throw new Error(
        `expected the case row to round-trip, got ${JSON.stringify(body.after)}`,
      );
    }
  });

  it('a technologist without record_processing_qc gets 403', async () => {
    const patientId = await createPatient(`Rbac-${Date.now()}`);
    const orderId = await createOrder(patientId);
    const caseId = await createCase(orderId);

    await request(app.getHttpServer())
      .post('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenTechnologist}`)
      .send(validBatchBody(caseId))
      .expect(403);
  });

  it('an unknown case id 400s the whole request, not a partial batch', async () => {
    await request(app.getHttpServer())
      .post('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenPathologist}`)
      .send(validBatchBody('00000000-0000-0000-0000-000000000099'))
      .expect(400);
  });

  it('a malformed criterion value 400s with a real Zod field error, not a 500', async () => {
    const patientId = await createPatient(`Malformed-${Date.now()}`);
    const orderId = await createOrder(patientId);
    const caseId = await createCase(orderId);

    const res = await request(app.getHttpServer())
      .post('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenPathologist}`)
      .send(validBatchBody(caseId, { tissueFixation: 'not_a_real_value' }))
      .expect(400);
    const body = res.body as { code?: string };
    if (body.code !== 'validation_failed') {
      throw new Error(
        `expected a validation_failed problem body, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it('a cross-tenant batch id returns 404, not 403 (RLS)', async () => {
    const patientId = await createPatient(`CrossTenant-${Date.now()}`);
    const orderId = await createOrder(patientId);
    const caseId = await createCase(orderId);
    const createRes = await request(app.getHttpServer())
      .post('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenPathologist}`)
      .send(validBatchBody(caseId))
      .expect(201);
    const batchId = (createRes.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .get(`/v1/specimen-processing-batches/${batchId}`)
      .set('Authorization', `Bearer ${tokenTenantB}`)
      .expect(404);
  });

  it('GET /v1/specimen-processing-batches lists batches with resolved case accession/patient data', async () => {
    const uniqueLastName = `List-${Date.now()}`;
    const patientId = await createPatient(uniqueLastName);
    const orderId = await createOrder(patientId);
    const caseId = await createCase(orderId);
    await request(app.getHttpServer())
      .post('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenPathologist}`)
      .send(validBatchBody(caseId))
      .expect(201);

    const listRes = await request(app.getHttpServer())
      .get('/v1/specimen-processing-batches')
      .set('Authorization', `Bearer ${tokenTechnologist}`)
      .expect(200);
    const batches = listRes.body as {
      cases: { caseId: string; patientLastName?: string }[];
    }[];
    const found = batches.find((b) => b.cases.some((c) => c.caseId === caseId));
    if (!found) {
      throw new Error(
        `expected the new batch in the list, got ${JSON.stringify(batches)}`,
      );
    }
    const foundCase = found.cases.find((c) => c.caseId === caseId);
    if (foundCase?.patientLastName !== uniqueLastName) {
      throw new Error(
        `expected the case row's patientLastName to resolve, got ${JSON.stringify(foundCase)}`,
      );
    }
  });
});
