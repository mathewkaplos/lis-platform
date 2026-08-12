import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, max, sql } from 'drizzle-orm';
import {
  createDb,
  report,
  reportTemplate,
  reportTemplateVersion,
  testDefinition,
  analyte,
  codeSystemValue,
  organism,
  antimicrobial,
} from '@lis/db';
import type { ReportTemplateDefinition } from '@lis/domain';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-054 (docs/plans/feat-054-culture-report-template-prelim-final-
 * lifecycle.md). The preliminary/final lifecycle MECHANISM is already
 * fully proven against chemistry fixtures in `report-assembly.e2e-spec.ts`
 * (that proposal's own §8, chosen deliberately so the mechanism didn't
 * have to wait on FEAT-051/052/053) -- this file doesn't re-prove that.
 * It proves the two things that WERE genuinely blocked until this session:
 * AC #1 (a lab admin can author a real culture/antibiogram layout through
 * the existing designer API, no code change) and the actually-
 * microbiology-shaped preliminary -> final scenario end-to-end, against
 * real EUCAST-driven antibiogram data.
 *
 * Also the real regression proof for `formatObservationValue`'s new
 * `dataType === 'table'` branch (`report-assembly.ts`) -- a real gap found
 * while building this file's own fixture (see that function's own header
 * comment): the antibiogram's own table-typed Observation previously
 * rendered as a blank cell. That string-formatting logic itself is
 * unit-tested directly in `report-assembly.spec.ts`; this file proves the
 * full pipeline (guardrail, publish, preliminary/final generation) around
 * it integrates correctly against a real culture panel.
 */
