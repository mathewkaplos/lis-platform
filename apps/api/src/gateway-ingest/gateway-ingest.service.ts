import { Injectable } from '@nestjs/common';

/**
 * In-memory idempotency-key dedupe for the gateway ingestion endpoint.
 *
 * Deliberately not persisted: this phase (FEAT-026) does not write any
 * Observation or other tenant-scoped row, so there is nothing yet that a
 * durable dedupe table would be protecting — see the FEAT-026 proposal §5.
 * Once FEAT-027 wires this endpoint into the real result pipeline, dedupe
 * moves onto (or alongside) whatever persistent write path that feature
 * adds; an api restart resetting this in-memory set is an accepted,
 * temporary gap for this phase only, not a decision this class makes
 * permanent.
 *
 * Bounded (not an unbounded-growth memory leak over a long-running
 * process): oldest keys are evicted once the cap is reached, using a Map's
 * insertion-order iteration.
 */
@Injectable()
export class GatewayIngestService {
  private readonly maxKeys = 10_000;
  private readonly seen = new Map<string, true>();

  isDuplicate(key: string): boolean {
    return this.seen.has(key);
  }

  record(key: string): void {
    if (this.seen.has(key)) {
      return;
    }
    if (this.seen.size >= this.maxKeys) {
      const [oldest] = this.seen.keys();
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
    this.seen.set(key, true);
  }
}
