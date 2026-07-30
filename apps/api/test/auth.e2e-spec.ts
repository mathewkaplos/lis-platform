import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { KEYCLOAK_ISSUER_URL } from './../src/auth/keycloak-config';

/**
 * Real Keycloak, not a mocked JWKS — same "verify for real" standard as
 * rls-isolation-check.ts (real Postgres) and TASK-028's own manual
 * verification. Requires the local/CI Keycloak service (TASK-028) to be up
 * and the lis-realm.json test-user to exist.
 */
async function getTestUserToken(): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'lis-web',
        username: 'test-user',
        password: 'test-password',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `failed to obtain a test token from Keycloak: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

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

  it('rejects a request with no Authorization header — 401 (TASK-029 AC)', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('rejects a request with an invalid token — 401', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('resolves the correct tenant and user for a valid token (TASK-029 AC)', async () => {
    const token = await getTestUserToken();

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { sub: string; tenantId: string; roles: string[] };
    if (typeof body.sub !== 'string' || body.sub.length === 0) {
      throw new Error(`expected a sub claim, got ${JSON.stringify(res.body)}`);
    }
    if (body.tenantId !== '00000000-0000-0000-0000-000000000001') {
      throw new Error(
        `expected the seed tenant, got ${JSON.stringify(res.body)}`,
      );
    }
    if (!Array.isArray(body.roles)) {
      throw new Error(
        `expected roles to be an array, got ${JSON.stringify(res.body)}`,
      );
    }
  });
});
