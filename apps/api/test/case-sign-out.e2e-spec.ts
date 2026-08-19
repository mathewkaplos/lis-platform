import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  createDb,
  caseReportVersion,
  verifyCaseReportSignature,
} from '@lis/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { getKeycloakFreshToken } from './get-keycloak-fresh-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_A_GLUCOSE_CODE = 'GLU';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

/**
 * FEAT-059 (ADR-0051, docs/plans/feat-059-sign-out-step-up-digital-signature.md).
 * Proves the real, step-up-signed AP sign-out through the live API -- real
 * Keycloak tokens, real Postgres, matching case.e2e-spec.ts's own standard.
 * Covers issue #544's own four ACs.
 *
 * AC #1's "no fresh step-up is rejected" half is proven two ways here: (a)
 * the capability gate itself (finalize now requires `verify`, not
 * `manage_specimens` -- a token that could finalize under FEAT-057 must now
 * be rejected), and (b) `test-user-4`'s freshly-fetched password-grant
 * token is, by construction, always fresh (Keycloak's own AUTH_TIME is set
 * at that exact grant) -- so the *positive* finalize/amend calls below are
 * simultaneously proof StepUpGuard's "pass" branch is wired correctly
 * end-to-end. The staleness *rejection* branch itself is proven directly
 * against the real, unmocked StepUpGuard class in step-up.guard.spec.ts --
 * reproducing it here would require either a real 300+ second wait (an
 * unacceptable CI cost for one assertion) or a full browser
 * `prompt=login` round trip through apps/web, which is out of this file's
 * reach (this suite only drives apps/api). AC #4 (auto-verify can never
 * reach an AP report) is proven in
 * apps/api/src/auto-verify/auto-verify-gates.spec.ts -- every synoptic-
 * response Observation is `source: 'manual'`, which `checkAutoVerifyGates`
 * structurally rejects; there is no separate AP-specific carve-out to test
 * here because none exists.
 */
