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
      listPending: async () => items,
      remove: async (id: string) => {
        removed.push(id);
      },
      size: async () => items.length - removed.length,
    } as unknown as LocalQueueService;
    const auth = {
      getToken: async () => 'test-token',
      invalidate: () => {},
    } as unknown as GatewayAuthService;

    global.fetch = (async () =>
      new Response(null, { status: 202 })) as typeof fetch;

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
      listPending: async () => items,
      remove: async (id: string) => {
        removed.push(id);
      },
      size: async () => items.length - removed.length,
    } as unknown as LocalQueueService;
    const auth = {
      getToken: async () => 'test-token',
      invalidate: () => {},
    } as unknown as GatewayAuthService;

    let call = 0;
    global.fetch = (async () => {
      call++;
      if (call === 2) {
        throw new Error('network unreachable');
      }
      return new Response(null, { status: 202 });
    }) as typeof fetch;

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
      listPending: async () => items,
      remove: async (id: string) => {
        removed.push(id);
      },
      size: async () => items.length - removed.length,
    } as unknown as LocalQueueService;
    let invalidated = false;
    const auth = {
      getToken: async () => 'stale-token',
      invalidate: () => {
        invalidated = true;
      },
    } as unknown as GatewayAuthService;

    global.fetch = (async () =>
      new Response(null, { status: 401 })) as typeof fetch;

    const forwarder = new ForwarderService(queue, auth);
    const result = await forwarder.drain();

    expect(result.forwarded).toBe(0);
    expect(removed).toEqual([]);
    expect(invalidated).toBe(true);
  });
});