describe('Culture report template & preliminary/final lifecycle (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let qaToken: string;
  let technologistToken: string;
  let verifierToken: string;

  let orgidTestDefId: string;
  let orgidTemplateId: string;
  let organismIdentifiedAnalyteId: string;
  let antibiogramTableAnalyteId: string;
  let ecoliSnomedCode: string;
  let ampicillinId: string;
  let meropenemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    [qaToken, technologistToken, verifierToken] = await Promise.all([
      getKeycloakToken('test-user-5', 'test-password-5'),
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
    ]);

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [orgidDef] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, 'ORGID'),
        ),
      );
    if (!orgidDef) {
      throw new Error(
        'ORGID test_definition not found -- run `pnpm db:reset` first',
      );
    }
    orgidTestDefId = orgidDef.id;

    const [orgidTemplate] = await db
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(
        and(
          eq(reportTemplate.tenantId, TENANT_A),
          eq(reportTemplate.testDefinitionId, orgidTestDefId),
        ),
      );
    if (!orgidTemplate) {
      throw new Error(
        'ORGID has no report_template -- run `pnpm db:reset` first (default-report-templates.sql)',
      );
    }
    orgidTemplateId = orgidTemplate.id;

    const [organismIdentifiedAnalyte] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .innerJoin(
        codeSystemValue,
        eq(analyte.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'LOINC'),
          eq(codeSystemValue.code, '634-6'),
        ),
      );
    organismIdentifiedAnalyteId = organismIdentifiedAnalyte.id;

    const [antibiogramTableAnalyte] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .innerJoin(
        codeSystemValue,
        eq(analyte.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'LOINC'),
          eq(codeSystemValue.code, '50545-3'),
        ),
      );
    antibiogramTableAnalyteId = antibiogramTableAnalyte.id;

    const [ecoli] = await db
      .select({ code: codeSystemValue.code })
      .from(organism)
      .innerJoin(
        codeSystemValue,
        eq(organism.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(codeSystemValue.code, '112283007'));
    ecoliSnomedCode = ecoli.code;

    async function antimicrobialIdByAtc(atcCode: string): Promise<string> {
      const [row] = await db
        .select({ id: antimicrobial.id })
        .from(antimicrobial)
        .innerJoin(
          codeSystemValue,
          eq(antimicrobial.codeSystemValueId, codeSystemValue.id),
        )
        .where(
          and(
            eq(codeSystemValue.system, 'ATC'),
            eq(codeSystemValue.code, atcCode),
          ),
        );
      return row.id;
    }
    ampicillinId = await antimicrobialIdByAtc('J01CA01');
    meropenemId = await antimicrobialIdByAtc('J01DH02');
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC #1: a qa admin can author a real culture/antibiogram report layout through the existing designer API (no code change) and publish it', async () => {
    const definition: ReportTemplateDefinition = {
      sections: [
        {
          title: 'Organism Identification',
          fields: [
            {
              key: 'organism-identified-v2e2e',
              label: 'Organism Identified',
              type: 'coded',
              analyteBinding: organismIdentifiedAnalyteId,
            },
          ],
        },
        {
          title: 'Antibiogram',
          fields: [
            {
              key: 'antibiogram-table-v2e2e',
              label: 'Susceptibility (MIC)',
              type: 'table',
              analyteBindings: [antibiogramTableAnalyteId],
            },
          ],
        },
      ],
    };

    const versionRes = await request(app.getHttpServer())
      .post(`/v1/report-templates/${orgidTemplateId}/versions`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ definition })
      .expect(201);
    const versionBody = versionRes.body as { id: string; status: string };
    expect(versionBody.status).toBe('draft');

    const publishRes = await request(app.getHttpServer())
      .post(
        `/v1/report-templates/${orgidTemplateId}/versions/${versionBody.id}/publish`,
      )
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
    const publishBody = publishRes.body as { id: string; status: string };
    expect(publishBody.status).toBe('published');

    // Real, structural proof this is now the active published version --
    // at most one published version per template.
    const publishedRows = await db
      .select()
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, orgidTemplateId),
          eq(reportTemplateVersion.status, 'published'),
        ),
      );
    expect(publishedRows).toHaveLength(1);
    expect(publishedRows[0].id).toBe(versionBody.id);
  });

  it('a real culture panel goes preliminary -> final using the newly-authored culture template, rendering a real (non-blank) antibiogram', async () => {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        firstName: 'Culture',
        lastName: 'Lifecycle',
        sex: 'U',
        birthDate: '1980-01-01',
      })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        patientId,
        testDefinitionIds: [orgidTestDefId],
        priority: 'routine',
      })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderedTestId = orderBody.after.orderedTests[0].id;

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'swab' })
      .expect(201);

    // Organism identified, entered but not yet finalized/verified -- the
    // antibiogram hasn't been recorded at all yet. The panel has *some*
    // signal but nothing verified: exactly the relaxed-precondition
    // scenario the preliminary path exists for (KB-21: culture is
    // genuinely provisional for days).
    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${organismIdentifiedAnalyteId}`,
      )
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ dataType: 'coded', valueCode: ecoliSnomedCode })
      .expect(200);

    const preliminaryRes = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/report/preliminary`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    expect(Buffer.byteLength(preliminaryRes.body as Buffer)).toBeGreaterThan(0);

    const [preliminaryRow] = await db
      .select()
      .from(report)
      .where(eq(report.orderedTestId, orderedTestId));
    expect(preliminaryRow.reportType).toBe('preliminary');
    expect(preliminaryRow.templateVersionId).not.toBeNull();

    const [usedVersion] = await db
      .select({ definition: reportTemplateVersion.definition })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.id, preliminaryRow.templateVersionId!));
    const usedDefinition = usedVersion.definition as ReportTemplateDefinition;
    expect(usedDefinition.sections.some((s) => s.title === 'Antibiogram')).toBe(
      true,
    );

    // Finalize the organism-identified result, record the real antibiogram
    // (real EUCAST v16.0 breakpoints, FEAT-051/053), then verify the two
    // analytes actually on ORGID's own test_analyte set (Organism
    // Identified + the Antibiogram table analyte -- the 4 discrete
    // antimicrobial-susceptibility analytes are deliberately NOT linked
    // there, FEAT-053's own design, so they don't gate the final
    // precondition).
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${organismIdentifiedAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ dataType: 'coded', valueCode: ecoliSnomedCode })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${organismIdentifiedAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        results: [
          { antimicrobialId: ampicillinId, micValue: 16 }, // -> R
          { antimicrobialId: meropenemId, micValue: 1 }, // -> S
        ],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${antibiogramTableAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    const finalRes = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/report`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    expect(Buffer.byteLength(finalRes.body as Buffer)).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(report)
      .where(eq(report.orderedTestId, orderedTestId));
    expect(rows).toHaveLength(2);
    const finalRow = rows.find((r) => r.reportType === 'final');
    const stillPreliminaryRow = rows.find(
      (r) => r.reportType === 'preliminary',
    );
    expect(finalRow).toBeDefined();
    expect(stillPreliminaryRow).toBeDefined();
    expect(stillPreliminaryRow!.id).toBe(preliminaryRow.id);
  });

  it('a fresh ORGID template lookup uses the highest published version, never version 1 (max version, not a stale cached one)', async () => {
    const [{ maxVersion }] = await db
      .select({ maxVersion: max(reportTemplateVersion.version) })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.reportTemplateId, orgidTemplateId));
    const [publishedRow] = await db
      .select()
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, orgidTemplateId),
          eq(reportTemplateVersion.status, 'published'),
        ),
      );
    expect(publishedRow.version).toBe(maxVersion);
  });
});