describe('Case sign-out / step-up / digital signature (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens only
  let tokenVerifier: string; // test-user-4: technologist+verifier, tenant A -- has `verify`
  let noRoleToken: string; // test-user-3: no realm role, tenant A
  let tokenB: string; // test-user-2: verifier, tenant B -- for cross-tenant isolation (issue #615)
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
   * -- ready to finalize -- built with tokenA (manage_specimens), matching
   * case.e2e-spec.ts's own AC #3 fixture shape. */
  async function createFinalizableCase(): Promise<string> {
    const orderId = await createOrder();
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
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

  async function auditCount(): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  async function reportVersionRows(caseId: string) {
    return db
      .select()
      .from(caseReportVersion)
      .where(eq(caseReportVersion.caseId, caseId));
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenVerifier, noRoleToken, tokenB] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      // Real Authorization Code + PKCE flow, not Direct Grant -- the
      // finalize/amend positive paths need a genuinely fresh `auth_time`,
      // which Direct Grant tokens never carry on this realm (see
      // get-keycloak-fresh-token.ts's own header comment).
      getKeycloakFreshToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user-3', 'test-password-3'),
      getKeycloakToken('test-user-2', 'test-password-2'),
    ]);

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'SignOut', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;

    // Session-scoped (persists for this pooled connection's lifetime, same
    // technique report-assembly.e2e-spec.ts's own db.execute(set_config(...,
    // false)) already established) -- needed to read case_report_version
    // (tenant-scoped, RLS) directly below.
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC #1: finalize rejects a caller whose role does not grant `verify` -- the gate moved off `manage_specimens` (FEAT-057) onto `verify`', async () => {
    const caseId = await createFinalizableCase();

    // tokenA (technologist) could finalize under FEAT-057's placeholder --
    // must now be rejected, proving the capability actually changed.
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .expect(403);
  });

  it('AC #2: a successful finalize signs the case, returns a signature bound to the content hash, and writes exactly one new audit_event row in the same transaction', async () => {
    const caseId = await createFinalizableCase();
    const before = await auditCount();

    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);
    const body = res.body as {
      case: { id: string; status: string };
      reportVersion: {
        id: string;
        caseId: string;
        versionNumber: number;
        contentHash: string;
        signature: string;
        signedByRole: string;
        authTimeUsed: string;
        status: string;
      };
    };

    if (body.case.status !== 'signed_out') {
      throw new Error(
        `expected case.status signed_out, got ${JSON.stringify(body.case)}`,
      );
    }
    if (
      body.reportVersion.versionNumber !== 1 ||
      body.reportVersion.caseId !== caseId ||
      body.reportVersion.status !== 'final' ||
      body.reportVersion.signedByRole !== 'verifier' ||
      !body.reportVersion.contentHash ||
      !body.reportVersion.signature ||
      !body.reportVersion.authTimeUsed
    ) {
      throw new Error(
        `expected a fully-populated signed v1 report version, got ${JSON.stringify(body.reportVersion)}`,
      );
    }

    // The signature is real (SIGNING_SECRET-bound HMAC), not a placeholder
    // string -- verify it round-trips, and that tampering is detected.
    const authTimeUsedEpoch = Math.floor(
      new Date(body.reportVersion.authTimeUsed).getTime() / 1000,
    );
    const signatureInput = {
      caseId,
      contentHash: body.reportVersion.contentHash,
      actorPrincipalId: '', // overwritten below per assertion
      authTimeUsed: authTimeUsedEpoch,
    };
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);
    signatureInput.actorPrincipalId = (meRes.body as { sub: string }).sub;

    const signatureBuffer = Buffer.from(body.reportVersion.signature, 'hex');
    if (!verifyCaseReportSignature(signatureInput, signatureBuffer)) {
      throw new Error(
        'expected the returned signature to verify against its own content hash/actor/authTime',
      );
    }
    if (
      verifyCaseReportSignature(
        { ...signatureInput, contentHash: 'tampered' },
        signatureBuffer,
      )
    ) {
      throw new Error(
        'expected verification to fail against a tampered content hash',
      );
    }

    const after = await auditCount();
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }

    const rows = await reportVersionRows(caseId);
    if (rows.length !== 1 || rows[0].status !== 'final') {
      throw new Error(
        `expected exactly one 'final' case_report_version row, got ${JSON.stringify(rows)}`,
      );
    }
  });

  it('AC #3: amend requires a reason, creates a new version amending the current one, and marks the prior version superseded', async () => {
    const caseId = await createFinalizableCase();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);

    // Zod validation: reason is mandatory (caseAmendRequestSchema).
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/amend`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .send({})
      .expect(400);

    const amendRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/amend`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .send({ reason: 'correction of margin status after second review' })
      .expect(200);
    const amendBody = amendRes.body as {
      case: { status: string };
      reportVersion: {
        versionNumber: number;
        amendmentOf: string | null;
        reason: string | null;
      };
    };
    if (amendBody.case.status !== 'amended') {
      throw new Error(
        `expected case.status amended, got ${JSON.stringify(amendBody.case)}`,
      );
    }
    if (
      amendBody.reportVersion.versionNumber !== 2 ||
      !amendBody.reportVersion.amendmentOf ||
      amendBody.reportVersion.reason !==
        'correction of margin status after second review'
    ) {
      throw new Error(
        `expected v2 amending v1 with the given reason, got ${JSON.stringify(amendBody.reportVersion)}`,
      );
    }

    // The old version (v1, old one preserved via superseded_by -- AC #3's
    // own literal wording) is still present, now marked superseded.
    const rows = await reportVersionRows(caseId);
    const v1 = rows.find((r) => r.versionNumber === 1);
    const v2 = rows.find((r) => r.versionNumber === 2);
    if (!v1 || v1.status !== 'superseded' || v1.supersededBy !== v2?.id) {
      throw new Error(
        `expected v1 preserved and marked superseded by v2, got ${JSON.stringify({ v1, v2 })}`,
      );
    }
  });

  it('amend rejects a case that has never been signed out', async () => {
    const caseId = await createFinalizableCase();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/amend`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .send({ reason: 'no prior signed version exists' })
      .expect(400);
  });

  it('amend rejects a caller whose role does not grant `verify`, same gate as finalize', async () => {
    const caseId = await createFinalizableCase();
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/amend`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reason: 'should be rejected before reaching any amend logic' })
      .expect(403);
  });

  describe('GET /v1/cases/:id/report-versions (issue #615)', () => {
    it('returns the full version chain newest-first, correctly reflecting a real sign-out -> amend -> amend chain', async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/amend`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({ reason: 'first amendment' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/amend`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({ reason: 'second amendment' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/report-versions`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);
      const body = res.body as {
        items: {
          versionNumber: number;
          status: string;
          amendmentOf: string | null;
          supersededBy: string | null;
          reason: string | null;
        }[];
      };

      if (body.items.length !== 3) {
        throw new Error(`expected 3 versions, got ${JSON.stringify(body.items)}`);
      }
      const [v3, v2, v1] = body.items;
      if (
        v3.versionNumber !== 3 ||
        v2.versionNumber !== 2 ||
        v1.versionNumber !== 1
      ) {
        throw new Error(
          `expected newest-first ordering [3,2,1], got ${JSON.stringify(body.items.map((i) => i.versionNumber))}`,
        );
      }
      if (v3.status !== 'final' || v3.reason !== 'second amendment') {
        throw new Error(`expected v3 to be the current final version, got ${JSON.stringify(v3)}`);
      }
      if (v2.status !== 'superseded' || v2.supersededBy === null) {
        throw new Error(`expected v2 superseded by v3, got ${JSON.stringify(v2)}`);
      }
      if (v1.status !== 'superseded' || v1.supersededBy === null || v1.amendmentOf !== null) {
        throw new Error(`expected v1 superseded, no amendmentOf, got ${JSON.stringify(v1)}`);
      }
    });

    it('is reachable with only a valid JWT -- no capability required', async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);

      // noRoleToken has no realm role granting any capability, but this is a
      // read-only route with no @RequireCapability -- matches getById's own
      // precedent (case.e2e-spec.ts).
      await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/report-versions`)
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(200);
    });

    it('returns 404 for a case created under a different tenant (RLS), not an empty list', async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/report-versions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });
});
