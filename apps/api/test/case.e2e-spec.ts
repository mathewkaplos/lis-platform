import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createDb, caseTable } from '@lis/db';
import { eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { getKeycloakFreshToken } from './get-keycloak-fresh-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_A_GLUCOSE_CODE = 'GLU';
const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

/**
 * FEAT-057 (ADR-0049, docs/plans/feat-057-case-specimen-block-slide-hierarchy.md).
 * Proves the Case/Specimen/Block/Slide hierarchy + accessioning through the
 * live API -- real Keycloak tokens, real Postgres, matching
 * specimen.e2e-spec.ts's own standard. Covers issue #538's own four ACs.
 */
describe('Case API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let noRoleToken: string;
  // FEAT-059: finalize() now requires the `verify` capability (not
  // `manage_specimens`) AND a fresh step-up assertion — test-user-4
  // (technologist+verifier, same tenant as tokenA/test-user) is the one
  // fixture account that can both create the case lineage
  // (manage_specimens) and finalize it (verify), matching
  // capability-check.e2e-spec.ts's own "dualRoleToken" precedent. Distinct
  // from tokenB (test-user-2), which is `verifier` but a DIFFERENT tenant.
  // Fetched via the real Authorization Code flow (getKeycloakFreshToken),
  // not Direct Grant — see that helper's own header comment for why.
  let tokenVerifier: string;
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

  async function createCase(
    orderId: string,
    parts = [{ specimenType: 'tissue' }],
  ) {
    const res = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts })
      .expect(201);
    return res.body as {
      resourceId: string;
      after: { accessionNumber: string; status: string; partIds: string[] };
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenB, noRoleToken, tokenVerifier] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-2', 'test-password-2'),
      getKeycloakToken('test-user-3', 'test-password-3'),
      getKeycloakFreshToken('test-user-4', 'test-password-4'),
    ]);

    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Case', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    patientId = (patientRes.body as { resourceId: string }).resourceId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC #1: creates a case with 2+ parts, each with its own accession number derived from the case', async () => {
    const orderId = await createOrder();
    const { resourceId: caseId, after } = await createCase(orderId, [
      { specimenType: 'tissue' },
      { specimenType: 'tissue' },
    ]);

    if (!/^\d{6}-\d{6}$/.test(after.accessionNumber)) {
      throw new Error(
        `expected a well-formed case accession number, got ${JSON.stringify(after)}`,
      );
    }
    if (after.status !== 'accessioned' || after.partIds.length !== 2) {
      throw new Error(
        `expected an accessioned case with 2 parts, got ${JSON.stringify(after)}`,
      );
    }

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = lineage.body as { parts: { accessionNumber: string }[] };
    if (body.parts.length !== 2) {
      throw new Error(
        `expected 2 parts in lineage, got ${JSON.stringify(body)}`,
      );
    }
    const expected = new Set([
      `${after.accessionNumber}-P1`,
      `${after.accessionNumber}-P2`,
    ]);
    for (const part of body.parts) {
      if (!expected.has(part.accessionNumber)) {
        throw new Error(
          `unexpected part accession number ${part.accessionNumber}`,
        );
      }
    }
  });

  it('rejects a second case for the same order (ux_case_tenant_order, 1:1) with 400', async () => {
    const orderId = await createOrder();
    await createCase(orderId);

    await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(400);
  });

  it('AC #2: full case -> part -> block -> slide lineage is queryable in one GET, with case-scoped block codes and block-scoped slide codes', async () => {
    const orderId = await createOrder();
    const { resourceId: caseId, after } = await createCase(orderId, [
      { specimenType: 'tissue' },
      { specimenType: 'tissue' },
    ]);

    const lineageBefore = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const [partA, partB] = (lineageBefore.body as { parts: { id: string }[] })
      .parts;

    const blockA1 = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/blocks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ specimenId: partA.id })
      .expect(201);
    const blockB1 = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/blocks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ specimenId: partB.id })
      .expect(201);
    const blockABody = blockA1.body as {
      after: { blockNumber: number; code: string };
    };
    const blockBBody = blockB1.body as {
      after: { blockNumber: number; code: string };
    };
    // Case-scoped numbering (proposal §5): the second block, on a different
    // part, is still blockNumber 2, not reset to 1.
    if (
      blockABody.after.blockNumber !== 1 ||
      blockBBody.after.blockNumber !== 2
    ) {
      throw new Error(
        `expected case-scoped block numbering 1,2 -- got ${blockABody.after.blockNumber},${blockBBody.after.blockNumber}`,
      );
    }
    if (
      blockABody.after.code !== `${after.accessionNumber}-B1` ||
      blockBBody.after.code !== `${after.accessionNumber}-B2`
    ) {
      throw new Error(
        `unexpected block codes: ${blockABody.after.code}, ${blockBBody.after.code}`,
      );
    }

    const blockAId = (blockA1.body as { resourceId: string }).resourceId;
    const slide1 = await request(app.getHttpServer())
      .post(`/v1/blocks/${blockAId}/slides`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const slide2 = await request(app.getHttpServer())
      .post(`/v1/blocks/${blockAId}/slides`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    const slide1Body = slide1.body as {
      after: { slideNumber: number; code: string };
    };
    const slide2Body = slide2.body as {
      after: { slideNumber: number; code: string };
    };
    if (
      slide1Body.after.slideNumber !== 1 ||
      slide2Body.after.slideNumber !== 2
    ) {
      throw new Error(
        `expected block-scoped slide numbering 1,2 -- got ${slide1Body.after.slideNumber},${slide2Body.after.slideNumber}`,
      );
    }
    if (slide1Body.after.code !== `${blockABody.after.code}-S1`) {
      throw new Error(`unexpected slide code: ${slide1Body.after.code}`);
    }

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const lineageBody = lineage.body as {
      parts: {
        id: string;
        blocks: { id: string; slides: { id: string }[] }[];
      }[];
    };
    const lineagePartA = lineageBody.parts.find((p) => p.id === partA.id);
    if (
      lineagePartA?.blocks.length !== 1 ||
      lineagePartA.blocks[0].slides.length !== 2
    ) {
      throw new Error(
        `expected 1 block with 2 slides under part A, got ${JSON.stringify(lineagePartA)}`,
      );
    }
  });

  it('AC #4: an add-on/reflex stain creates a new OrderedTest on an existing block, never a new Case or Specimen row', async () => {
    const orderId = await createOrder();
    const { resourceId: caseId } = await createCase(orderId);
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

    const linkRes = await request(app.getHttpServer())
      .post(`/v1/blocks/${blockId}/ordered-tests`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ testDefinitionId })
      .expect(201);
    const newOrderedTestId = (linkRes.body as { resourceId: string })
      .resourceId;

    const lineageAfter = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const bodyAfter = lineageAfter.body as {
      parts: {
        id: string;
        blocks: { id: string; orderedTestIds: string[] }[];
      }[];
    };
    // Exactly the same case/part/block set as before -- no new part or block.
    if (
      bodyAfter.parts.length !== 1 ||
      bodyAfter.parts[0].blocks.length !== 1
    ) {
      throw new Error(
        `expected no new Case/Specimen/Block row, got ${JSON.stringify(bodyAfter)}`,
      );
    }
    if (
      !bodyAfter.parts[0].blocks[0].orderedTestIds.includes(newOrderedTestId)
    ) {
      throw new Error(
        `expected the new ordered test linked to the existing block, got ${JSON.stringify(bodyAfter)}`,
      );
    }
  });

  it('AC #3: finalize transitions case.status to signed_out once every part has an active block and every block an active slide, and rejects otherwise', async () => {
    const orderId = await createOrder();
    const { resourceId: caseId } = await createCase(orderId);

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(400); // no block yet

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
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(400); // block has no slide yet

    await request(app.getHttpServer())
      .post(`/v1/blocks/${blockId}/slides`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const finalizeRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);
    // FEAT-059: finalize() now returns { case, reportVersion } (the real
    // signed artifact), not the old { resourceId, before, after } shape
    // AuditInterceptor produced — see case-sign-out.e2e-spec.ts for
    // signature/audit coverage of this response.
    const finalizeBody = finalizeRes.body as { case: { status: string } };
    if (finalizeBody.case.status !== 'signed_out') {
      throw new Error(
        `expected status signed_out, got ${JSON.stringify(finalizeBody)}`,
      );
    }

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(400); // already finalized
  });

  it('denies a caller with no manage_specimens-granting role (403) on create', async () => {
    const orderId = await createOrder();
    await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${noRoleToken}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(403);
  });

  it('returns 404 for a case created under a different tenant (RLS at the API layer, not just the DB layer)', async () => {
    const orderId = await createOrder();
    const { resourceId: caseId } = await createCase(orderId);

    await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('returns 404 (not 500) for a well-formed but nonexistent case id', async () => {
    await request(app.getHttpServer())
      .get(`/v1/cases/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  describe('DB-level status transition guard (issue #671)', () => {
    it('rejects an illegal case.status transition via a raw SQL UPDATE, bypassing the application layer entirely', async () => {
      const orderId = await createOrder();
      const { resourceId: caseId } = await createCase(orderId);
      // Freshly created -- status 'accessioned'. Jumping straight to
      // 'amended' skips every legal intermediate transition
      // (pending_review/signed_out) -- illegal under any real path.
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      let rejected = false;
      try {
        await db.execute(
          sql`UPDATE "case" SET status = 'amended' WHERE id = ${caseId}`,
        );
      } catch (err) {
        rejected = true;
        // drizzle wraps the raw pg error as `Failed query: ...` -- the
        // trigger's own RAISE EXCEPTION message is on the underlying
        // driver error's own `.cause`.
        const cause = err instanceof Error ? err.cause : undefined;
        const message = cause instanceof Error ? cause.message : String(err);
        if (!message.includes('illegal case status transition')) {
          throw new Error(
            `expected the trigger's own exception message, got: ${message}`,
          );
        }
      }
      if (!rejected) {
        throw new Error(
          'expected the raw SQL UPDATE to be rejected by trg_case_status_transition_guard',
        );
      }

      // A failed statement can leave the pooled connection replaced (its
      // own session-scoped set_config lost) -- re-set it before the
      // follow-up read.
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      const [row] = await db
        .select({ status: caseTable.status })
        .from(caseTable)
        .where(eq(caseTable.id, caseId))
        .limit(1);
      if (row?.status !== 'accessioned') {
        throw new Error(
          `expected the rejected UPDATE to leave status unchanged, got ${JSON.stringify(row)}`,
        );
      }
    });

    it('allows a same-status UPDATE (no status change) to pass through unaffected', async () => {
      const orderId = await createOrder();
      const { resourceId: caseId } = await createCase(orderId);
      await db.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
      );
      // No exception expected -- the trigger's own WHEN clause only fires
      // on an actual status change.
      await db.execute(
        sql`UPDATE "case" SET status = 'accessioned' WHERE id = ${caseId}`,
      );
    });
  });
});
