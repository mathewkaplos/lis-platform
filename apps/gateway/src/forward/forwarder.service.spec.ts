import { RawResult } from '../ingest/ingest.schema';
import { LocalQueueService, QueuedItem } from '../queue/local-queue.service';
import { ForwarderService } from './forwarder.service';
import { GatewayAuthService } from './gateway-auth.service';

function item(n: number): QueuedItem<RawResult> {
  return {
    id: `id-${n}`,
    enqueuedAt: new Date().toISOString(),
    payload: {
      instrumentId: 'ANALYZER-1',
      specimenId: `SPEC-${n}`,
      analyte: 'GLU',
      runId: `RUN-${n}`,
      value: 5,
      rawPayload: 'raw',
    },
  };
}

describe('ForwarderService.drain', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GATEWAY_FORWARD_AUTOSTART = 'false';
  });

  it('forwards every pending item and removes it from the queue on success', async () => {
    process.env.GATEWAY_FORWARD_AUTOSTART = 'false';
    const items = [item(1), item(2)];
    const removed: string[] = [];
    const queue = {
      listPending: () => Promise.resolve(items),
      remove: (id: string) => {
        removed.push(id);
        return Promise.resolve();
      },
      size: () => Promise.resolve(items.length - removed.length),
    } as unknown as LocalQueueService;
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as GatewayAuthService;

    global.fetch = () => Promise.resolve(new Response(null, { status: 202 }));

    const forwarder = new ForwarderService(queue, auth);
    forwarder.onModuleInit();
    const result = await forwarder.drain();

    expect(result.forwarded).toBe(2);
    expect(removed).toEqual(['id-1', 'id-2']);
    forwarder.onModuleDestroy();
  });

  it('stops at the first failure and leaves that item (and everything after it) queued', async () => {
    process.env.GATEWAY_FORWARD_AUTOSTART = 'false';
    const items = [item(1), item(2), item(3)];
    const removed: string[] = [];
    const queue = {
      listPending: () => Promise.resolve(items),
      remove: (id: string) => {
        removed.push(id);
        return Promise.resolve();
      },
      size: () => Promise.resolve(items.length - removed.length),
    } as unknown as LocalQueueService;
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as GatewayAuthService;

    let call = 0;
    global.fetch = () => {
      call++;
      if (call === 2) {
        return Promise.reject(new Error('network unreachable'));
      }
      return Promise.resolve(new Response(null, { status: 202 }));
    };

    const forwarder = new ForwarderService(queue, auth);
    const result = await forwarder.drain();

    expect(result.forwarded).toBe(1);
    expect(removed).toEqual(['id-1']);
  });

  it('invalidates the cached token and leaves the item queued on a 401', async () => {
    process.env.GATEWAY_FORWARD_AUTOSTART = 'false';
    const items = [item(1)];
    const removed: string[] = [];
    const queue = {
      listPending: () => Promise.resolve(items),
      remove: (id: string) => {
        removed.push(id);
        return Promise.resolve();
      },
      size: () => Promise.resolve(items.length - removed.length),
    } as unknown as LocalQueueService;
    let invalidated = false;
    const auth = {
      getToken: () => Promise.resolve('stale-token'),
      invalidate: () => {
        invalidated = true;
      },
    } as unknown as GatewayAuthService;

    global.fetch = () => Promise.resolve(new Response(null, { status: 401 }));

    const forwarder = new ForwarderService(queue, auth);
    const result = await forwarder.drain();

    expect(result.forwarded).toBe(0);
    expect(removed).toEqual([]);
    expect(invalidated).toBe(true);
  });

  // Issue #820: a 422 (non-retryable correlation failure -- unmatched
  // specimen or mapping) must not permanently block every other item
  // queued behind it the way a genuine retryable failure correctly does.
  it('parks a 422 item and continues draining the rest of the batch', async () => {
    process.env.GATEWAY_FORWARD_AUTOSTART = 'false';
    const items = [item(1), item(2), item(3)];
    const removed: string[] = [];
    const parked: string[] = [];
    const queue = {
      listPending: () => Promise.resolve(items),
      remove: (id: string) => {
        removed.push(id);
        return Promise.resolve();
      },
      park: (id: string) => {
        parked.push(id);
        return Promise.resolve();
      },
      size: () => Promise.resolve(items.length - removed.length - parked.length),
    } as unknown as LocalQueueService;
    const auth = {
      getToken: () => Promise.resolve('test-token'),
      invalidate: () => {},
    } as unknown as GatewayAuthService;

    global.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        runId?: string;
      };
      const status = body.runId === 'RUN-2' ? 422 : 202;
      return Promise.resolve(new Response(null, { status }));
    };

    const forwarder = new ForwarderService(queue, auth);
    const result = await forwarder.drain();

    expect(result.forwarded).toBe(2);
    expect(result.parked).toBe(1);
    expect(removed).toEqual(['id-1', 'id-3']);
    expect(parked).toEqual(['id-2']);
  });
});
