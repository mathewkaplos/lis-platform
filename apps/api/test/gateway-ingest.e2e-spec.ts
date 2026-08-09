import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getGatewayToken } from './get-gateway-token';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * FEAT-026/ADR-0026: proves the internal ingestion endpoint accepts a real
 * gateway-issued (client-credentials) token, rejects a human token (the
 * `gateway_ingest` capability is granted only to the `gateway-ingest` role
 * — same fail-closed model as every other capability, ADR-0011), and dedupes
 * on the shared idempotency key so a forwarder retry never double-counts.
 */
describe('Gateway ingest (e2e)', () => {
  let app: INestApplication<App>;
  let gatewayToken: string;
  let humanToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [gatewayToken, humanToken] = await Promise.all([
      getGatewayToken(),
      getKeycloakToken('test-user', 'test-password'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  function rawResult(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      instrumentId: 'ANALYZER-1',
      specimenId: 'SPEC-e2e-1',
      analyte: 'GLU',
      runId: 'RUN-e2e-1',
      value: 5.4,
      unit: 'mmol/L',
      flag: 'N',
      rawPayload: 'H|\\^&|||ANALYZER-1|...',
      ...overrides,
    };
  }

  it('rejects a request with no token — 401', () => {
    return request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .send(rawResult())
      .expect(401);
  });

  it('rejects a real human token — 403 (gateway_ingest is machine-only, ADR-0026)', () => {
    return request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${humanToken}`)
      .send(rawResult())
      .expect(403);
  });

  it('accepts a real gateway client-credentials token — 202', async () => {
    const res = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(rawResult({ runId: 'RUN-e2e-accept' }))
      .expect(202);

    const body = res.body as { duplicate: boolean; idempotencyKey: string };
    expect(body.duplicate).toBe(false);
    expect(body.idempotencyKey).toBe(
      'ANALYZER-1:SPEC-e2e-1:GLU:RUN-e2e-accept',
    );
  });

  it('flags a replay of the same idempotency key as a duplicate, not an error', async () => {
    const payload = rawResult({ runId: 'RUN-e2e-dedupe' });

    const first = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(payload)
      .expect(202);
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

    const replay = await request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(payload)
      .expect(202);
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it('rejects a payload missing rawPayload — 400 (KB-29: raw retention is mandatory)', () => {
    const withoutRawPayload: Record<string, unknown> = rawResult();
    delete withoutRawPayload.rawPayload;
    return request(app.getHttpServer())
      .post('/internal/gateway/ingest')
      .set('Authorization', `Bearer ${gatewayToken}`)
      .send(withoutRawPayload)
      .expect(400);
  });
});
