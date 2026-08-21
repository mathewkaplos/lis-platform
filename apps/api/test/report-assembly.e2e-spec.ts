import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  observation,
  referenceRange,
  report,
  reportTemplate,
  reportTemplateVersion,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import {
  assembleAndPersistPreliminaryReport,
  assembleAndPersistReport,
} from '../src/report/report-assembly';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * TASK-059/TASK-060 (FEAT-016 revisions, docs/plans/feat-016-minimal-report.md).
 * The top-level describes exercise `assembleAndPersistReport` directly
 * against real Postgres/Keycloak (TASK-059's own proposal §10 Q2: no HTTP
 * route in that task), the same direct-`@lis/db` pattern
 * `reference-range-resolution.e2e-spec.ts` (TASK-049) already established
 * for a service with no controller yet. The final describe block
 * (TASK-060) exercises the real `POST /v1/ordered-tests/:id/report` HTTP
 * route on top of the same fixtures/tokens, mirroring
 * `calculated-fields.e2e-spec.ts`'s own "pure/service tests + HTTP
 * integration tests in one file" precedent. Synthetic, non-clinical
 * fixtures throughout (TASK-049/056's own precedent) -- no seeded
 * golden-dataset test has a single-analyte panel simple enough to isolate
 * either task's own AC.
 */
describe('Report assembly (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let tokenA: string;
  let verifierToken: string;
  let verifierUserId: string;

  let mgdlUnitId: string;
  let synthCsvIdA: string;
  let synthCsvIdB: string;
  let analyteAId: string;
  let analyteBId: string;
  let singleAnalyteTestDefId: string;
  let twoAnalyteTestDefId: string;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Report',
        lastName: 'Assembly',
        sex: 'F',
        birthDate: '1980-01-01',
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrder(
    patientId: string,
    testDefId: string,
  ): Promise<{ orderId: string; orderedTestId: string }> {
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [testDefId] })
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    return {
      orderId: body.resourceId,
      orderedTestId: body.after.orderedTests[0].id,
    };
  }

  async function receive(orderId: string): Promise<void> {
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, specimenType: 'serum' })
      .expect(201);
  }

  async function finalize(
    orderedTestId: string,
    analyteId: string,
    valueNum: number,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/finalize`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum })
      .expect(200);
  }

  async function verify(
    orderedTestId: string,
    analyteId: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  }

  async function auditCount(): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  async function reportCount(orderedTestId: string): Promise<number> {
    const rows = await db
      .select({ id: report.id })
      .from(report)
      .where(eq(report.orderedTestId, orderedTestId));
    return rows.length;
  }

  /** Wraps `assembleAndPersistReport` in its own real transaction with the
   * tenant RLS session variable bound, mirroring `TenantContextInterceptor`
   * exactly -- this task adds no route, so no interceptor does this for us. */
  async function assemble(orderedTestId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`,
      );
      return assembleAndPersistReport(tx, {
        tenantId: TENANT_A,
        orderedTestId,
        actorPrincipalId: verifierUserId,
        actorRole: 'pathologist',
      });
    });
  }

  /** FEAT-054: same wrapping as `assemble()` above, for the new preliminary path. */
  async function assemblePreliminary(orderedTestId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`,
      );
      return assembleAndPersistPreliminaryReport(tx, {
        tenantId: TENANT_A,
        orderedTestId,
        actorPrincipalId: verifierUserId,
        actorRole: 'pathologist',
      });
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    tokenA = await getKeycloakToken('test-user', 'test-password');
    // Same seeded dual-role user TASK-055/057's own e2e suites already use.
    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    verifierUserId = (meRes.body as { sub: string }).sub;

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [mgdl] = await db
      .select({ id: unit.id })
      .from(unit)
      .innerJoin(
        codeSystemValue,
        eq(unit.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'UCUM'),
          eq(codeSystemValue.code, 'mg/dL'),
        ),
      )
      .limit(1);
    if (!mgdl) {
      throw new Error('expected mg/dL UCUM unit -- run `pnpm db:reset` first');
    }
    mgdlUnitId = mgdl.id;

    const [csvA] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'TASK-059-SYNTH-A',
        version: '1',
        display: 'TASK-059 synthetic analyte A (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });
    synthCsvIdA = csvA.id;
    const [csvB] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'TASK-059-SYNTH-B',
        version: '1',
        display: 'TASK-059 synthetic analyte B (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });
    synthCsvIdB = csvB.id;

    const [analyteA] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: synthCsvIdA,
        display: 'TASK-059 Synthetic Analyte A (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteAId = analyteA.id;
    const [analyteB] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: synthCsvIdB,
        display: 'TASK-059 Synthetic Analyte B (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteBId = analyteB.id;

    async function insertRange(targetAnalyteId: string) {
      const [row] = await db
        .insert(referenceRange)
        .values({
          tenantId: TENANT_A,
          analyteId: targetAnalyteId,
          unitId: mgdlUnitId,
          rangeType: 'normal',
          low: '1',
          high: '100',
          effectiveFrom: new Date('2000-01-01T00:00:00Z'),
        })
        .returning();
      return row.id;
    }
    await insertRange(analyteAId);
    await insertRange(analyteBId);

    const [singleDef] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: 'TASK059-SYNTH-1',
        displayName: 'TASK-059 Synthetic Single-Analyte Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });
    singleAnalyteTestDefId = singleDef.id;
    await db.insert(testAnalyte).values({
      tenantId: TENANT_A,
      testDefinitionId: singleAnalyteTestDefId,
      analyteId: analyteAId,
    });

    const [twoDef] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: 'TASK059-SYNTH-2',
        displayName: 'TASK-059 Synthetic Two-Analyte Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });
    twoAnalyteTestDefId = twoDef.id;
    await db.insert(testAnalyte).values([
      {
        tenantId: TENANT_A,
        testDefinitionId: twoAnalyteTestDefId,
        analyteId: analyteAId,
      },
      {
        tenantId: TENANT_A,
        testDefinitionId: twoAnalyteTestDefId,
        analyteId: analyteBId,
      },
    ]);

    // FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md
    // §5 assumption, real correction found during implementation):
    // `assembleAndPersistReport` now requires a published
    // `report_template_version` for the ordered test's own test_definition
    // -- there is no fixed fallback layout anymore. The real seeded catalog
    // (db/seed/default-report-templates.sql) covers every *seeded* test,
    // but this spec's own two synthetic test_definitions above are created
    // fresh, in-memory, every run -- they need their own published template
    // too, the same as a real lab would configure one before any test in
    // its own catalog can produce a report. A single 'table' field listing
    // every analyte on the panel reproduces the old fixed layout exactly.
    async function publishDefaultTemplate(
      testDefinitionId: string,
      analyteIds: string[],
    ) {
      const [templateRow] = await db
        .insert(reportTemplate)
        .values({ tenantId: TENANT_A, testDefinitionId })
        .returning({ id: reportTemplate.id });
      await db.insert(reportTemplateVersion).values({
        tenantId: TENANT_A,
        reportTemplateId: templateRow.id,
        version: 1,
        status: 'published',
        definition: {
          sections: [
            {
              title: 'Results',
              fields: [
                {
                  key: 'results-table',
                  label: 'Results',
                  type: 'table',
                  analyteBindings: analyteIds,
                },
              ],
            },
          ],
        },
      });
    }
    await publishDefaultTemplate(singleAnalyteTestDefId, [analyteAId]);
    await publishDefaultTemplate(twoAnalyteTestDefId, [analyteAId, analyteBId]);
  });

  // No fixture cleanup here, deliberately -- unlike
  // reference-range-resolution.e2e-spec.ts's own synthetic analyte (never
  // referenced by a real order), this spec drives real orders/observations/
  // report rows against its synthetic test_definition, which FK-references
  // block deleting afterward. observation.e2e-spec.ts's own synthetic
  // multi-analyte test_definition fixture (TASK-056) already established
  // this exact precedent: insert and leave, never delete -- matching this
  // repo's own "accumulated e2e/manual-verification data" convention.
  afterAll(async () => {
    await app.close();
  });

  it(
    'assembles from an ordered test whose reference_range has since been edited, still reflecting the ' +
      'originally-snapshotted range -- the literal AC, proven by hash invariance and a direct DB check ' +
      "of the observation's own refLow/refHigh",
    async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        singleAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 50);
      await verify(orderedTestId, analyteAId);

      const [beforeRow] = await db
        .select({ refLow: observation.refLow, refHigh: observation.refHigh })
        .from(observation)
        .where(
          and(
            eq(observation.orderedTestId, orderedTestId),
            eq(observation.analyteId, analyteAId),
          ),
        )
        .limit(1);
      if (beforeRow.refLow !== '1' || beforeRow.refHigh !== '100') {
        throw new Error(
          `test setup bug: expected snapshot 1/100, got ${JSON.stringify(beforeRow)}`,
        );
      }

      const first = await assemble(orderedTestId);

      // The reference range is edited AFTER the observation was written and
      // verified -- exactly what "2-year-old result" stands in for. If
      // assembly ever re-resolved the live range instead of reading the
      // observation's own snapshot, this edit would change the second
      // assembly's hash.
      await db
        .update(referenceRange)
        .set({ low: '200', high: '300' })
        .where(eq(referenceRange.analyteId, analyteAId));

      const second = await assemble(orderedTestId);

      if (first.contentHash !== second.contentHash) {
        throw new Error(
          'expected the content hash to be unchanged after editing the underlying reference_range -- ' +
            'assembly must read the snapshot, not re-resolve live',
        );
      }

      const [afterRow] = await db
        .select({ refLow: observation.refLow, refHigh: observation.refHigh })
        .from(observation)
        .where(
          and(
            eq(observation.orderedTestId, orderedTestId),
            eq(observation.analyteId, analyteAId),
          ),
        )
        .limit(1);
      if (afterRow.refLow !== '1' || afterRow.refHigh !== '100') {
        throw new Error(
          `expected the observation's own snapshot to remain 1/100 after the reference_range edit, got ${JSON.stringify(afterRow)}`,
        );
      }
    },
  );

  it('rejects assembly (409) when not every analyte on the panel is verified', async () => {
    const patientId = await createPatient();
    const { orderId, orderedTestId } = await createOrder(
      patientId,
      twoAnalyteTestDefId,
    );
    await receive(orderId);
    await finalize(orderedTestId, analyteAId, 50);
    await verify(orderedTestId, analyteAId);
    await finalize(orderedTestId, analyteBId, 60); // finalized (preliminary), never verified

    try {
      await assemble(orderedTestId);
      throw new Error(
        'expected assembleAndPersistReport to reject a partially-verified panel',
      );
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
    }
  });

  it('succeeds once every analyte on the panel is verified, persisting a report row with correct provenance', async () => {
    const patientId = await createPatient();
    const { orderId, orderedTestId } = await createOrder(
      patientId,
      twoAnalyteTestDefId,
    );
    await receive(orderId);
    await finalize(orderedTestId, analyteAId, 50);
    await verify(orderedTestId, analyteAId);
    await finalize(orderedTestId, analyteBId, 60);
    await verify(orderedTestId, analyteBId);

    const result = await assemble(orderedTestId);
    if (!result.contentHash || result.pdf.length === 0) {
      throw new Error(
        `expected a real hash and non-empty PDF, got ${JSON.stringify({ contentHash: result.contentHash, pdfLength: result.pdf.length })}`,
      );
    }

    const [reportRow] = await db
      .select()
      .from(report)
      .where(eq(report.id, result.reportId))
      .limit(1);
    if (!reportRow) {
      throw new Error('expected a persisted report row');
    }
    if (
      reportRow.contentHash !== result.contentHash ||
      reportRow.orderedTestId !== orderedTestId ||
      reportRow.generatedByUserId !== verifierUserId
    ) {
      throw new Error(
        `expected report row to match assembly result, got ${JSON.stringify(reportRow)}`,
      );
    }
    const included = reportRow.includedObservations as { id: string }[];
    if (included.length !== 2) {
      throw new Error(
        `expected 2 included observations (one per analyte), got ${included.length}`,
      );
    }
  });

  it('produces different hashes for different observation sets -- the differential proof', async () => {
    const patientId1 = await createPatient();
    const { orderId: orderId1, orderedTestId: orderedTestId1 } =
      await createOrder(patientId1, singleAnalyteTestDefId);
    await receive(orderId1);
    await finalize(orderedTestId1, analyteAId, 42);
    await verify(orderedTestId1, analyteAId);

    const patientId2 = await createPatient();
    const { orderId: orderId2, orderedTestId: orderedTestId2 } =
      await createOrder(patientId2, singleAnalyteTestDefId);
    await receive(orderId2);
    await finalize(orderedTestId2, analyteAId, 84);
    await verify(orderedTestId2, analyteAId);

    const result1 = await assemble(orderedTestId1);
    const result2 = await assemble(orderedTestId2);
    if (result1.contentHash === result2.contentHash) {
      throw new Error(
        'expected two different observation sets to produce different content hashes',
      );
    }
  });

  /**
   * TASK-060 (FEAT-016 revision). The real `POST /v1/ordered-tests/:id/report`
   * route on top of the same fixtures/tokens above -- `assembleAndPersistReport`
   * itself is already proven correct by the describes above; these tests
   * prove the HTTP layer (capability gate, raw PDF response, and that the
   * route's own audit/persistence behavior matches calling the service
   * directly).
   */
  describe('HTTP: POST /v1/ordered-tests/:id/report', () => {
    it(
      'returns real PDF bytes once every analyte is verified, gated behind the verify capability, ' +
        'creating exactly one new report row and one new audit_event row',
      async () => {
        const patientId = await createPatient();
        const { orderId, orderedTestId } = await createOrder(
          patientId,
          singleAnalyteTestDefId,
        );
        await receive(orderId);
        await finalize(orderedTestId, analyteAId, 55);
        await verify(orderedTestId, analyteAId);

        const reportCountBefore = await reportCount(orderedTestId);
        const auditBefore = await auditCount();

        const res = await request(app.getHttpServer())
          .post(`/v1/ordered-tests/${orderedTestId}/report`)
          .set('Authorization', `Bearer ${verifierToken}`)
          .expect(200);

        if (res.headers['content-type'] !== 'application/pdf') {
          throw new Error(
            `expected Content-Type: application/pdf, got ${JSON.stringify(res.headers['content-type'])}`,
          );
        }
        const bodyBuffer = Buffer.isBuffer(res.body)
          ? res.body
          : Buffer.from(res.text ?? '', 'binary');
        if (
          bodyBuffer.length === 0 ||
          bodyBuffer.subarray(0, 4).toString('latin1') !== '%PDF'
        ) {
          throw new Error(
            `expected a non-empty PDF response body starting with the %PDF magic bytes, got length=${bodyBuffer.length}`,
          );
        }

        const reportCountAfter = await reportCount(orderedTestId);
        if (reportCountAfter !== reportCountBefore + 1) {
          throw new Error(
            `expected exactly one new report row, before=${reportCountBefore} after=${reportCountAfter}`,
          );
        }
        const auditAfter = await auditCount();
        if (auditAfter !== auditBefore + 1) {
          throw new Error(
            `expected exactly one new audit_event row, before=${auditBefore} after=${auditAfter}`,
          );
        }
      },
    );

    it('rejects a technologist-only session with 403 (no verify capability)', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        singleAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 60);
      await verify(orderedTestId, analyteAId);

      await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });

    it('returns 409 when not every analyte on the panel is verified -- unchanged assembleAndPersistReport behavior over HTTP', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 50);
      await verify(orderedTestId, analyteAId);
      await finalize(orderedTestId, analyteBId, 60); // finalized, never verified

      await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/report`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(409);
    });
  });

  /**
   * FEAT-054 (ADR-0047). `assembleAndPersistReport`'s own describes above
   * are untouched by this feature and still pass unmodified -- proving the
   * existing final path's own behavior is provably unaffected. These tests
   * exercise the new, separate relaxed-precondition path directly.
   */
  describe('assembleAndPersistPreliminaryReport', () => {
    it('rejects (409) when nothing on the panel has been recorded yet', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);

      try {
        await assemblePreliminary(orderedTestId);
        throw new Error(
          'expected assembleAndPersistPreliminaryReport to reject an empty panel',
        );
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
      }
    });

    it('succeeds with only one of two analytes verified -- the relaxed precondition -- rendering the other as Pending and persisting reportType "preliminary"', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 50);
      await verify(orderedTestId, analyteAId);
      // analyteB deliberately left unrecorded entirely -- not even a draft.

      const result = await assemblePreliminary(orderedTestId);
      if (!result.contentHash || result.pdf.length === 0) {
        throw new Error('expected a real hash and non-empty PDF');
      }

      const [reportRow] = await db
        .select()
        .from(report)
        .where(eq(report.id, result.reportId))
        .limit(1);
      if (reportRow.reportType !== 'preliminary') {
        throw new Error(
          `expected reportType 'preliminary', got ${JSON.stringify(reportRow.reportType)}`,
        );
      }
      // Only the one real observation is snapshotted as included -- the
      // "Pending" analyte has no real row to snapshot.
      const included = reportRow.includedObservations as { id: string }[];
      if (included.length !== 1) {
        throw new Error(
          `expected exactly 1 included observation (the verified one only), got ${included.length}`,
        );
      }
    });

    it('a preliminary report followed by a final report leaves both rows independently queryable, each with its own correct reportType', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 50);
      await verify(orderedTestId, analyteAId);

      const preliminary = await assemblePreliminary(orderedTestId);

      await finalize(orderedTestId, analyteBId, 60);
      await verify(orderedTestId, analyteBId);
      const final = await assemble(orderedTestId);

      const rows = await db
        .select()
        .from(report)
        .where(eq(report.orderedTestId, orderedTestId));
      const preliminaryRow = rows.find((r) => r.id === preliminary.reportId);
      const finalRow = rows.find((r) => r.id === final.reportId);
      if (!preliminaryRow || preliminaryRow.reportType !== 'preliminary') {
        throw new Error(
          `expected the preliminary row to survive with reportType 'preliminary', got ${JSON.stringify(preliminaryRow)}`,
        );
      }
      if (!finalRow || finalRow.reportType !== 'final') {
        throw new Error(
          `expected the final row to have reportType 'final', got ${JSON.stringify(finalRow)}`,
        );
      }
    });
  });

  describe('HTTP: POST /v1/ordered-tests/:id/report/preliminary', () => {
    it('returns real PDF bytes with only one of two analytes verified, persisting reportType "preliminary"', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 55);
      await verify(orderedTestId, analyteAId);

      const res = await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/report/preliminary`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      if (res.headers['content-type'] !== 'application/pdf') {
        throw new Error(
          `expected Content-Type: application/pdf, got ${JSON.stringify(res.headers['content-type'])}`,
        );
      }
      const bodyBuffer = Buffer.isBuffer(res.body)
        ? res.body
        : Buffer.from(res.text ?? '', 'binary');
      if (
        bodyBuffer.length === 0 ||
        bodyBuffer.subarray(0, 4).toString('latin1') !== '%PDF'
      ) {
        throw new Error(
          `expected a non-empty PDF response starting with %PDF, got length=${bodyBuffer.length}`,
        );
      }

      const [reportRow] = await db
        .select()
        .from(report)
        .where(eq(report.orderedTestId, orderedTestId))
        .orderBy(sql`${report.generatedAt} DESC`)
        .limit(1);
      if (reportRow.reportType !== 'preliminary') {
        throw new Error(
          `expected the just-generated row's reportType to be 'preliminary', got ${JSON.stringify(reportRow.reportType)}`,
        );
      }
    });

    it('rejects a technologist-only session with 403 (no verify capability) -- same gate as the final route', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);
      await finalize(orderedTestId, analyteAId, 60);
      await verify(orderedTestId, analyteAId);

      await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/report/preliminary`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });

    it('returns 409 when nothing on the panel has been recorded yet', async () => {
      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(
        patientId,
        twoAnalyteTestDefId,
      );
      await receive(orderId);

      await request(app.getHttpServer())
        .post(`/v1/ordered-tests/${orderedTestId}/report/preliminary`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(409);
    });
  });
});
