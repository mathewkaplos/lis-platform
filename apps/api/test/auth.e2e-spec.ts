import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

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
    const token = await getKeycloakToken('test-user', 'test-password');

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
