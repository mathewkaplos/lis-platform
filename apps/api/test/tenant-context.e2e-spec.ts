import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { KEYCLOAK_ISSUER_URL } from './../src/auth/keycloak-config';

/**
 * TASK-030/ADR-0010: proves the RLS tenant-binding mechanism through the
 * live API, not just in SQL — the literal TASK-030 AC. Real Keycloak, real
 * Postgres, two real tenants (test-user / TENANT_A, test-user-2 / TENANT_B
 * — same TENANT_B convention rls-isolation-check.ts already established).
 *
 * DB_POOL_MAX=1 (see package.json's test:e2e script) deliberately forces
 * every request in this suite through the same one physical connection —
 * required for the pooling-leak test below to actually exercise connection
 * reuse across tenants, not just pass by accident with a large default pool.
 */
async function getToken(username: string, password: string): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'lis-web',
        username,
        password,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `failed to obtain a token for ${username}: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

describe('Tenant context binding (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenB] = await Promise.all([
      getToken('test-user', 'test-password'),
      getToken('test-user-2', 'test-password-2'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves the correct tenant through the live API (TASK-030 AC)', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as { tenantId: string; count: number };
    if (body.tenantId !== '00000000-0000-0000-0000-000000000001') {
      throw new Error(`expected TENANT_A, got ${JSON.stringify(res.body)}`);
    }
    if (typeof body.count !== 'number') {
      throw new Error(
        `expected a numeric count, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it(
    'pooling leak test (ADR-0010): sequential requests from two tenants ' +
      "sharing one physical connection never see each other's data",
    async () => {
      // Interleaved deliberately (A, B, A, B) rather than A-then-B once —
      // a single reused connection under DB_POOL_MAX=1 makes this a real
      // test of SET LOCAL's transaction-scoped clearing, not a coincidence.
      for (let i = 0; i < 2; i++) {
        const resA = await request(app.getHttpServer())
          .get('/auth/tenant-audit-count')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        const bodyA = resA.body as { tenantId: string };
        if (bodyA.tenantId !== '00000000-0000-0000-0000-000000000001') {
          throw new Error(
            `iteration ${i}: tenant A's request resolved the wrong tenant: ${JSON.stringify(resA.body)}`,
          );
        }

        const resB = await request(app.getHttpServer())
          .get('/auth/tenant-audit-count')
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(200);
        const bodyB = resB.body as { tenantId: string };
        if (bodyB.tenantId !== '00000000-0000-0000-0000-000000000002') {
          throw new Error(
            `iteration ${i}: tenant B's request resolved the wrong tenant (leaked from A): ${JSON.stringify(resB.body)}`,
          );
        }
      }
    },
  );

  it(
    'fail-closed test (ADR-0010): a tenant-scoped query reached without ' +
      'SET LOCAL having run errors, never returns a plausible-looking result',
    async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/tenant-audit-count-unbound')
        .set('Authorization', `Bearer ${tokenA}`);
      if (res.status < 500) {
        throw new Error(
          `expected the unbound route to fail (no app.tenant_id ever set on ` +
            `this connection), got ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
    },
  );
});
