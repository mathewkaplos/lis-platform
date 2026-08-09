import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'fs/promises';
import { createServer, type Server } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ForwarderService } from '../src/forward/forwarder.service';

/**
 * FEAT-026's own acceptance criteria (issue #35), proven against a real
 * running gateway app and a real Keycloak client-credentials grant (only
 * the cloud-core *receiver* is a controllable stub here, standing in for
 * apps/api's internal ingestion endpoint -- that endpoint's own real
 * behavior, including dedupe against a real Postgres-free in-memory store,
 * is proven separately by apps/api's gateway-ingest.e2e-spec.ts):
 *
 * - A simulated network interruption causes buffering, not drops.
 * - On reconnection, the queue drains, and nothing is resent once forwarded.
 */
describe('Gateway store-and-forward survives a network interruption (e2e)', () => {
  let app: INestApplication<App>;
  let forwarder: ForwarderService;
  let queueDir: string;
  let receiver: Server | null = null;
  let receivedKeys: string[] = [];

  beforeAll(async () => {
    queueDir = await mkdtemp(join(tmpdir(), 'gateway-e2e-queue-'));
    process.env.GATEWAY_QUEUE_DIR = queueDir;
    process.env.GATEWAY_FORWARD_AUTOSTART = 'false';
    process.env.KEYCLOAK_ISSUER_URL =
      process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/lis';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    forwarder = app.get(ForwarderService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(queueDir, { recursive: true, force: true });
  });

  function startReceiver(): Promise<void> {
    receivedKeys = [];
    return new Promise((resolve) => {
      receiver = createServer((req, res) => {
        receivedKeys.push(String(req.headers['idempotency-key']));
        res.writeHead(202);
        res.end();
      });
      receiver.listen(0, '127.0.0.1', () => {
        const addr = receiver!.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        process.env.GATEWAY_FORWARD_URL = `http://127.0.0.1:${port}/internal/gateway/ingest`;
        resolve();
      });
    });
  }

  function stopReceiver(): Promise<void> {
    return new Promise((resolve) => {
      if (!receiver) {
        resolve();
        return;
      }
      const s = receiver;
      receiver = null;
      s.close(() => resolve());
    });
  }

  afterEach(async () => {
    await stopReceiver();
  });

  it('buffers ingested results while the cloud core is unreachable, then drains them exactly once on reconnect', async () => {
    // Cloud core unreachable for the whole ingest phase.
    process.env.GATEWAY_FORWARD_URL = 'http://127.0.0.1:1/internal/gateway/ingest';

    const payloads = [1, 2, 3].map((n) => ({
      instrumentId: 'ANALYZER-E2E',
      specimenId: `SPEC-${n}`,
      analyte: 'GLU',
      runId: `RUN-${n}`,
      value: 5,
      rawPayload: `raw-${n}`,
    }));

    for (const p of payloads) {
      await request(app.getHttpServer()).post('/ingest').send(p).expect(202);
    }

    // Draining during the outage must not lose items or throw.
    const duringOutage = await forwarder.drain();
    expect(duringOutage.forwarded).toBe(0);
    expect(duringOutage.remaining).toBe(3);

    // Reconnect.
    await startReceiver();

    const afterReconnect = await forwarder.drain();
    expect(afterReconnect.forwarded).toBe(3);
    expect(afterReconnect.remaining).toBe(0);
    expect([...receivedKeys].sort()).toEqual(
      [1, 2, 3].map((n) => `ANALYZER-E2E:SPEC-${n}:GLU:RUN-${n}`).sort(),
    );

    // A later drain tick (simulating the interval firing again) must not
    // resend anything -- the queue is already empty.
    const secondDrain = await forwarder.drain();
    expect(secondDrain.forwarded).toBe(0);
    expect(receivedKeys.length).toBe(3);
  }, 15_000);
});
