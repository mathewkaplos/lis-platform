import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { sql } from 'drizzle-orm';
import { createDb } from '@lis/db';
import { AppModule } from './../src/app.module';
import { KEYCLOAK_ISSUER_URL } from '../src/auth/keycloak-config';

/**
 * FEAT-049 (ADR-0040): the real, live path a new lab self-onboards through.
 * Every assertion here is against real Postgres and real Keycloak, per this
 * repo's own established standard (`engineering/testing` entry #1) -- no
 * mocked Admin API, no mocked login.
 */
describe('Self-service onboarding (e2e)', () => {
  let app: INestApplication<App>;
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a real tenant, a real Keycloak user, and a seeded starter catalog', async () => {
    const uniqueEmail = `onboarding-e2e-${Date.now()}@example.invalid`;

    const res = await request(app.getHttpServer())
      .post('/onboarding/signup')
      .send({
        orgName: 'E2E Test Lab',
        adminFirstName: 'E2E',
        adminLastName: 'Admin',
        adminEmail: uniqueEmail,
        adminPassword: 'e2e-test-password-1',
      })
      .expect(201);

    const body = res.body as { tenantId: string; keycloakUserId: string };
    if (!body.tenantId || !body.keycloakUserId) {
      throw new Error(
        `expected tenantId + keycloakUserId, got ${JSON.stringify(res.body)}`,
      );
    }

    // The new admin can log in through the real, unmodified login flow, and
    // their token carries the correct tenant_id (ADR-0040's own
    // unmanagedAttributePolicy fix, exercised end-to-end here, not just at
    // the Keycloak-API layer).
    const tokenResponse = await fetch(
      `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'lis-web',
          username: uniqueEmail,
          password: 'e2e-test-password-1',
        }),
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(
        `new admin could not log in: ${tokenResponse.status} ${await tokenResponse.text()}`,
      );
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as {
      access_token: string;
    };
    const claims = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString(),
    ) as { tenant_id?: string; realm_access?: { roles?: string[] } };
    if (claims.tenant_id !== body.tenantId) {
      throw new Error(
        `expected tenant_id claim ${body.tenantId}, got ${claims.tenant_id}`,
      );
    }
    if (!claims.realm_access?.roles?.includes('lab_admin')) {
      throw new Error(
        `expected 'lab_admin' role on issued token, got ${JSON.stringify(claims.realm_access)}`,
      );
    }

    // The new tenant's own starter catalog was seeded -- proven with a real
    // tenant-bound query, not by reading code and assuming.
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${body.tenantId}, false)`,
    );
    const testDefCount = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM test_definition WHERE tenant_id = ${body.tenantId}`,
    );
    if (Number(testDefCount.rows[0]?.count ?? 0) === 0) {
      throw new Error(
        'expected a non-empty seeded starter catalog for the new tenant',
      );
    }

    // And it is invisible to a different tenant -- the same isolation
    // standard every other tenant-scoped table in this repo is held to.
    await db.execute(
      sql`SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000002', false)`,
    );
    const crossTenantCount = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM test_definition WHERE tenant_id = ${body.tenantId}`,
    );
    if (Number(crossTenantCount.rows[0]?.count ?? 0) !== 0) {
      throw new Error(
        "a different tenant session saw the new tenant's seeded catalog -- RLS LEAK",
      );
    }
  });

  it('rejects a second signup with the same email (409)', async () => {
    const uniqueEmail = `onboarding-e2e-dup-${Date.now()}@example.invalid`;
    const payload = {
      orgName: 'Dup Test Lab',
      adminFirstName: 'Dup',
      adminLastName: 'Admin',
      adminEmail: uniqueEmail,
      adminPassword: 'e2e-test-password-2',
    };

    await request(app.getHttpServer())
      .post('/onboarding/signup')
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/onboarding/signup')
      .send(payload)
      .expect(409);
  });

  it('rejects an invalid payload (400)', async () => {
    await request(app.getHttpServer())
      .post('/onboarding/signup')
      .send({ orgName: 'X', adminEmail: 'not-an-email' })
      .expect(400);
  });
});
