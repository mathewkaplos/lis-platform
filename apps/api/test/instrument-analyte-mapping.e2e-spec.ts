import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  instrumentAnalyteMapping,
  unit,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * Issue #812 (docs/plans/task-812-instrument-analyte-mapping-admin-ui.md).
 * `instrument_analyte_mapping` already has a real, correct schema but no
 * controller/route -- the only way to populate it was a direct SQL
 * `INSERT`. Fixture style mirrors `catalog-admin.e2e-spec.ts` -- synthetic,
 * non-clinical analyte/unit, real Postgres/Keycloak.
 */
describe('Instrument-analyte mapping admin (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let qaToken: string;
  let technologistToken: string;
  let tenantBToken: string;

  let mgdlUnitId: string;
  let analyteId: string;

  async function auditCount(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    // Same seeded users `catalog-admin.e2e-spec.ts` already uses:
    // test-user-5 = qa (TENANT_A), test-user = technologist (TENANT_A),
    // test-user-2 = verifier (TENANT_B).
    qaToken = await getKeycloakToken('test-user-5', 'test-password-5');
    technologistToken = await getKeycloakToken('test-user', 'test-password');
    tenantBToken = await getKeycloakToken('test-user-2', 'test-password-2');

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

    const [csv] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'ISSUE-812-SYNTH',
        version: '1',
        display: 'Issue #812 synthetic analyte (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });

    const [analyteRow] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csv.id,
        display: 'Issue #812 Synthetic Analyte (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteId = analyteRow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/instrument-analyte-mappings', () => {
    it('rejects a non-manage_catalog session (403)', async () => {
      await request(app.getHttpServer())
        .post('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${technologistToken}`)
        .send({
          instrumentId: 'ANALYZER-1',
          channelCode: 'CH1',
          analyteId,
          unitId: mgdlUnitId,
        })
        .expect(403);
    });

    it('rejects an unknown analyte id (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          instrumentId: 'ANALYZER-1',
          channelCode: 'CH1',
          analyteId: '99999999-9999-9999-9999-999999999999',
          unitId: mgdlUnitId,
        })
        .expect(400);
    });

    it('rejects an unknown unit id (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          instrumentId: 'ANALYZER-1',
          channelCode: 'CH1',
          analyteId,
          unitId: '99999999-9999-9999-9999-999999999999',
        })
        .expect(400);
    });

    it('creates a published mapping by default, audited, listed via GET', async () => {
      const before = await auditCount(qaToken);

      const res = await request(app.getHttpServer())
        .post('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          instrumentId: 'ANALYZER-1',
          channelCode: 'CH-GLU',
          analyteId,
          unitId: mgdlUnitId,
          conversionFactor: 1,
        })
        .expect(201);
      const body = res.body as {
        resourceId: string;
        after: { status: string; analyteDisplay: string; conversionFactor: number };
      };
      expect(body.after.status).toBe('published');
      expect(body.after.conversionFactor).toBe(1);
      expect(body.after.analyteDisplay).toBe(
        'Issue #812 Synthetic Analyte (non-clinical)',
      );

      const after = await auditCount(qaToken);
      expect(after).toBe(before + 1);

      const [row] = await db
        .select({ status: instrumentAnalyteMapping.status })
        .from(instrumentAnalyteMapping)
        .where(eq(instrumentAnalyteMapping.id, body.resourceId))
        .limit(1);
      expect(row.status).toBe('published');

      const listRes = await request(app.getHttpServer())
        .get('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);
      const listBody = listRes.body as { mappings: { id: string }[] };
      expect(listBody.mappings.some((m) => m.id === body.resourceId)).toBe(
        true,
      );
    });

    it('409s on a duplicate published (tenant, instrument, channel)', async () => {
      await request(app.getHttpServer())
        .post('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          instrumentId: 'ANALYZER-2',
          channelCode: 'CH-DUP',
          analyteId,
          unitId: mgdlUnitId,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          instrumentId: 'ANALYZER-2',
          channelCode: 'CH-DUP',
          analyteId,
          unitId: mgdlUnitId,
        })
        .expect(409);
    });

    it("RLS: tenant B cannot see tenant A's mappings", async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instrument-analyte-mappings')
        .set('Authorization', `Bearer ${tenantBToken}`)
        .expect(200);
      const body = res.body as { mappings: unknown[] };
      expect(body.mappings).toHaveLength(0);
    });
  });
});
