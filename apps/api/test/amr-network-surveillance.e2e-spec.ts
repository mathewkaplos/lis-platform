import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  createDb,
  tenant,
  patient,
  order,
  orderedTest,
  testDefinition,
  observation,
  organism,
  antimicrobial,
  analyte,
  codeSystemValue,
} from '@lis/db';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { getPlatformAnalyticsToken } from './get-platform-analytics-token';

// Brand-new tenant ids, never touched by any other e2e spec file -- the
// network report's own query granularity is a whole calendar month (ADR-0048
// decision 6), too coarse to isolate via a tight ad hoc window the way
// operational-reports.e2e-spec.ts/amr-surveillance.e2e-spec.ts do for their
// own from/to ranges. Using tenant ids no other fixture ever writes under
// removes the contamination risk structurally instead.
const TENANT_SHARED = '00000000-0000-0000-0000-0000000000e1';
const TENANT_DEDICATED = '00000000-0000-0000-0000-0000000000e2';
const TENANT_NOT_OPTED_IN = '00000000-0000-0000-0000-0000000000e3';
const SCHEMA_NAME = 'amr_network_surveillance_e2e';
const MONTH = '2025-06';
const VERIFIED_AT = new Date('2025-06-15T12:00:00Z');

/**
 * FEAT-056 (docs/plans/feat-056-cross-tenant-deidentified-aggregation.md,
 * ADR-0048). Proves the ADR's own four acceptance criteria directly: a
 * `dedicated_schema` tenant genuinely contributes and is counted correctly
 * alongside a `shared` tenant (only provable by combining both -- neither
 * tenant's own count alone crosses the suppression threshold), an
 * opted-out tenant never appears, no returned cell shows an exact count
 * below 5, and no tenant/facility identifier appears anywhere in the
 * response shape.
 *
 * Uses two brand-new synthetic global antimicrobials + one synthetic
 * organism (`makeAnalyteAndTest`-style precedent, `operational-
 * reports.e2e-spec.ts`) rather than any real EUCAST organism/antimicrobial
 * -- this file's own counts must never be able to collide with any other
 * spec's own real E. coli/Ampicillin-style fixture data, regardless of
 * which tenant or month is used elsewhere in a full-suite run.
 *
 * The `dedicated_schema` tenant's own `observation`/`audit_event` tables
 * are minimal, purpose-built clones (no FKs) -- `tenant-tier-
 * routing.e2e-spec.ts`'s own established precedent for proving cross-schema
 * routing without standing up that tenant's entire real schema.
 */
