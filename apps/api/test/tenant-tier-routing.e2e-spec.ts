import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { sql } from 'drizzle-orm';
import { createDb, tenant } from '@lis/db';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * FEAT-045 (ADR-0039): proves tier-2 (dedicated_schema) routing through the
 * live API, the same standard TASK-030/ADR-0010's tenant-context.e2e-spec.ts
 * already set for tier-1 binding. Reuses the existing `/auth/tenant-audit-
 * count` verification-only route (TASK-030) rather than adding a new one --
 * it already queries the one tenant-scoped table this suite needs
 * (`audit_event`) inside the interceptor's own transaction.
 *
 * `test-user-dedicated` (infra/keycloak/lis-realm.json) is a brand-new
 * Keycloak user carrying a tenant_id (...d1) not used by any other e2e
 * spec -- reassigning an existing fixture tenant (test-user/test-user-2/
 * test-user-6) to a dedicated schema would have silently broken every other
 * suite that assumes those tenants stay on the shared tier.
 */
describe('Tenant tier routing (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  const DEDICATED_TENANT = '00000000-0000-0000-0000-0000000000d1';
  const SCHEMA_NAME = 'tenant_tier_routing_e2e';

  const migrationDb = createDb(process.env.DATABASE_URL);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    token = await getKeycloakToken(
      'test-user-dedicated',
      'test-password-dedicated',
    );

    // Provisioned as the migrations role, exactly as a real dedicated-schema
    // tenant's onboarding would have to be (`lis_app` has no CREATE
    // privilege on the database -- confirmed live via
    // tenant-isolation-check.ts). Minimal audit_event clone: only the
    // columns `/auth/tenant-audit-count`'s COUNT(*) query needs.
    await migrationDb.execute(
      sql.raw(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA_NAME}"`),
    );
    await migrationDb.execute(
      sql.raw(`GRANT USAGE ON SCHEMA "${SCHEMA_NAME}" TO "lis_app"`),
    );
    await migrationDb.execute(
      sql.raw(`
        CREATE TABLE IF NOT EXISTS "${SCHEMA_NAME}"."audit_event" (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL
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
        `ALTER TABLE "${SCHEMA_NAME}"."audit_event" ENABLE ROW LEVEL SECURITY`,
      ),
    );
    await migrationDb.execute(
      sql.raw(`
        DO $$ BEGIN
          CREATE POLICY tenant_isolation ON "${SCHEMA_NAME}"."audit_event"
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
        EXCEPTION WHEN duplicate_object THEN NULL; END $$
      `),
    );
    // Two rows, inserted directly (not via the app) -- this suite is
    // proving routing, not the audit writer itself. DEDICATED_TENANT is a
    // fixed literal this file controls, not external input.
    await migrationDb.execute(
      sql.raw(
        `INSERT INTO "${SCHEMA_NAME}"."audit_event" (tenant_id) VALUES ('${DEDICATED_TENANT}'), ('${DEDICATED_TENANT}')`,
      ),
    );
  });

  afterAll(async () => {
    await migrationDb
      .delete(tenant)
      .where(sql`${tenant.id} = ${DEDICATED_TENANT}`);
    await migrationDb.execute(
      sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA_NAME}" CASCADE`),
    );
    await app.close();
  });

  it('routes an unregistered tenant to the shared/public schema, unchanged (regression)', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as { tenantId: string; count: number };
    if (body.tenantId !== DEDICATED_TENANT) {
      throw new Error(
        `expected ${DEDICATED_TENANT}, got ${JSON.stringify(res.body)}`,
      );
    }
    // No `tenant` row exists yet for this tenant -- resolveTenantRouting
    // defaults to shared, so this must land in public.audit_event, which has
    // no rows for a tenant_id no other fixture has ever used.
    if (body.count !== 0) {
      throw new Error(
        `expected 0 rows in public.audit_event before any tenant row is registered, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it(
    'routes a dedicated_schema tenant into its own schema, without any application code change ' +
      '(FEAT-045 AC)',
    async () => {
      await migrationDb.insert(tenant).values({
        id: DEDICATED_TENANT,
        name: 'e2e-dedicated-tenant',
        isolationTier: 'dedicated_schema',
        schemaName: SCHEMA_NAME,
      });

      const res = await request(app.getHttpServer())
        .get('/auth/tenant-audit-count')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as { tenantId: string; count: number };
      if (body.tenantId !== DEDICATED_TENANT) {
        throw new Error(
          `expected ${DEDICATED_TENANT}, got ${JSON.stringify(res.body)}`,
        );
      }
      // The two rows live only in the dedicated schema's audit_event, never
      // public's -- a count of 2 here is only possible if search_path was
      // actually bound to the dedicated schema for this request.
      if (body.count !== 2) {
        throw new Error(
          `expected 2 rows from the dedicated schema, got ${JSON.stringify(res.body)} -- routing did not reach the dedicated schema`,
        );
      }
    },
  );
});
