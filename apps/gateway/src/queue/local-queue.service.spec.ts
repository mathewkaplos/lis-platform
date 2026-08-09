import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalQueueService } from './local-queue.service';

describe('LocalQueueService', () => {
  let dir: string;
  let queue: LocalQueueService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gateway-queue-'));
    process.env.GATEWAY_QUEUE_DIR = dir;
    queue = new LocalQueueService();
    await queue.onModuleInit();
  });

  afterEach(async () => {
    delete process.env.GATEWAY_QUEUE_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    expect(await queue.size()).toBe(0);
    expect(await queue.listPending()).toEqual([]);
  });

  it('returns enqueued items in FIFO order', async () => {
    await queue.enqueue({ n: 1 });
    await queue.enqueue({ n: 2 });
    await queue.enqueue({ n: 3 });

    const items = await queue.listPending<{ n: number }>();
    expect(items.map((i) => i.payload.n)).toEqual([1, 2, 3]);
    expect(await queue.size()).toBe(3);
  });

  it('removes an item by id, leaving the rest in order', async () => {
    const id1 = await queue.enqueue({ n: 1 });
    await queue.enqueue({ n: 2 });

    await queue.remove(id1);

    const items = await queue.listPending<{ n: number }>();
    expect(items.map((i) => i.payload.n)).toEqual([2]);
    expect(await queue.size()).toBe(1);
  });

  it('removing a non-existent id is a no-op, not an error', async () => {
    await expect(queue.remove('does-not-exist')).resolves.toBeUndefined();
  });

  it('survives a fresh instance reading the same directory (durability across process restart)', async () => {
    await queue.enqueue({ n: 1 });
    await queue.enqueue({ n: 2 });

    const restarted = new LocalQueueService();
    await restarted.onModuleInit();
    const items = await restarted.listPending<{ n: number }>();
    expect(items.map((i) => i.payload.n)).toEqual([1, 2]);
  });
});
