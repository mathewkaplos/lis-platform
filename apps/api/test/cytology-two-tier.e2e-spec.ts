import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { getKeycloakFreshToken } from './get-keycloak-fresh-token';

const TENANT_A_GLUCOSE_CODE = 'GLU';

/**
 * FEAT-063 (docs/plans/feat-063-cytology-two-tier-workflow.md, issue #542).
 * Proves all three issue ACs through the live API, real Keycloak tokens,
 * real Postgres -- matching case-sign-out.e2e-spec.ts's own standard.
 * `finalize`'s regression for a case that does NOT require two-tier review
 * is covered by case-sign-out.e2e-spec.ts itself, re-run unmodified rather
 * than duplicated here.
 */
describe('Cytology two-tier workflow: screen -> review -> sign-out (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens only, no verify
  let tokenVerifier: string; // test-user-4: technologist+verifier, tenant A -- has `verify`, fresh auth_time
  let patientId: string;
  let testDefinitionId: string;

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

  /** A fully lineage-complete case (1 part, 1 active block, 1 active slide)
   * of the given specimen type -- ready to screen/finalize. */
  async function createCase(specimenType: string): Promise<string> {
    const orderId = await createOrder();
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType }] })
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

    return caseId;
  }

  /** A case with a part but no block yet -- lineage-incomplete. */
  async function createIncompleteCase(specimenType: string): Promise<string> {
    const orderId = await createOrder();
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType }] })
      .expect(201);
    return (caseRes.body as { resourceId: string }).resourceId;
  }

  async function listCases(
    token: string,
    status?: string,
  ): Promise<{ id: string; status: string }[]> {
    const res = await request(app.getHttpServer())
      .get(status ? `/v1/cases?status=${status}` : '/v1/cases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { items: { id: string; status: string }[] }).items;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenVerifier] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      // Real Authorization Code + PKCE flow -- finalize needs a genuinely
      // fresh auth_time (StepUpGuard, unchanged from FEAT-059).
      getKeycloakFreshToken('test-user-4', 'test-password-4'),
    ]);

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'TwoTier', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC #1: a cervical cytology case flows screen -> pending_review -> finalize; finalize is rejected before screening', async () => {
    const caseId = await createCase('cervical_cytology');

    // Cannot sign out before screening -- the new AC #1 precondition.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(400);

    const screenRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const screenBody = screenRes.body as { after: { status: string } };
    if (screenBody.after.status !== 'pending_review') {
      throw new Error(
        `expected status pending_review after screen, got ${JSON.stringify(screenBody)}`,
      );
    }

    // Screening again is rejected -- no longer in a screenable status.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);

    const finalizeRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);
    const finalizeBody = finalizeRes.body as { case: { status: string } };
    if (finalizeBody.case.status !== 'signed_out') {
      throw new Error(
        `expected status signed_out after finalize, got ${JSON.stringify(finalizeBody)}`,
      );
    }
  });

  it('AC #2: a cytotechnologist-only token (manage_specimens, no verify) can screen but cannot sign out a cytology case', async () => {
    const caseId = await createCase('cervical_cytology');

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    // Same capability gate finalize already had (FEAT-059, unchanged) --
    // no new capability was needed for this AC to hold.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });

  it('screen rejects a case whose specimen type does not require two-tier review', async () => {
    const caseId = await createCase('tissue');
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it('screen rejects a case with an incomplete lineage (no active block yet)', async () => {
    const caseId = await createIncompleteCase('cervical_cytology');
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it("AC #3: GET /v1/cases?status=... reflects the screening tier on the correct role's worklist", async () => {
    const caseId = await createCase('cervical_cytology');

    // A freshly-accessioned case's own status is 'accessioned' -- nothing in
    // this codebase transitions a case to 'in_process' yet (a pre-existing
    // gap, not FEAT-063's own scope) -- so the cytotechnologist's own
    // pre-screen queue is queried by 'accessioned' here.
    const beforeScreen = await listCases(tokenA, 'accessioned');
    if (!beforeScreen.some((c) => c.id === caseId)) {
      throw new Error(
        'expected the unscreened case in the accessioned (cytotechnologist) queue',
      );
    }
    const beforeScreenReview = await listCases(tokenA, 'pending_review');
    if (beforeScreenReview.some((c) => c.id === caseId)) {
      throw new Error(
        'did not expect the unscreened case in the pending_review (cytopathologist) queue',
      );
    }

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const afterScreen = await listCases(tokenA, 'accessioned');
    if (afterScreen.some((c) => c.id === caseId)) {
      throw new Error(
        'did not expect the now-screened case in the accessioned queue anymore',
      );
    }
    const afterScreenReview = await listCases(tokenA, 'pending_review');
    if (!afterScreenReview.some((c) => c.id === caseId)) {
      throw new Error(
        'expected the screened case in the pending_review (cytopathologist) queue',
      );
    }
  });

  it('GET /v1/cases with no status filter excludes terminal states (signed_out) by default', async () => {
    const caseId = await createCase('cervical_cytology');
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/screen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);

    const defaultList = await listCases(tokenA);
    if (defaultList.some((c) => c.id === caseId)) {
      throw new Error(
        'did not expect a signed_out case in the default (no status filter) list',
      );
    }
    const explicitSignedOut = await listCases(tokenA, 'signed_out');
    if (!explicitSignedOut.some((c) => c.id === caseId)) {
      throw new Error(
        'expected the signed_out case when explicitly filtering for it',
      );
    }
  });

  describe('POST /v1/cases/:id/return-to-screening (issue #639)', () => {
    async function auditCount(): Promise<number> {
      const res = await request(app.getHttpServer())
        .get('/auth/tenant-audit-count')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      return (res.body as { count: number }).count;
    }

    it('full round trip: screen -> return-to-screening -> screen again -> finalize', async () => {
      const caseId = await createCase('cervical_cytology');
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/screen`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const before = await auditCount();
      const returnRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/return-to-screening`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({
          reason: 'screening was inadequate, missing adequacy assessment',
        })
        .expect(200);
      const returnBody = returnRes.body as { after: { status: string } };
      if (returnBody.after.status !== 'in_process') {
        throw new Error(
          `expected status in_process after return-to-screening, got ${JSON.stringify(returnBody)}`,
        );
      }
      const after = await auditCount();
      if (after !== before + 1) {
        throw new Error(
          `expected exactly one new audit_event row, before=${before} after=${after}`,
        );
      }

      // Corrected -- re-screen and finalize normally.
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/screen`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const finalizeRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);
      const finalizeBody = finalizeRes.body as { case: { status: string } };
      if (finalizeBody.case.status !== 'signed_out') {
        throw new Error(
          `expected status signed_out after re-screen + finalize, got ${JSON.stringify(finalizeBody)}`,
        );
      }
    });

    it('rejects a manage_specimens-only token (no verify) with 403', async () => {
      const caseId = await createCase('cervical_cytology');
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/screen`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/return-to-screening`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'should be rejected before reaching any handler logic',
        })
        .expect(403);
    });

    it('rejects a case not currently in pending_review (400)', async () => {
      const caseId = await createCase('cervical_cytology');
      // Still 'accessioned' -- never screened.
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/return-to-screening`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({ reason: 'no prior screening to return' })
        .expect(400);
    });

    it('rejects an empty reason (400, schema validation)', async () => {
      const caseId = await createCase('cervical_cytology');
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/screen`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/return-to-screening`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({})
        .expect(400);
    });
  });
});
