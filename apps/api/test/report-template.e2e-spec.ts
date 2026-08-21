import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  report,
  reportTemplate,
  reportTemplateVersion,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { assembleAndPersistReport } from '../src/report/report-assembly';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';

/**
 * FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md).
 * Proves the issue's own two literal ACs plus this proposal's own §7
 * narrowed criteria: publish-time binding guardrail, one-published-per-
 * template, RLS isolation, and the immutable-snapshot proof (AC #2).
 * Fixture style mirrors `report-assembly.e2e-spec.ts`/`workflow.e2e-spec.ts`
 * -- synthetic, non-clinical analytes/tests, real Postgres/Keycloak.
 */
describe('Report templates (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let verifierUserId: string;

  let mgdlUnitId: string;
  let analyteAId: string;
  let analyteBId: string;
  let testDefId: string;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        firstName: 'Template',
        lastName: 'E2E',
        sex: 'F',
        birthDate: '1980-01-01',
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrder(
    patientId: string,
  ): Promise<{ orderId: string; orderedTestId: string }> {
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
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

  async function receiveAndVerify(orderedTestId: string, orderId: string) {
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId, specimenType: 'serum' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteAId}/finalize`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 50 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteAId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  }

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    // Same seeded qa/dual-role users FEAT-029/030/031's own e2e suites use.
    qaToken = await getKeycloakToken('test-user-5', 'test-password-5');
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
        code: 'FEAT-032-SYNTH-A',
        version: '1',
        display: 'FEAT-032 synthetic analyte A (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });
    const [csvB] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'FEAT-032-SYNTH-B',
        version: '1',
        display: 'FEAT-032 synthetic analyte B (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });

    const [analyteA] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csvA.id,
        display: 'FEAT-032 Synthetic Analyte A (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteAId = analyteA.id;
    const [analyteB] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csvB.id,
        display: 'FEAT-032 Synthetic Analyte B (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteBId = analyteB.id;

    const [def] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: 'FEAT032-SYNTH-1',
        displayName: 'FEAT-032 Synthetic Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });
    testDefId = def.id;
    await db.insert(testAnalyte).values({
      tenantId: TENANT_A,
      testDefinitionId: testDefId,
      analyteId: analyteAId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects create for a non-qa session (403)', async () => {
    await request(app.getHttpServer())
      .post('/v1/report-templates')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        testDefinitionId: testDefId,
        definition: {
          sections: [
            {
              title: 'Results',
              fields: [
                {
                  key: 'a',
                  label: 'A',
                  type: 'numeric',
                  analyteBinding: analyteAId,
                },
              ],
            },
          ],
        },
      })
      .expect(403);
  });

  it('rejects a numeric/coded field with no analyteBinding at publish time (400), never silently accepted', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/report-templates')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        testDefinitionId: testDefId,
        definition: {
          sections: [
            {
              title: 'Results',
              fields: [{ key: 'unbound', label: 'Unbound', type: 'numeric' }],
            },
          ],
        },
      })
      .expect(201);
    const body = createRes.body as { id: string; versions: { id: string }[] };

    await request(app.getHttpServer())
      .post(
        `/v1/report-templates/${body.id}/versions/${body.versions[0].id}/publish`,
      )
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(400);

    // Guardrail rejection must not have published it.
    const [row] = await db
      .select({ status: reportTemplateVersion.status })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.id, body.versions[0].id))
      .limit(1);
    expect(row.status).toBe('draft');

    // Clean up: a report_template already exists for testDefId now,
    // publish a valid version on it so later tests (which assume exactly
    // one report_template per testDefId, per the unique index) reuse it
    // rather than hitting a 409 on a second POST /v1/report-templates.
    const versionRes = await request(app.getHttpServer())
      .post(`/v1/report-templates/${body.id}/versions`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        definition: {
          sections: [
            {
              title: 'Results',
              fields: [
                {
                  key: 'a',
                  label: 'A',
                  type: 'numeric',
                  analyteBinding: analyteAId,
                },
              ],
            },
          ],
        },
      })
      .expect(201);
    const versionBody = versionRes.body as { id: string };
    await request(app.getHttpServer())
      .post(
        `/v1/report-templates/${body.id}/versions/${versionBody.id}/publish`,
      )
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
  });

  it("rejects a field bound to an analyte not on this test's own test_analyte set", async () => {
    const [templateRow] = await db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(eq(reportTemplate.testDefinitionId, testDefId))
      .limit(1);

    const versionRes = await request(app.getHttpServer())
      .post(`/v1/report-templates/${templateRow.id}/versions`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        definition: {
          sections: [
            {
              title: 'Results',
              // analyteBId is real but not on testDefId's own test_analyte set.
              fields: [
                {
                  key: 'b',
                  label: 'B',
                  type: 'numeric',
                  analyteBinding: analyteBId,
                },
              ],
            },
          ],
        },
      })
      .expect(201);
    const versionBody = versionRes.body as { id: string };

    await request(app.getHttpServer())
      .post(
        `/v1/report-templates/${templateRow.id}/versions/${versionBody.id}/publish`,
      )
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(400);
  });

  it('enforces at most one published version per template -- publishing v2 archives v1', async () => {
    const [templateRow] = await db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(eq(reportTemplate.testDefinitionId, testDefId))
      .limit(1);

    const publishedBefore = await db
      .select({
        id: reportTemplateVersion.id,
        status: reportTemplateVersion.status,
      })
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, templateRow.id),
          eq(reportTemplateVersion.status, 'published'),
        ),
      );
    expect(publishedBefore).toHaveLength(1);
    const v1Id = publishedBefore[0].id;

    const versionRes = await request(app.getHttpServer())
      .post(`/v1/report-templates/${templateRow.id}/versions`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        definition: {
          sections: [
            {
              title: 'Results',
              fields: [
                {
                  key: 'a',
                  label: 'Analyte A (v2)',
                  type: 'numeric',
                  analyteBinding: analyteAId,
                },
              ],
            },
          ],
        },
      })
      .expect(201);
    const v2Id = (versionRes.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/v1/report-templates/${templateRow.id}/versions/${v2Id}/publish`)
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);

    const [v1Row] = await db
      .select({ status: reportTemplateVersion.status })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.id, v1Id))
      .limit(1);
    expect(v1Row.status).toBe('archived');

    const publishedAfter = await db
      .select({ id: reportTemplateVersion.id })
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, templateRow.id),
          eq(reportTemplateVersion.status, 'published'),
        ),
      );
    expect(publishedAfter).toHaveLength(1);
    expect(publishedAfter[0].id).toBe(v2Id);
  });

  it('rejects re-publishing an already-published version (409)', async () => {
    const [templateRow] = await db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(eq(reportTemplate.testDefinitionId, testDefId))
      .limit(1);
    const [published] = await db
      .select({ id: reportTemplateVersion.id })
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, templateRow.id),
          eq(reportTemplateVersion.status, 'published'),
        ),
      )
      .limit(1);

    await request(app.getHttpServer())
      .post(
        `/v1/report-templates/${templateRow.id}/versions/${published.id}/publish`,
      )
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(409);
  });

  it("RLS: tenant B cannot see tenant A's report_template rows", async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`,
    );
    const rows = await db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(eq(reportTemplate.testDefinitionId, testDefId));
    expect(rows).toHaveLength(0);
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  it(
    'immutable snapshot (AC #2): a report generated against the currently-published version keeps ' +
      'referencing that exact version after a newer version is published',
    async () => {
      const [templateRow] = await db
        .select({ id: reportTemplate.id })
        .from(reportTemplate)
        .where(eq(reportTemplate.testDefinitionId, testDefId))
        .limit(1);
      const [publishedBefore] = await db
        .select({ id: reportTemplateVersion.id })
        .from(reportTemplateVersion)
        .where(
          and(
            eq(reportTemplateVersion.reportTemplateId, templateRow.id),
            eq(reportTemplateVersion.status, 'published'),
          ),
        )
        .limit(1);

      const patientId = await createPatient();
      const { orderId, orderedTestId } = await createOrder(patientId);
      await receiveAndVerify(orderedTestId, orderId);

      const result = await assemble(orderedTestId);

      const [reportRow] = await db
        .select({ templateVersionId: report.templateVersionId })
        .from(report)
        .where(eq(report.id, result.reportId))
        .limit(1);
      expect(reportRow.templateVersionId).toBe(publishedBefore.id);

      // Publish a genuinely different layout on the same template.
      const versionRes = await request(app.getHttpServer())
        .post(`/v1/report-templates/${templateRow.id}/versions`)
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          definition: {
            sections: [
              {
                title: 'Results (different layout)',
                fields: [
                  {
                    key: 'a-v3',
                    label: 'Analyte A (v3, different label)',
                    type: 'numeric',
                    analyteBinding: analyteAId,
                  },
                ],
              },
            ],
          },
        })
        .expect(201);
      const v3Id = (versionRes.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`/v1/report-templates/${templateRow.id}/versions/${v3Id}/publish`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);

      const [reportRowAfter] = await db
        .select({ templateVersionId: report.templateVersionId })
        .from(report)
        .where(eq(report.id, result.reportId))
        .limit(1);
      expect(reportRowAfter.templateVersionId).toBe(publishedBefore.id);
      expect(reportRowAfter.templateVersionId).not.toBe(v3Id);
    },
  );

  it('a genuinely different layout renders successfully for a new report (AC #1)', async () => {
    const [templateRow] = await db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(eq(reportTemplate.testDefinitionId, testDefId))
      .limit(1);
    const [publishedNow] = await db
      .select({ id: reportTemplateVersion.id })
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, templateRow.id),
          eq(reportTemplateVersion.status, 'published'),
        ),
      )
      .limit(1);

    const patientId = await createPatient();
    const { orderId, orderedTestId } = await createOrder(patientId);
    await receiveAndVerify(orderedTestId, orderId);

    const result = await assemble(orderedTestId);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const [reportRow] = await db
      .select({ templateVersionId: report.templateVersionId })
      .from(report)
      .where(eq(report.id, result.reportId))
      .limit(1);
    // Proves the *currently* published version (v3, from the previous test)
    // is what actually rendered -- the honest, non-pdf-internals-dependent
    // way to prove AC #1 ("via configuration, no deploy") without asserting
    // on pdfkit's own hex-encoded text-run encoding (see report-render.spec.ts's
    // own header comment on why that's unreliable).
    expect(reportRow.templateVersionId).toBe(publishedNow.id);
  });
});
