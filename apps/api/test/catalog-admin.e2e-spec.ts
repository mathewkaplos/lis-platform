import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  referenceRange,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). `POST /v1/test-
 * definitions` and `POST/GET /v1/reference-ranges` -- the issue's own
 * literal AC ("add a new test... reference range"), narrowed per the
 * proposal's own findings (analyte creation and the §20.5 Templates screen
 * are both explicitly out of scope, §10 Q1/Q2). Fixture style mirrors
 * `report-template.e2e-spec.ts` -- synthetic, non-clinical analyte/unit,
 * real Postgres/Keycloak.
 */
describe('Catalog admin (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let qaToken: string;
  let technologistToken: string;
  let tenantBToken: string;

  let mgdlUnitId: string;
  let analyteAId: string;
  let analyteBId: string;

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

    // Same seeded users this session's own FEAT-029/032 e2e suites use:
    // test-user-5 = qa (TENANT_A), test-user = technologist (TENANT_A),
    // test-user-2 = verifier (TENANT_B, `patient.e2e-spec.ts`'s own precedent).
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

    const [csvA] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'FEAT-035-SYNTH-A',
        version: '1',
        display: 'FEAT-035 synthetic analyte A (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });
    const [csvB] = await db
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: 'FEAT-035-SYNTH-B',
        version: '1',
        display: 'FEAT-035 synthetic analyte B (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id });

    const [analyteA] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csvA.id,
        display: 'FEAT-035 Synthetic Analyte A (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteAId = analyteA.id;
    const [analyteB] = await db
      .insert(analyte)
      .values({
        codeSystemValueId: csvB.id,
        display: 'FEAT-035 Synthetic Analyte B (non-clinical)',
        dataType: 'quantity',
        defaultUnitId: mgdlUnitId,
      })
      .returning({ id: analyte.id });
    analyteBId = analyteB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/test-definitions', () => {
    it('rejects a non-qa session (403)', async () => {
      await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${technologistToken}`)
        .send({
          code: 'FEAT035-T1',
          displayName: 'FEAT-035 Test 1',
          analyteIds: [analyteAId],
        })
        .expect(403);
    });

    it('rejects an empty analyteIds array (400, schema-level)', async () => {
      await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          code: 'FEAT035-T2',
          displayName: 'FEAT-035 Test 2',
          analyteIds: [],
        })
        .expect(400);
    });

    it('rejects an unknown analyte id (400)', async () => {
      await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          code: 'FEAT035-T3',
          displayName: 'FEAT-035 Test 3',
          analyteIds: ['99999999-9999-9999-9999-999999999999'],
        })
        .expect(400);
    });

    it('creates a test_definition bound to existing analytes, audited, visible via GET /v1/catalog', async () => {
      const before = await auditCount(qaToken);

      const res = await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          code: 'FEAT035-T4',
          displayName: 'FEAT-035 Test 4 (two analytes)',
          analyteIds: [analyteAId, analyteBId],
        })
        .expect(201);
      const body = res.body as {
        resourceId: string;
        after: { id: string; analyteIds: string[] };
      };
      expect(body.after.analyteIds.sort()).toEqual(
        [analyteAId, analyteBId].sort(),
      );

      const after = await auditCount(qaToken);
      expect(after).toBe(before + 1);

      const [row] = await db
        .select({ id: testDefinition.id })
        .from(testDefinition)
        .where(eq(testDefinition.id, body.resourceId))
        .limit(1);
      expect(row).toBeDefined();

      const links = await db
        .select({ analyteId: testAnalyte.analyteId })
        .from(testAnalyte)
        .where(eq(testAnalyte.testDefinitionId, body.resourceId));
      expect(links.map((l) => l.analyteId).sort()).toEqual(
        [analyteAId, analyteBId].sort(),
      );

      const catalogRes = await request(app.getHttpServer())
        .get('/v1/catalog')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);
      const catalogBody = catalogRes.body as { tests: { code: string }[] };
      expect(catalogBody.tests.some((t) => t.code === 'FEAT035-T4')).toBe(true);
    });

    // Issue #781 (pilot-readiness audit): billingCode/priceCents already
    // existed on the test_definition schema (FEAT-046/ADR-0041) but this
    // route never accepted either, so every test created through the admin
    // UI came out unbillable -- confirmed live.
    it('accepts and persists billingCode/priceCents, both optional', async () => {
      const priced = await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          code: 'FEAT035-T5-PRICED',
          displayName: 'FEAT-035 Test 5 (priced)',
          analyteIds: [analyteAId],
          billingCode: 'CPT 12345',
          priceCents: 1500,
        })
        .expect(201);
      const pricedBody = priced.body as {
        resourceId: string;
        after: { billingCode: string | null; priceCents: number | null };
      };
      expect(pricedBody.after.billingCode).toBe('CPT 12345');
      expect(pricedBody.after.priceCents).toBe(1500);

      const [pricedRow] = await db
        .select({
          billingCode: testDefinition.billingCode,
          priceCents: testDefinition.priceCents,
        })
        .from(testDefinition)
        .where(eq(testDefinition.id, pricedBody.resourceId))
        .limit(1);
      expect(pricedRow.billingCode).toBe('CPT 12345');
      expect(pricedRow.priceCents).toBe(1500);

      const unpriced = await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          code: 'FEAT035-T6-UNPRICED',
          displayName: 'FEAT-035 Test 6 (unpriced)',
          analyteIds: [analyteAId],
        })
        .expect(201);
      const unpricedBody = unpriced.body as {
        after: { billingCode: string | null; priceCents: number | null };
      };
      expect(unpricedBody.after.billingCode).toBeNull();
      expect(unpricedBody.after.priceCents).toBeNull();
    });
  });

  describe('POST/GET /v1/reference-ranges', () => {
    it('rejects a non-qa session on create (403)', async () => {
      await request(app.getHttpServer())
        .post('/v1/reference-ranges')
        .set('Authorization', `Bearer ${technologistToken}`)
        .send({
          analyteId: analyteAId,
          unitId: mgdlUnitId,
          rangeType: 'normal',
          low: 1,
          high: 100,
        })
        .expect(403);
    });

    it('creates a reference range, audited, add-only (no effectiveTo accepted)', async () => {
      const before = await auditCount(qaToken);

      const res = await request(app.getHttpServer())
        .post('/v1/reference-ranges')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          analyteId: analyteAId,
          unitId: mgdlUnitId,
          rangeType: 'normal',
          low: 2,
          high: 20,
          sex: 'F',
        })
        .expect(201);
      const body = res.body as {
        resourceId: string;
        after: { low: number; high: number; sex: string | null };
      };
      expect(body.after.low).toBe(2);
      expect(body.after.high).toBe(20);
      expect(body.after.sex).toBe('F');

      const after = await auditCount(qaToken);
      expect(after).toBe(before + 1);

      const [row] = await db
        .select({ effectiveTo: referenceRange.effectiveTo })
        .from(referenceRange)
        .where(eq(referenceRange.id, body.resourceId))
        .limit(1);
      expect(row.effectiveTo).toBeNull();
    });

    it('filters the list by analyteId', async () => {
      await request(app.getHttpServer())
        .post('/v1/reference-ranges')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          analyteId: analyteBId,
          unitId: mgdlUnitId,
          rangeType: 'normal',
          low: 5,
          high: 50,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/reference-ranges?analyteId=${analyteAId}`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);
      const body = res.body as { ranges: { analyteId: string }[] };
      expect(body.ranges.length).toBeGreaterThan(0);
      expect(body.ranges.every((r) => r.analyteId === analyteAId)).toBe(true);
    });

    it("RLS: tenant B cannot see tenant A's reference ranges", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/reference-ranges?analyteId=${analyteAId}`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .expect(200);
      const body = res.body as { ranges: unknown[] };
      expect(body.ranges).toHaveLength(0);
    });
  });
});
