import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  caseReportVersion,
  synopticElement,
  synopticProtocol,
  synopticProtocolVersion,
  verifyCaseReportSignature,
} from '@lis/db';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { makeInstanceResponseKey } from '@lis/domain';
import { assembleCaseReportContent } from '../src/case/case-report-content-assembler';
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
        throw new Error(
          `expected 3 versions, got ${JSON.stringify(body.items)}`,
        );
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
        throw new Error(
          `expected v3 to be the current final version, got ${JSON.stringify(v3)}`,
        );
      }
      if (v2.status !== 'superseded' || v2.supersededBy === null) {
        throw new Error(
          `expected v2 superseded by v3, got ${JSON.stringify(v2)}`,
        );
      }
      if (
        v1.status !== 'superseded' ||
        v1.supersededBy === null ||
        v1.amendmentOf !== null
      ) {
        throw new Error(
          `expected v1 superseded, no amendmentOf, got ${JSON.stringify(v1)}`,
        );
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

  describe('PUT /v1/cases/:id/narrative (issue #636)', () => {
    it('upserts: first call creates the row, second call updates it in place', async () => {
      const caseId = await createFinalizableCase();

      const created = await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ grossDescription: 'gross v1' })
        .expect(200);
      const createdBody = created.body as {
        after: { grossDescription: string | null };
      };
      if (createdBody.after.grossDescription !== 'gross v1') {
        throw new Error(
          `expected first save to create grossDescription 'gross v1', got ${JSON.stringify(createdBody)}`,
        );
      }

      const updated = await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ grossDescription: 'gross v2', diagnosis: 'diagnosis v1' })
        .expect(200);
      const updatedBody = updated.body as {
        after: { grossDescription: string | null; diagnosis: string | null };
      };
      if (
        updatedBody.after.grossDescription !== 'gross v2' ||
        updatedBody.after.diagnosis !== 'diagnosis v1'
      ) {
        throw new Error(
          `expected second save to update in place (not duplicate the row), got ${JSON.stringify(updatedBody)}`,
        );
      }

      const getRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const lineage = getRes.body as {
        narrative: {
          grossDescription: string | null;
          diagnosis: string | null;
        } | null;
      };
      if (
        lineage.narrative?.grossDescription !== 'gross v2' ||
        lineage.narrative?.diagnosis !== 'diagnosis v1'
      ) {
        throw new Error(
          `expected GET /v1/cases/:id to reflect the current narrative, got ${JSON.stringify(lineage.narrative)}`,
        );
      }
    });

    it('a partial save does not clear fields it did not include', async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ grossDescription: 'gross', microscopicDescription: 'micro' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ diagnosis: 'final diagnosis' })
        .expect(200);
      const body = res.body as {
        after: {
          grossDescription: string | null;
          microscopicDescription: string | null;
          diagnosis: string | null;
        };
      };
      if (
        body.after.grossDescription !== 'gross' ||
        body.after.microscopicDescription !== 'micro' ||
        body.after.diagnosis !== 'final diagnosis'
      ) {
        throw new Error(
          `expected gross/microscopic to survive an update that only sent diagnosis, got ${JSON.stringify(body.after)}`,
        );
      }
    });

    it('rejects a caller without manage_specimens (403)', async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send({ grossDescription: 'should be rejected' })
        .expect(403);
    });

    it('returns 404 for a case created under a different tenant (RLS)', async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ grossDescription: 'cross-tenant write attempt' })
        .expect(404);
    });

    it("finalize snapshots the current narrative into the signed version's own includedContent, and an edit afterward does not change the already-signed version (issue #636's core correctness property)", async () => {
      const caseId = await createFinalizableCase();
      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          grossDescription: 'ORIGINAL gross',
          microscopicDescription: 'ORIGINAL micro',
          diagnosis: 'ORIGINAL diagnosis',
        })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);

      // Edit the narrative AFTER sign-out -- permitted (proposal §5: always
      // editable, no lock on case.status).
      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          grossDescription: 'EDITED gross',
          microscopicDescription: 'EDITED micro',
          diagnosis: 'EDITED diagnosis',
        })
        .expect(200);

      const rows = await reportVersionRows(caseId);
      const v1 = rows.find((r) => r.versionNumber === 1);
      if (!v1) {
        throw new Error(
          `expected a v1 report version, got ${JSON.stringify(rows)}`,
        );
      }
      const v1Content = v1.includedContent as {
        narrative: {
          grossDescription: string | null;
          diagnosis: string | null;
        };
      };
      if (
        v1Content.narrative.grossDescription !== 'ORIGINAL gross' ||
        v1Content.narrative.diagnosis !== 'ORIGINAL diagnosis'
      ) {
        throw new Error(
          `expected v1's own includedContent to still show the pre-edit ORIGINAL values, got ${JSON.stringify(v1Content.narrative)} -- narrative was referenced, not snapshotted`,
        );
      }

      // Amend now -- the new version must capture the CURRENT (post-edit)
      // narrative, not v1's original values.
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/amend`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({ reason: 'correcting the narrative' })
        .expect(200);

      const rowsAfterAmend = await reportVersionRows(caseId);
      const v2 = rowsAfterAmend.find((r) => r.versionNumber === 2);
      if (!v2) {
        throw new Error(
          `expected a v2 report version, got ${JSON.stringify(rowsAfterAmend)}`,
        );
      }
      const v2Content = v2.includedContent as {
        narrative: {
          grossDescription: string | null;
          diagnosis: string | null;
        };
      };
      if (
        v2Content.narrative.grossDescription !== 'EDITED gross' ||
        v2Content.narrative.diagnosis !== 'EDITED diagnosis'
      ) {
        throw new Error(
          `expected v2's own includedContent to capture the current EDITED values, got ${JSON.stringify(v2Content.narrative)}`,
        );
      }
    });
  });

  describe('GET /v1/cases/:id/report-versions/:versionId/pdf (issue #648)', () => {
    async function reportRowCount(): Promise<number> {
      const res = await db.execute(
        sql`SELECT count(*)::int AS count FROM report`,
      );
      return (res.rows[0] as { count: number }).count;
    }

    /** A finalizable case whose one part's specimenType matches the
     * published Breast protocol (issue #642/#645), with a narrative and one
     * real recorded synoptic response -- so the PDF route's own rejoin logic
     * (specimen/block, observation/synoptic_element, narrative) all have
     * real content to render, not just an empty case. */
    async function createFinalizableCaseWithFullReportContent(): Promise<string> {
      const orderId = await createOrder();
      const caseRes = await request(app.getHttpServer())
        .post('/v1/cases')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ orderId, parts: [{ specimenType: 'breast' }] })
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

      await request(app.getHttpServer())
        .put(`/v1/cases/${caseId}/narrative`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          grossDescription: 'PDF-TEST gross description',
          diagnosis: 'PDF-TEST diagnosis',
        })
        .expect(200);

      const protocolsRes = await request(app.getHttpServer())
        .get('/v1/synoptic-protocols')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const breast = (
        protocolsRes.body as {
          protocols: {
            id: string;
            specimenType: string;
            publishedVersionId: string | null;
          }[];
        }
      ).protocols.find((p) => p.specimenType === 'breast');
      if (!breast?.publishedVersionId) {
        throw new Error('expected the seeded, published Breast protocol');
      }

      const orderRes = await request(app.getHttpServer())
        .get(`/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const orderedTestId = (
        orderRes.body as { orderedTests: { id: string }[] }
      ).orderedTests[0].id;

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: breast.publishedVersionId,
          responses: [
            { elementKey: 'neoadjuvant_therapy', value: 'not_given' },
            { elementKey: 'operative_procedure', value: 'excision_wle' },
            { elementKey: 'specimen_laterality', value: 'left' },
            { elementKey: 'tumor_site', value: 'upper_outer' },
            { elementKey: 'tumor_max_dimension_mm', value: 22 },
            { elementKey: 'tumor_focality', value: 'single_focus' },
            { elementKey: 'histological_tumor_type', value: 'nst' },
            { elementKey: 'histological_tumor_grade', value: 'grade_2' },
            { elementKey: 'carcinoma_in_situ', value: 'not_identified' },
            { elementKey: 'tumor_extension', value: 'not_involved' },
            { elementKey: 'margin_status', value: 'not_involved' },
            { elementKey: 'lymphovascular_invasion', value: 'not_identified' },
            { elementKey: 'estrogen_receptor_status', value: 'positive' },
            { elementKey: 'progesterone_receptor_status', value: 'positive' },
            { elementKey: 'her2_status', value: 'negative_0' },
            { elementKey: 'pathological_stage_pt', value: 'pT2' },
          ],
        })
        .expect(201);

      return caseId;
    }

    it('returns a real PDF for a signed version, rejoining narrative/lineage/synoptic content, writing no new report or audit_event row', async () => {
      const caseId = await createFinalizableCaseWithFullReportContent();
      const finalizeRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);
      const versionId = (finalizeRes.body as { reportVersion: { id: string } })
        .reportVersion.id;

      const reportCountBefore = await reportRowCount();
      const auditCountBefore = await auditCount();

      const pdfRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/report-versions/${versionId}/pdf`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      if (pdfRes.headers['content-type'] !== 'application/pdf') {
        throw new Error(
          `expected application/pdf, got ${pdfRes.headers['content-type']}`,
        );
      }
      const pdfBytes = pdfRes.body as Buffer;
      if (
        !Buffer.isBuffer(pdfBytes) ||
        !pdfBytes.subarray(0, 5).toString('utf8').startsWith('%PDF-')
      ) {
        throw new Error('expected real PDF bytes starting with %PDF-');
      }

      const reportCountAfter = await reportRowCount();
      const auditCountAfter = await auditCount();
      if (
        reportCountAfter !== reportCountBefore ||
        auditCountAfter !== auditCountBefore
      ) {
        throw new Error(
          `expected no new report/audit_event row -- report ${reportCountBefore}->${reportCountAfter}, audit ${auditCountBefore}->${auditCountAfter}`,
        );
      }

      // Determinism: re-downloading the same already-signed version must
      // produce byte-identical output (pdf-generation Skill entry #3 --
      // hash the canonical input, proven here by comparing the actual
      // rendered bytes directly since CreationDate/ModDate are pinned to
      // the epoch the same way report-render.ts's own renderer already
      // does).
      const secondPdfRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/report-versions/${versionId}/pdf`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      if (!(secondPdfRes.body as Buffer).equals(pdfBytes)) {
        throw new Error('expected byte-identical PDF output on re-download');
      }
    });

    it('returns 404 for a nonexistent version id', async () => {
      const caseId = await createFinalizableCaseWithFullReportContent();
      await request(app.getHttpServer())
        .get(
          `/v1/cases/${caseId}/report-versions/00000000-0000-0000-0000-000000000000/pdf`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it("returns 404 for another tenant's case (RLS)", async () => {
      const caseId = await createFinalizableCaseWithFullReportContent();
      const finalizeRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);
      const versionId = (finalizeRes.body as { reportVersion: { id: string } })
        .reportVersion.id;

      await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}/report-versions/${versionId}/pdf`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe('Case report content assembly, repeating-structure awareness (issue #669)', () => {
    // Throwaway protocol, same isolation reasoning as #666/#667/#668's own
    // tests -- avoids polluting the shared seeded breast/colorectal
    // protocols for the rest of this file's own tests.
    async function createThrowawayProtocolVersion(): Promise<string> {
      const suffix = randomUUID().slice(0, 8);
      const [protocolRow] = await db
        .insert(synopticProtocol)
        .values({
          name: `Report content test fixture ${suffix}`,
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

    async function insertElement(
      versionId: string,
      key: string,
      dataType: 'text' | 'quantity',
      opts: {
        parentElementId?: string;
        repeatable?: boolean;
        identityElementKey?: string;
      } = {},
    ): Promise<string> {
      const [csv] = await db
        .insert(codeSystemValue)
        .values({
          system: 'ICCR-SYNOPTIC-TEST',
          code: `${versionId}.${key}`,
          version: '2022',
          display: key,
        })
        .returning();
      const [a] = await db
        .insert(analyte)
        .values({ codeSystemValueId: csv.id, display: key, dataType })
        .returning();
      const [el] = await db
        .insert(synopticElement)
        .values({
          synopticProtocolVersionId: versionId,
          parentElementId: opts.parentElementId ?? null,
          key,
          label: key,
          dataType,
          requirement: 'recommended',
          analyteId: a.id,
          displayOrder: 0,
          repeatable: opts.repeatable ?? false,
          identityElementKey: opts.identityElementKey ?? null,
        })
        .returning();
      return el.id;
    }

    it("renders a re-recorded element with only its current value, and groups a repeating group's instances distinctly", async () => {
      const versionId = await createThrowawayProtocolVersion();
      await insertElement(versionId, 'diagnosis_note', 'text');
      const rootId = await insertElement(
        versionId,
        'tumor_characteristics',
        'text',
        { repeatable: true },
      );
      await insertElement(versionId, 'tumor_identifier', 'text', {
        parentElementId: rootId,
      });
      await insertElement(versionId, 'tumor_size_mm', 'quantity', {
        parentElementId: rootId,
      });

      const caseId = await createFinalizableCase();
      const lineage = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const orderId = (lineage.body as { orderId: string }).orderId;
      const orderRes = await request(app.getHttpServer())
        .get(`/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const orderedTestId = (
        orderRes.body as { orderedTests: { id: string }[] }
      ).orderedTests[0].id;

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: versionId,
          responses: [
            { elementKey: 'diagnosis_note', value: 'initial note' },
            {
              elementKey: makeInstanceResponseKey('tumor_identifier', 'i1'),
              value: '1',
            },
            {
              elementKey: makeInstanceResponseKey('tumor_size_mm', 'i1'),
              value: 12,
            },
            {
              elementKey: makeInstanceResponseKey('tumor_identifier', 'i2'),
              value: '2',
            },
            {
              elementKey: makeInstanceResponseKey('tumor_size_mm', 'i2'),
              value: 8,
            },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/finalize`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .expect(200);

      // Re-record before amending -- issue #669's own bug fix: the
      // amended version's snapshot must capture only the CURRENT value,
      // not both the old (now-superseded) and new one.
      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/synoptic-responses`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          orderedTestId,
          synopticProtocolVersionId: versionId,
          responses: [
            { elementKey: 'diagnosis_note', value: 'corrected note' },
            {
              elementKey: makeInstanceResponseKey('tumor_identifier', 'i1'),
              value: '1',
            },
            {
              elementKey: makeInstanceResponseKey('tumor_size_mm', 'i1'),
              value: 12,
            },
            {
              elementKey: makeInstanceResponseKey('tumor_identifier', 'i2'),
              value: '2',
            },
            {
              elementKey: makeInstanceResponseKey('tumor_size_mm', 'i2'),
              value: 8,
            },
          ],
        })
        .expect(201);

      const amendRes = await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/amend`)
        .set('Authorization', `Bearer ${tokenVerifier}`)
        .send({ reason: 'issue #669 report-content test' })
        .expect(200);
      const versionId2 = (amendRes.body as { reportVersion: { id: string } })
        .reportVersion.id;

      const [versionRow] = await db
        .select({ includedContent: caseReportVersion.includedContent })
        .from(caseReportVersion)
        .where(eq(caseReportVersion.id, versionId2))
        .limit(1);
      const assembled = await db.transaction((tx) =>
        assembleCaseReportContent(
          tx,
          versionRow.includedContent as Parameters<
            typeof assembleCaseReportContent
          >[1],
        ),
      );
      const group = assembled.synopticGroups.find(
        (g) =>
          g.responses.some((r) => r.elementLabel === 'diagnosis_note') ||
          g.repeatingGroups.some(
            (rg) => rg.rootLabel === 'tumor_characteristics',
          ),
      );
      if (!group) {
        throw new Error(
          `expected a synoptic group for the throwaway protocol, got ${JSON.stringify(assembled.synopticGroups)}`,
        );
      }

      const diagnosisResponses = group.responses.filter(
        (r) => r.elementLabel === 'diagnosis_note',
      );
      if (
        diagnosisResponses.length !== 1 ||
        diagnosisResponses[0].value !== 'corrected note'
      ) {
        throw new Error(
          `expected exactly one current 'diagnosis_note' response ('corrected note'), got ${JSON.stringify(diagnosisResponses)}`,
        );
      }

      const repeatingGroup = group.repeatingGroups.find(
        (rg) => rg.rootLabel === 'tumor_characteristics',
      );
      if (repeatingGroup?.instances.length !== 2) {
        throw new Error(
          `expected two distinct tumor_characteristics instances, got ${JSON.stringify(repeatingGroup)}`,
        );
      }
      const sizes = repeatingGroup.instances
        .map(
          (instance) =>
            instance.responses.find((r) => r.elementLabel === 'tumor_size_mm')
              ?.value,
        )
        .sort();
      if (sizes.join(',') !== '12,8'.split(',').sort().join(',')) {
        throw new Error(
          `expected both instances' own tumor_size_mm values, got ${JSON.stringify(sizes)}`,
        );
      }
    });
  });
});
