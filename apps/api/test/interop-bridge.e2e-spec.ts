import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getGatewayToken } from './get-gateway-token';
import { getInteropToken } from './get-interop-token';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * FEAT-036 skeleton (ADR-0034/ADR-0035): proves the `apps/interop` ->
 * `apps/api` auth bridge end-to-end before any real ORM/ORU translation
 * exists — a real `lis-interop` client-credentials token reaches
 * `/internal/interop/health`, and every other caller shape (no token, a
 * human token, a *different* machine's token) is rejected. Mirrors
 * `gateway-ingest.e2e-spec.ts`'s own auth-proof structure.
 */
describe('Interop bridge (e2e)', () => {
  let app: INestApplication<App>;
  let interopToken: string;
  let humanToken: string;
  let gatewayToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [interopToken, humanToken, gatewayToken] = await Promise.all([
      getInteropToken(),
      getKeycloakToken('test-user', 'test-password'),
      getGatewayToken(),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no token — 401', () => {
    return request(app.getHttpServer())
      .get('/internal/interop/health')
      .expect(401);
  });

  it('rejects a real human token — 403 (interop_ingest is machine-only, ADR-0035)', () => {
    return request(app.getHttpServer())
      .get('/internal/interop/health')
      .set('Authorization', `Bearer ${humanToken}`)
      .expect(403);
  });

  it('rejects a real gateway-issued token — 403 (no accidental overlap between machine callers)', () => {
    return request(app.getHttpServer())
      .get('/internal/interop/health')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .expect(403);
  });

  it('accepts a real interop-issued token — 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/internal/interop/health')
      .set('Authorization', `Bearer ${interopToken}`)
      .expect(200);
    expect((res.body as { status: string }).status).toBe('ok');
  });
});
