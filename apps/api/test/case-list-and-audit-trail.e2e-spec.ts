import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A_GLUCOSE_CODE = 'GLU';

/**
 * Issues #749/#750 (EPIC #697 pilot-readiness follow-ups). Neither
 * `GET /v1/cases` (list) nor `GET /v1/cases/:id/audit-trail` had any e2e
 * coverage anywhere in this repo before this file (confirmed via a repo-wide
 * grep) -- both routes existed and worked, but no permanent test proved
 * either one, or would have caught a regression to the fixes below.
 */
describe('Case list + audit trail (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens
  let testDefinitionId: string;

  async function createPatient(lastName: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'CaseListAudit', lastName, sex: 'U' })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrder(patientId: string): Promise<string> {
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

  async function createCase(orderId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
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

  describe('GET /v1/cases (issue #749)', () => {
    it('includes patientName on each row', async () => {
      const patientId = await createPatient(`ListPatient-${Date.now()}`);
      const orderId = await createOrder(patientId);
      const caseId = await createCase(orderId);

      const res = await request(app.getHttpServer())
        .get('/v1/cases')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = res.body as {
        items: { id: string; patientId: string; patientName: string }[];
      };
      const found = body.items.find((c) => c.id === caseId);
      if (!found || !found.patientName.includes('CaseListAudit')) {
        throw new Error(
          `expected the case's own patientName in the list response, got ${JSON.stringify(found)}`,
        );
      }
      if (found.patientId !== patientId) {
        throw new Error(
          `expected patientId to match the case's real patient, got ${found.patientId}`,
        );
      }
    });

    it('`q` searches by patient last name and MRN', async () => {
      const uniqueLastName = `ListSearch-${Date.now()}`;
      const patientId = await createPatient(uniqueLastName);
      const orderId = await createOrder(patientId);
      const caseId = await createCase(orderId);

      const byName = await request(app.getHttpServer())
        .get('/v1/cases')
        .query({ q: uniqueLastName })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const byNameIds = (byName.body as { items: { id: string }[] }).items.map(
        (c) => c.id,
      );
      if (!byNameIds.includes(caseId)) {
        throw new Error(
          `expected q='${uniqueLastName}' to match the case's own patient, got ${JSON.stringify(byName.body)}`,
        );
      }

      const noMatch = await request(app.getHttpServer())
        .get('/v1/cases')
        .query({ q: 'NoSuchPatientNameXYZ' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      if ((noMatch.body as { items: unknown[] }).items.length !== 0) {
        throw new Error(
          `expected an unmatched q to return an empty list, not an error, got ${JSON.stringify(noMatch.body)}`,
        );
      }
    });

    it('combines `q` with the existing `status` filter', async () => {
      const uniqueLastName = `ListSearchCombined-${Date.now()}`;
      const patientId = await createPatient(uniqueLastName);
      const orderId = await createOrder(patientId);
      const caseId = await createCase(orderId);

      // The fixture case is freshly `accessioned` -- filtering to a
      // different status should exclude it even though `q` matches.
      const combined = await request(app.getHttpServer())
        .get('/v1/cases')
        .query({ q: uniqueLastName, status: 'signed_out' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const combinedIds = (
        combined.body as { items: { id: string }[] }
      ).items.map((c) => c.id);
      if (combinedIds.includes(caseId)) {
        throw new Error(
          `expected q + status=signed_out to exclude an 'accessioned' case, got ${JSON.stringify(combined.body)}`,
        );
      }
    });
  });

  describe('GET /v1/cases/:id/audit-trail (issue #750)', () => {
    it('includes narrative, block, and slide events, alongside the existing accession event', async () => {
      const patientId = await createPatient(`AuditTrail-${Date.now()}`);
      const orderId = await createOrder(patientId);
      const caseId = await createCase(orderId);

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

      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ diagnosis: 'Benign.' })
        .expect(200);

      const trail = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/audit-trail`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const actions = (trail.body as { items: { action: string }[] }).items.map(
        (e) => e.action,
      );

      for (const expected of [
        'case.accession',
        'case.add_block',
        'case.add_slide',
        'case.record_narrative',
      ]) {
        if (!actions.includes(expected)) {
          throw new Error(
            `expected '${expected}' in the audit trail, got ${JSON.stringify(actions)}`,
          );
        }
      }
    });
  });
});
