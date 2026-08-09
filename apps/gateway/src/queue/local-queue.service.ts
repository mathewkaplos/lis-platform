import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';

export interface QueuedItem<T = unknown> {
  id: string;
  enqueuedAt: string;
  payload: T;
}

/**
 * File-backed durable queue -- KB-29's "store-and-forward queue." Each
 * pending item is one JSON file under `<dir>/pending`, named so lexical sort
 * order matches enqueue (FIFO) order. Writes go to a `.tmp` file first, then
 * an atomic rename, so a crash mid-write never leaves a half-written file
 * for the forwarder to read.
 *
 * Deliberately dependency-free (no sqlite/redis): the durability
 * requirement this phase needs is "survives a network interruption," which
 * plain files on disk satisfy without adding a storage dependency to a
 * service meant to run on constrained, edge-deployed hardware.
 */
@Injectable()
export class LocalQueueService implements OnModuleInit {
  private readonly pendingDir = join(
    process.env.GATEWAY_QUEUE_DIR ?? join(process.cwd(), 'data', 'queue'),
    'pending',
  );

  async onModuleInit() {
    await mkdir(this.pendingDir, { recursive: true });
  }

  async enqueue<T>(payload: T): Promise<string> {
    await mkdir(this.pendingDir, { recursive: true });
    const id = `${Date.now().toString().padStart(15, '0')}-${randomUUID()}`;
    const item: QueuedItem<T> = {
      id,
      enqueuedAt: new Date().toISOString(),
      payload,
    };
    const finalPath = join(this.pendingDir, `${id}.json`);
    const tmpPath = `${finalPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(item), 'utf8');
    await rename(tmpPath, finalPath);
    return id;
  }

  async listPending<T>(): Promise<QueuedItem<T>[]> {
    await mkdir(this.pendingDir, { recursive: true });
    const files = (await readdir(this.pendingDir))
      .filter((f) => f.endsWith('.json'))
      .sort();
    const items: QueuedItem<T>[] = [];
    for (const file of files) {
      const raw = await readFile(join(this.pendingDir, file), 'utf8');
      items.push(JSON.parse(raw) as QueuedItem<T>);
    }
    return items;
  }

  async remove(id: string): Promise<void> {
    await rm(join(this.pendingDir, `${id}.json`), { force: true });
  }

  async size(): Promise<number> {
    await mkdir(this.pendingDir, { recursive: true });
    return (await readdir(this.pendingDir)).filter((f) => f.endsWith('.json'))
      .length;
  }
}
