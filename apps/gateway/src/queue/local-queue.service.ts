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
  private readonly baseDir =
    process.env.GATEWAY_QUEUE_DIR ?? join(process.cwd(), 'data', 'queue');
  private readonly pendingDir = join(this.baseDir, 'pending');
  // Issue #820: a non-retryable per-item failure (e.g. a 422 unmatched-
  // specimen/mapping correlation failure) moves here instead of being
  // removed -- KB-29's "park, never drop" applied literally: the payload
  // is preserved for later review, not deleted, and moving it out of
  // `pending/` is what lets ForwarderService.drain() continue past it
  // instead of retrying it forever.
  private readonly parkedDir = join(this.baseDir, 'parked');

  // Issue #433: Date.now() alone has only millisecond resolution, so two
  // enqueue() calls landing in the same millisecond (real, reproduced --
  // not hypothetical, both on a real CI run and locally) sorted by their
  // random UUID suffix instead of call order, breaking the queue's own
  // FIFO guarantee. A monotonic in-process counter, zero-padded so it
  // still sorts lexically, fixes this without needing sub-millisecond
  // clock resolution -- resets on restart, which is fine: this only needs
  // to hold within one gateway process's own lifetime, matching how the
  // file-based directory listing itself is already scoped.
  private sequence = 0;

  async onModuleInit() {
    await mkdir(this.pendingDir, { recursive: true });
    await mkdir(this.parkedDir, { recursive: true });
  }

  async enqueue<T>(payload: T): Promise<string> {
    await mkdir(this.pendingDir, { recursive: true });
    const seq = (this.sequence++).toString().padStart(6, '0');
    const id = `${Date.now().toString().padStart(15, '0')}-${seq}-${randomUUID()}`;
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
    return this.listDir<T>(this.pendingDir);
  }

  async listParked<T>(): Promise<QueuedItem<T>[]> {
    return this.listDir<T>(this.parkedDir);
  }

  private async listDir<T>(dir: string): Promise<QueuedItem<T>[]> {
    await mkdir(dir, { recursive: true });
    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .sort();
    const items: QueuedItem<T>[] = [];
    for (const file of files) {
      const raw = await readFile(join(dir, file), 'utf8');
      items.push(JSON.parse(raw) as QueuedItem<T>);
    }
    return items;
  }

  async remove(id: string): Promise<void> {
    await rm(join(this.pendingDir, `${id}.json`), { force: true });
  }

  /** Moves a pending item to `parked/` instead of deleting it (issue #820)
   * -- a no-op, not an error, if the item is already gone (mirrors
   * remove()'s force-remove semantics). */
  async park(id: string): Promise<void> {
    await mkdir(this.parkedDir, { recursive: true });
    try {
      await rename(
        join(this.pendingDir, `${id}.json`),
        join(this.parkedDir, `${id}.json`),
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async size(): Promise<number> {
    await mkdir(this.pendingDir, { recursive: true });
    return (await readdir(this.pendingDir)).filter((f) => f.endsWith('.json'))
      .length;
  }

  async parkedSize(): Promise<number> {
    await mkdir(this.parkedDir, { recursive: true });
    return (await readdir(this.parkedDir)).filter((f) => f.endsWith('.json'))
      .length;
  }
}
