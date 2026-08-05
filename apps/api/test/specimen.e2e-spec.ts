import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

// Seeded by db/seed/chemistry-catalog.sql; also the tenant test-user
// (technologist)/test-user-3 (no role)/test-user-4 (dual-role) carry, per
// infra/keycloak/lis-realm.json.
const TENANT_A_GLUCOSE_CODE = 'GLU';
const TENANT_A_BUN_CODE = 'BUN';

/**
 * TASK-047 (FEAT-013): proves the first real writer to
 * `specimen`/`specimen_fulfillment` (both created by TASK-023 with zero
 * prior consumers) through the live API -- real Keycloak tokens, real
 * Postgres, matching order.e2e-spec.ts's own standard. One combined
 * create action (revision §1/§5): `rejectionReason` presence/absence is
 * the accept/reject branch, not two separate endpoints.
 */
describe('Specimen API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let noRoleToken: string;
  let patientId: string;

  async function createOrder(
    token: string,
    testCodes: string[] = [TENANT_A_GLUCOSE_CODE, TENANT_A_BUN_CODE],
  ): Promise<{ orderId: string; orderedTestIds: string[] }> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    const testDefinitionIds = testCodes.map((code) => {
      const found = catalog.tests.find((t) => t.code === code);
      if (!found) {
        throw new Error(
          `expected db/seed/chemistry-catalog.sql fixture '${code}' in /v1/catalog`,
        );
      }
      return found.id;
    });

    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
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
      .send({ firstName: 'Specimen', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function auditCount(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  it('accepts a specimen (default: all currently-ordered tests): assigns an accession number, status accessioned, ordered_test -> received, audited', async () => {
    const { orderId, orderedTestIds } = await createOrder(tokenA);
    const before = await auditCount(tokenA);

    const res = await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'whole_blood' })
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: {
        accessionNumber: string;
        status: string;
        rejectionReason: string | null;
        fulfilledOrderedTestIds?: string[];
      };
    };
    if (!/^\d{6}-\d{6}$/.test(body.after.accessionNumber)) {
      throw new Error(
        `expected a well-formed YYMMDD-NNNNNN accession number, got ${JSON.stringify(res.body)}`,
      );
    }
    if (body.after.status !== 'accessioned' || body.after.rejectionReason) {
      throw new Error(`unexpected specimen state: ${JSON.stringify(res.body)}`);
    }
    const fulfilled = body.after.fulfilledOrderedTestIds ?? [];
    if (
      fulfilled.length !== orderedTestIds.length ||
      !orderedTestIds.every((id) => fulfilled.includes(id))
    ) {
      throw new Error(
        `expected every ordered test fulfilled, got ${JSON.stringify(res.body)}`,
      );
    }

    const orderRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderBody = orderRes.body as {
      orderedTests: { id: string; status: string }[];
    };
    if (!orderBody.orderedTests.every((t) => t.status === 'received')) {
      throw new Error(
        `expected every ordered_test transitioned to 'received', got ${JSON.stringify(orderBody)}`,
      );
    }

    const after = await auditCount(tokenA);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it('accepts a specimen fulfilling an explicit orderedTestIds subset', async () => {
    const { orderId, orderedTestIds } = await createOrder(tokenA);
    const [firstId] = orderedTestIds;

    const res = await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'serum', orderedTestIds: [firstId] })
      .expect(201);
    const body = res.body as {
      after: { fulfilledOrderedTestIds?: string[] };
    };
    if (
      body.after.fulfilledOrderedTestIds?.length !== 1 ||
      body.after.fulfilledOrderedTestIds[0] !== firstId
    ) {
      throw new Error(
        `expected only the explicitly-listed test fulfilled, got ${JSON.stringify(res.body)}`,
      );
    }

    const orderRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderBody = orderRes.body as {
      orderedTests: { id: string; status: string }[];
    };
    const untouched = orderBody.orderedTests.find((t) => t.id !== firstId);
    if (untouched?.status !== 'ordered') {
      throw new Error(
        `expected the non-fulfilled test to stay 'ordered', got ${JSON.stringify(orderBody)}`,
      );
    }
  });

  it('rejects with a coded reason: status rejected, ordered_test -> rejected, accession number still assigned (NOT NULL), audited', async () => {
    const { orderId } = await createOrder(tokenA);
    const before = await auditCount(tokenA);

    const res = await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderId,
        specimenType: 'whole_blood',
        rejectionReason: 'haemolysed',
      })
      .expect(201);
    const body = res.body as {
      after: {
        accessionNumber: string;
        status: string;
        rejectionReason: string;
      };
    };
    if (
      body.after.status !== 'rejected' ||
      body.after.rejectionReason !== 'haemolysed' ||
      !body.after.accessionNumber
    ) {
      throw new Error(
        `expected a rejected specimen with an accession number, got ${JSON.stringify(res.body)}`,
      );
    }

    const orderRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderBody = orderRes.body as { orderedTests: { status: string }[] };
    if (!orderBody.orderedTests.every((t) => t.status === 'rejected')) {
      throw new Error(
        `expected every fulfilled ordered_test transitioned to 'rejected', got ${JSON.stringify(orderBody)}`,
      );
    }

    const after = await auditCount(tokenA);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it('rejects an invalid (non-coded) rejectionReason with 400, writing nothing', async () => {
    const { orderId } = await createOrder(tokenA);
    const before = await auditCount(tokenA);

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderId,
        specimenType: 'whole_blood',
        rejectionReason: 'the tube looked funny',
      })
      .expect(400);

    const after = await auditCount(tokenA);
    if (after !== before) {
      throw new Error(
        `expected no audit_event row on a rejected (400) create, before=${before} after=${after}`,
      );
    }
  });

  it('rejects an unknown orderId with 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId: randomUUID(), specimenType: 'whole_blood' })
      .expect(400);
  });

  it('rejects orderedTestIds not belonging to the given order with 400', async () => {
    const { orderId: orderA } = await createOrder(tokenA);
    const { orderedTestIds: idsFromOrderB } = await createOrder(tokenA, [
      TENANT_A_GLUCOSE_CODE,
    ]);

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderId: orderA,
        specimenType: 'whole_blood',
        orderedTestIds: idsFromOrderB,
      })
      .expect(400);
  });

  it('returns 400 when no ordered tests are eligible (already fully received)', async () => {
    const { orderId } = await createOrder(tokenA);
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'whole_blood' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'whole_blood' })
      .expect(400);
  });

  it('denies a caller with no manage_specimens-granting role (403), writing nothing', async () => {
    const { orderId } = await createOrder(tokenA);
    const before = await auditCount(tokenA);

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${noRoleToken}`)
      .send({ orderId, specimenType: 'whole_blood' })
      .expect(403);

    const after = await auditCount(tokenA);
    if (after !== before) {
      throw new Error(
        `expected no audit_event row on a 403, before=${before} after=${after}`,
      );
    }
  });

  it('search() and getById() include the fulfilled ordered test ids', async () => {
    const { orderId, orderedTestIds } = await createOrder(tokenA);
    const created = await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'whole_blood' })
      .expect(201);
    const specimenId = (created.body as { resourceId: string }).resourceId;

    const searchRes = await request(app.getHttpServer())
      .get('/v1/specimens')
      .query({ orderId })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const searchResults = searchRes.body as {
      id: string;
      fulfilledOrderedTestIds?: string[];
    }[];
    const found = searchResults.find((s) => s.id === specimenId);
    if (
      !found ||
      found.fulfilledOrderedTestIds?.length !== orderedTestIds.length
    ) {
      throw new Error(
        `expected search() to include fulfilled ordered test ids, got ${JSON.stringify(found)}`,
      );
    }

    const byIdRes = await request(app.getHttpServer())
      .get(`/v1/specimens/${specimenId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byId = byIdRes.body as { fulfilledOrderedTestIds?: string[] };
    if (byId.fulfilledOrderedTestIds?.length !== orderedTestIds.length) {
      throw new Error(
        `expected getById() to include fulfilled ordered test ids, got ${JSON.stringify(byId)}`,
      );
    }
  });

  it('returns 404 for a specimen created under a different tenant (RLS at the API layer, not just the DB layer)', async () => {
    const { orderId } = await createOrder(tokenA);
    const created = await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'whole_blood' })
      .expect(201);
    const specimenId = (created.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .get(`/v1/specimens/${specimenId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/specimens/${specimenId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('returns 404 (not 500) for a well-formed but nonexistent specimen id', async () => {
    await request(app.getHttpServer())
      .get(`/v1/specimens/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });
});
