import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  reportTemplate,
  reportTemplateVersion,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-047 (docs/plans/feat-047-visual-report-designer-v1.md §8). Proves the
 * designer's own request shapes (all 5 field types + a visibilityCondition
 * in one definition, plus a table field) round-trip successfully through
 * the unchanged FEAT-032 routes, and that the server-side guardrail
 * (`report-template-guardrails.ts`) still rejects an invalid definition
 * even though it's shaped exactly like what the canvas would submit --
 * proving the designer's own client-side checks are fast feedback, not the
 * only thing preventing an invalid template (proposal AC #3). Fixture style
 * mirrors `report-template.e2e-spec.ts`'s own synthetic, non-clinical
 * analytes/test -- a separate test_definition so this file stays
 * self-contained and doesn't share mutable state with that suite.
 */
describe('Report template designer (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let qaToken: string;

  let mgdlUnitId: string;
  let analyteAId: string;
  let analyteBId: string;
  let testDefId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    qaToken = await getKeycloakToken('test-user-5', 'test-password-5');

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
        code: 'FEAT-047-SYNTH-A',
        version: '1',
        display: 'FEAT-047 synthetic analyte A (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });
    const [csvB] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'FEAT-047-SYNTH-B',
        version: '1',
        display: 'FEAT-047 synthetic analyte B (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });

    const [analyteA] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csvA.id,
        display: 'FEAT-047 Synthetic Analyte A (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteAId = analyteA.id;
    const [analyteB] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csvB.id,
        display: 'FEAT-047 Synthetic Analyte B (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteBId = analyteB.id;

    const [def] = await db
      .insert(testDefinition)
      .values({
        tenantId: TENANT_A,
        code: 'FEAT047-SYNTH-1',
        displayName: 'FEAT-047 Synthetic Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });
    testDefId = def.id;
    await db.insert(testAnalyte).values([
      {
        tenantId: TENANT_A,
        testDefinitionId: testDefId,
        analyteId: analyteAId,
      },
      {
        tenantId: TENANT_A,
        testDefinitionId: testDefId,
        analyteId: analyteBId,
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates and publishes a definition covering all 5 field types + a visibilityCondition, via the designer's own request shape", async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/report-templates')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        testDefinitionId: testDefId,
        definition: {
          sections: [
            {
              title: 'Results',
              fields: [
                {
                  key: 'a',
                  label: 'Analyte A',
                  type: 'numeric',
                  analyteBinding: analyteAId,
                  visibilityCondition: {
                    field: 'isCritical',
                    op: 'eq',
                    value: true,
                  },
                },
                {
                  key: 'b-coded',
                  label: 'Analyte B (coded)',
                  type: 'coded',
                  analyteBinding: analyteBId,
                },
                {
                  key: 'a-range',
                  label: 'Analyte A range',
                  type: 'referenceRangeDisplay',
                  analyteBinding: analyteAId,
                },
                {
                  key: 'summary',
                  label: 'Summary table',
                  type: 'table',
                  analyteBindings: [analyteAId, analyteBId],
                },
                {
                  key: 'note',
                  label: 'Note',
                  type: 'richText',
                  content: 'Interpreted by the lab director.',
                },
              ],
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
      .expect(200);

    const [row] = await db
      .select({ status: reportTemplateVersion.status })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.id, body.versions[0].id))
      .limit(1);
    expect(row.status).toBe('published');
  });

  it("rejects a table field with no analyteBindings at publish time, even shaped like the designer's own save action", async () => {
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
              // The designer's own checkbox picker would never let an
              // admin submit this (client-side "fast feedback" -- proposal
              // AC #3) -- a direct request proves the server's own
              // guardrail is the real, non-bypassable check regardless.
              fields: [
                { key: 'empty-table', label: 'Empty table', type: 'table' },
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

    const [row] = await db
      .select({ status: reportTemplateVersion.status })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.id, versionBody.id))
      .limit(1);
    expect(row.status).toBe('draft');
  });

  it('GET /v1/report-templates returns the wrapped { templates } shape documented by @ZodResponse', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/report-templates')
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
    const body = res.body as { templates: unknown[] };
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates.length).toBeGreaterThan(0);
  });
});
