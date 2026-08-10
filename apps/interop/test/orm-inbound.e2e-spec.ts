import { Client, Message } from 'node-hl7-client';
import { InteropAuthService } from '../src/auth/interop-auth.service';
import { OrmInboundService } from '../src/hl7/orm-inbound.service';

const TEST_PORT = 43011;

function ormText(overrides: { pid3?: string; obr4?: string } = {}): string {
  const pid3 = overrides.pid3 ?? 'MRN12345^^^HOSP^MR';
  const obr4 = overrides.obr4 ?? 'GLU^Glucose^L';
  return [
    'MSH|^~\\&|EHR|HOSP|LIS|LAB|20260810120000||ORM^O01|MSG00001|P|2.5',
    `PID|1||${pid3}||DOE^JANE^A||19800101|F`,
    'ORC|NW',
    `OBR|1|||${obr4}`,
  ].join('\r');
}

function sendAndAwaitAck(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Client({ host: '127.0.0.1', version: '2.5' });
    const conn = client.createConnection(
      { port: TEST_PORT, version: '2.5' },
      (res) => {
        resolve(res.getMessage().get('MSA.1').toString());
        client.closeAll();
      },
    );
    conn
      .sendMessage(new Message({ text }))
      .catch((err: unknown) => reject(err as Error));
  });
}

/**
 * FEAT-036 (§10 Q2): proves the real `node-hl7-server`/`node-hl7-client`
 * transport end-to-end -- a real MLLP client sends a real ORM^O01 over a
 * real TCP socket, `OrmInboundService` parses it with the real library and
 * calls (a mocked) `apps/api`, and the real HL7 ACK code (AA/AR/AE) comes
 * back through the same real socket. `apps/api` itself is mocked at
 * `global.fetch` -- its own real pipeline is already proven end-to-end by
 * `apps/api/test/interop-order.e2e-spec.ts`; this test's job is the
 * interop-side wiring (transport + parsing + ACK mapping), not re-proving
 * apps/api's correlation logic a second time.
 */
describe('OrmInboundService (real MLLP transport)', () => {
  const originalFetch = global.fetch;
  let service: OrmInboundService;

  afterEach(async () => {
    global.fetch = originalFetch;
    await service?.onModuleDestroy();
  });

  it('returns AA when apps/api accepts the order (202)', async () => {
    global.fetch = () => Promise.resolve(new Response(null, { status: 202 }));
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as InteropAuthService;
    service = new OrmInboundService(auth);
    service.start(TEST_PORT, '2.5');

    const ack = await sendAndAwaitAck(ormText());
    expect(ack).toBe('AA');
  });

  it('returns AR when apps/api reports the order as unmatched (422)', async () => {
    global.fetch = () => Promise.resolve(new Response(null, { status: 422 }));
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as InteropAuthService;
    service = new OrmInboundService(auth);
    service.start(TEST_PORT, '2.5');

    const ack = await sendAndAwaitAck(ormText());
    expect(ack).toBe('AR');
  });

  it('returns AE when the inbound message is missing a required field (malformed, not unmatched)', async () => {
    global.fetch = () =>
      Promise.reject(
        new Error('fetch should not be called for a malformed message'),
      );
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as InteropAuthService;
    service = new OrmInboundService(auth);
    service.start(TEST_PORT, '2.5');

    const ack = await sendAndAwaitAck(ormText({ obr4: '' }));
    expect(ack).toBe('AE');
  });

  it('returns AE and invalidates the cached token on a 401 from apps/api', async () => {
    global.fetch = () => Promise.resolve(new Response(null, { status: 401 }));
    let invalidated = false;
    const auth = {
      getToken: () => Promise.resolve('stale-token'),
      invalidate: () => {
        invalidated = true;
      },
    } as unknown as InteropAuthService;
    service = new OrmInboundService(auth);
    service.start(TEST_PORT, '2.5');

    const ack = await sendAndAwaitAck(ormText());
    expect(ack).toBe('AE');
    expect(invalidated).toBe(true);
  });
});