describe('AMR network surveillance report (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
  const migrationDb = createDb(process.env.DATABASE_URL);

  let app: INestApplication<App>;
  let platformAnalyticsToken: string;
  let qaToken: string;

  let organismCsvId: string;
  let organismCsvCode: string;
  let am1CsvId: string;
  let am1AnalyteId: string;
  let am1Id: string;
  let am2CsvId: string;
  let am2AnalyteId: string;
  let am2Id: string;

  async function insertOrgIdentifiedAndSusceptibility(
    tenantId: string,
    entries: { analyteId: string; valueCode: string; verifiedAt: Date }[],
  ) {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`,
    );

    const organismIdentifiedAnalyte = await db
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
      )
      .limit(1);

    const [p] = await db
      .insert(patient)
      .values({
        tenantId,
        mrn: `NET-${tenantId.slice(-4)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        firstName: 'Network',
        lastName: 'Fixture',
        sex: 'U',
      })
      .returning({ id: patient.id });

    const [td] = await db
      .insert(testDefinition)
      .values({
        tenantId,
        code: `NET-${tenantId.slice(-2)}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: 'FEAT-056 Synthetic Panel (non-clinical)',
      })
      .returning({ id: testDefinition.id });

    const [o] = await db
      .insert(order)
      .values({ tenantId, patientId: p.id })
      .returning({ id: order.id });

    const [ot] = await db
      .insert(orderedTest)
      .values({ tenantId, orderId: o.id, testDefinitionId: td.id })
      .returning({ id: orderedTest.id });

    await db.insert(observation).values({
      tenantId,
      orderedTestId: ot.id,
      analyteId: organismIdentifiedAnalyte[0].id,
      patientId: p.id,
      isControl: false,
      dataType: 'coded',
      valueCode: organismCsvCode,
      status: 'verified',
      source: 'manual',
      producedAt: new Date(),
    });

    for (const entry of entries) {
      await db.insert(observation).values({
        tenantId,
        orderedTestId: ot.id,
        analyteId: entry.analyteId,
        patientId: p.id,
        isControl: false,
        dataType: 'coded',
        valueCode: entry.valueCode,
        status: 'verified',
        verifiedAt: entry.verifiedAt,
        source: 'manual',
        producedAt: entry.verifiedAt,
      });
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    [platformAnalyticsToken, qaToken] = await Promise.all([
      getPlatformAnalyticsToken(),
      getKeycloakToken('test-user-5', 'test-password-5'),
    ]);

    // 1. Synthetic global organism + two synthetic global antimicrobials
    // (each with its own coded susceptibility-result analyte) -- global,
    // no tenant_id/RLS, exactly like FEAT-051's own real catalog rows.
    const suffix = Date.now().toString(36);
    const [orgCsv] = await migrationDb
      .insert(codeSystemValue)
      .values({
        system: 'TEST',
        code: `NET-ORG-${suffix}`,
        version: '1',
        display: 'FEAT-056 Synthetic Organism (non-clinical, spec-local only)',
      })
      .returning({ id: codeSystemValue.id, code: codeSystemValue.code });
    organismCsvId = orgCsv.id;
    organismCsvCode = orgCsv.code;
    await migrationDb
      .insert(organism)
      .values({ codeSystemValueId: orgCsv.id, display: 'Synthetic Organism' });

    async function makeSyntheticAntimicrobial(label: string) {
      const [amCsv] = await migrationDb
        .insert(codeSystemValue)
        .values({
          system: 'TEST',
          code: `NET-AM-${label}-${suffix}`,
          version: '1',
          display: `FEAT-056 Synthetic Antimicrobial ${label} (non-clinical)`,
        })
        .returning({ id: codeSystemValue.id });
      const [a] = await migrationDb
        .insert(analyte)
        .values({
          codeSystemValueId: amCsv.id,
          display: `FEAT-056 Synthetic Susceptibility ${label} (non-clinical)`,
          dataType: 'coded',
        })
        .returning({ id: analyte.id });
      const [am] = await migrationDb
        .insert(antimicrobial)
        .values({
          codeSystemValueId: amCsv.id,
          display: `Synthetic Antimicrobial ${label}`,
          analyteId: a.id,
        })
        .returning({ id: antimicrobial.id });
      return { csvId: amCsv.id, analyteId: a.id, id: am.id };
    }
    const am1 = await makeSyntheticAntimicrobial('ONE');
    am1CsvId = am1.csvId;
    am1AnalyteId = am1.analyteId;
    am1Id = am1.id;
    const am2 = await makeSyntheticAntimicrobial('TWO');
    am2CsvId = am2.csvId;
    am2AnalyteId = am2.analyteId;
    am2Id = am2.id;

    // 2. Three fresh tenant registry rows.
    await migrationDb.insert(tenant).values([
      {
        id: TENANT_SHARED,
        name: 'e2e-network-shared',
        isolationTier: 'shared',
        amrSurveillanceOptIn: true,
      },
      {
        id: TENANT_DEDICATED,
        name: 'e2e-network-dedicated',
        isolationTier: 'dedicated_schema',
        schemaName: SCHEMA_NAME,
        amrSurveillanceOptIn: true,
      },
      {
        id: TENANT_NOT_OPTED_IN,
        name: 'e2e-network-not-opted-in',
        isolationTier: 'shared',
        amrSurveillanceOptIn: false,
      },
    ]);

    // 3. TENANT_SHARED: real public.observation rows. AM1: 2 S + 1 R (3 --
    // alone, below the n<5 suppression floor). AM2: 2 S (also below floor,
    // and never combined with any other tenant -- proves suppression).
    await insertOrgIdentifiedAndSusceptibility(TENANT_SHARED, [
      { analyteId: am1AnalyteId, valueCode: 'S', verifiedAt: VERIFIED_AT },
      { analyteId: am1AnalyteId, valueCode: 'S', verifiedAt: VERIFIED_AT },
      { analyteId: am1AnalyteId, valueCode: 'R', verifiedAt: VERIFIED_AT },
      { analyteId: am2AnalyteId, valueCode: 'S', verifiedAt: VERIFIED_AT },
      { analyteId: am2AnalyteId, valueCode: 'S', verifiedAt: VERIFIED_AT },
    ]);

    // 4. TENANT_NOT_OPTED_IN: 10 more real AM1/R results, same organism --
    // if opt-out isolation ever broke, AM1's merged total would jump from
    // 6 to 16.
    await insertOrgIdentifiedAndSusceptibility(
      TENANT_NOT_OPTED_IN,
      Array.from({ length: 10 }, () => ({
        analyteId: am1AnalyteId,
        valueCode: 'R' as const,
        verifiedAt: VERIFIED_AT,
      })),
    );

    // 5. TENANT_DEDICATED: minimal clone schema (provisioned as the
    // migrations role -- `lis_app` has no CREATE privilege, confirmed live
    // via tenant-isolation-check.ts, same precedent tenant-tier-
    // routing.e2e-spec.ts already established). AM1: 1 S + 2 R (3 -- alone,
    // also below the floor; combined with TENANT_SHARED's own 3, the real
    // merged total is 6, only provable by correctly reading both tiers).
    await migrationDb.execute(
      sql.raw(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA_NAME}"`),
    );
    await migrationDb.execute(
      sql.raw(`GRANT USAGE ON SCHEMA "${SCHEMA_NAME}" TO "lis_app"`),
    );
    await migrationDb.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS "${SCHEMA_NAME}"."observation" (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL,
          ordered_test_id uuid,
          analyte_id uuid NOT NULL,
          value_code text,
          status text NOT NULL DEFAULT 'registered',
          verified_at timestamptz,
          superseded_by uuid
        )
      `),
    );
    await migrationDb.execute(
      sql.raw(
        `GRANT SELECT, INSERT ON "${SCHEMA_NAME}"."observation" TO "lis_app"`,
      ),
    );
    await migrationDb.execute(
      sql.raw(
        `ALTER TABLE "${SCHEMA_NAME}"."observation" ENABLE ROW LEVEL SECURITY`,
      ),
    );
    await migrationDb.execute(
      sql.raw(`
        DO $$ BEGIN
          CREATE POLICY tenant_isolation ON "${SCHEMA_NAME}"."observation"
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `),
    );
    await migrationDb.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS "${SCHEMA_NAME}"."audit_event" (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          sequence bigserial NOT NULL,
          tenant_id uuid NOT NULL,
          occurred_at timestamptz NOT NULL DEFAULT now(),
          actor_principal_id uuid NOT NULL,
          actor_role text NOT NULL,
          actor_type text NOT NULL,
          action text NOT NULL,
          resource_type text NOT NULL,
          resource_id uuid NOT NULL,
          before jsonb,
          after jsonb,
          reason text,
          context jsonb,
          prev_hash bytea,
          hash bytea NOT NULL
        )
      `),
    );
    await migrationDb.execute(
      sql.raw(
        `GRANT SELECT, INSERT ON "${SCHEMA_NAME}"."audit_event" TO "lis_app"`,
      ),
    );
    await migrationDb.execute(
      sql.raw(
        `GRANT USAGE ON ALL SEQUENCES IN SCHEMA "${SCHEMA_NAME}" TO "lis_app"`,
      ),
    );
    await migrationDb.execute(
      sql.raw(`
        ALTER TABLE "${SCHEMA_NAME}"."audit_event" ENABLE ROW LEVEL SECURITY
      `),
    );
    await migrationDb.execute(
      sql.raw(`
        DO $$ BEGIN
          CREATE POLICY tenant_isolation ON "${SCHEMA_NAME}"."audit_event"
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `),
    );

    const dedicatedOrderedTestId = randomUUID();
    await migrationDb.execute(
      sql.raw(`
        INSERT INTO "${SCHEMA_NAME}"."observation"
          (tenant_id, ordered_test_id, analyte_id, value_code, status, verified_at)
        VALUES
          ('${TENANT_DEDICATED}', '${dedicatedOrderedTestId}', '${am1AnalyteId}', 'S', 'verified', '${VERIFIED_AT.toISOString()}'),
          ('${TENANT_DEDICATED}', '${dedicatedOrderedTestId}', '${am1AnalyteId}', 'R', 'verified', '${VERIFIED_AT.toISOString()}'),
          ('${TENANT_DEDICATED}', '${dedicatedOrderedTestId}', '${am1AnalyteId}', 'R', 'verified', '${VERIFIED_AT.toISOString()}')
      `),
    );
    const organismIdentifiedAnalyteRow = await migrationDb
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
      )
      .limit(1);
    await migrationDb.execute(
      sql.raw(`
        INSERT INTO "${SCHEMA_NAME}"."observation"
          (tenant_id, ordered_test_id, analyte_id, value_code, status)
        VALUES
          ('${TENANT_DEDICATED}', '${dedicatedOrderedTestId}', '${organismIdentifiedAnalyteRow[0].id}', '${organismCsvCode}', 'verified')
      `),
    );
  });

  afterAll(async () => {
    await app.close();

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_SHARED}, false)`,
    );
    await db.delete(observation).where(eq(observation.tenantId, TENANT_SHARED));
    await db.delete(orderedTest).where(eq(orderedTest.tenantId, TENANT_SHARED));
    await db.delete(order).where(eq(order.tenantId, TENANT_SHARED));
    await db.delete(patient).where(eq(patient.tenantId, TENANT_SHARED));
    await db
      .delete(testDefinition)
      .where(eq(testDefinition.tenantId, TENANT_SHARED));

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_NOT_OPTED_IN}, false)`,
    );
    await db
      .delete(observation)
      .where(eq(observation.tenantId, TENANT_NOT_OPTED_IN));
    await db
      .delete(orderedTest)
      .where(eq(orderedTest.tenantId, TENANT_NOT_OPTED_IN));
    await db.delete(order).where(eq(order.tenantId, TENANT_NOT_OPTED_IN));
    await db.delete(patient).where(eq(patient.tenantId, TENANT_NOT_OPTED_IN));
    await db
      .delete(testDefinition)
      .where(eq(testDefinition.tenantId, TENANT_NOT_OPTED_IN));

    await migrationDb
      .delete(tenant)
      .where(
        inArray(tenant.id, [
          TENANT_SHARED,
          TENANT_DEDICATED,
          TENANT_NOT_OPTED_IN,
        ]),
      );
    await migrationDb.execute(
      sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA_NAME}" CASCADE`),
    );

    await migrationDb
      .delete(antimicrobial)
      .where(inArray(antimicrobial.id, [am1Id, am2Id]));
    await migrationDb
      .delete(analyte)
      .where(inArray(analyte.id, [am1AnalyteId, am2AnalyteId]));
    await migrationDb
      .delete(organism)
      .where(eq(organism.codeSystemValueId, organismCsvId));
    await migrationDb
      .delete(codeSystemValue)
      .where(inArray(codeSystemValue.id, [organismCsvId, am1CsvId, am2CsvId]));
  });

  it('rejects a non-platform-analytics token (403)', async () => {
    await request(app.getHttpServer())
      .get('/v1/reports/network-amr-surveillance')
      .set('Authorization', `Bearer ${qaToken}`)
      .query({ month: MONTH })
      .expect(403);
  });

  it('rejects a malformed month (400)', async () => {
    await request(app.getHttpServer())
      .get('/v1/reports/network-amr-surveillance')
      .set('Authorization', `Bearer ${platformAnalyticsToken}`)
      .query({ month: '2025-06-15' })
      .expect(400);
  });

  it('correctly merges a shared-tier and a dedicated_schema-tier tenant into one real total, excludes an opted-out tenant entirely, suppresses any cell below n=5, and leaks no tenant/facility identifier', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/reports/network-amr-surveillance')
      .set('Authorization', `Bearer ${platformAnalyticsToken}`)
      .query({ month: MONTH })
      .expect(200);
    const body = res.body as {
      entries: Record<string, unknown>[];
    };

    const am1Entry = body.entries.find(
      (e) => e.antimicrobialDisplay === 'Synthetic Antimicrobial ONE',
    );
    expect(am1Entry).toBeDefined();
    // 2S+1R (TENANT_SHARED) + 1S+2R (TENANT_DEDICATED) = 3S+3R = 6 -- only
    // correct if both tiers were genuinely read and merged, and the opted-
    // out tenant's own 10 extra R results were correctly excluded (would
    // otherwise be 16).
    expect(am1Entry).toMatchObject({
      organismDisplay: 'Synthetic Organism',
      timeBucket: MONTH,
      suppressed: false,
      susceptibleCount: 3,
      intermediateCount: 0,
      resistantCount: 3,
      totalCount: 6,
    });
    expect(Object.keys(am1Entry!).sort()).toEqual(
      [
        'antimicrobialDisplay',
        'intermediateCount',
        'organismDisplay',
        'resistantCount',
        'suppressed',
        'susceptibleCount',
        'timeBucket',
        'totalCount',
      ].sort(),
    );

    const am2Entry = body.entries.find(
      (e) => e.antimicrobialDisplay === 'Synthetic Antimicrobial TWO',
    );
    expect(am2Entry).toBeDefined();
    expect(am2Entry).toMatchObject({
      suppressed: true,
      susceptibleCount: null,
      intermediateCount: null,
      resistantCount: null,
      totalCount: null,
    });
  });

  it('audits which tenants contributed -- one real audit_event row per contributing tenant (shared and dedicated_schema alike), none for the opted-out tenant', async () => {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_SHARED}, false)`,
    );
    const sharedAudit = await db.execute(
      sql`SELECT actor_role, resource_type FROM audit_event WHERE tenant_id = ${TENANT_SHARED} AND action = 'network_amr_surveillance.contributed'`,
    );
    expect(sharedAudit.rows.length).toBeGreaterThanOrEqual(1);
    expect(sharedAudit.rows[0]).toMatchObject({
      actor_role: 'platform-analytics',
      resource_type: 'amr_surveillance_report',
    });

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_NOT_OPTED_IN}, false)`,
    );
    const notOptedInAudit = await db.execute(
      sql`SELECT id FROM audit_event WHERE tenant_id = ${TENANT_NOT_OPTED_IN} AND action = 'network_amr_surveillance.contributed'`,
    );
    expect(notOptedInAudit.rows).toHaveLength(0);

    await migrationDb.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_DEDICATED}, false)`,
    );
    const dedicatedAudit = await migrationDb.execute(
      sql.raw(
        `SELECT actor_role FROM "${SCHEMA_NAME}".audit_event WHERE tenant_id = '${TENANT_DEDICATED}' AND action = 'network_amr_surveillance.contributed'`,
      ),
    );
    expect(dedicatedAudit.rows.length).toBeGreaterThanOrEqual(1);
  });
});
