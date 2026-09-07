import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RawResult, idempotencyKey } from '../ingest/ingest.schema';
import { LocalQueueService, QueuedItem } from '../queue/local-queue.service';
import { GatewayAuthService } from './gateway-auth.service';

type ForwardOutcome = 'forwarded' | 'retry' | 'park';

/**
 * Drains the local queue to the cloud core's internal ingestion endpoint.
 * KB-29's reliability model: if the cloud core is unreachable, items stay
 * queued and are retried on the next tick -- a failed forward is never
 * fatal, it just means "try again next interval." Draining stops at the
 * first *retryable* failure in a tick (rather than skipping ahead) to
 * preserve arrival order and avoid hammering an unreachable core with the
 * rest of the batch.
 *
 * Issue #820: a *non-retryable* per-item failure (422 -- the internal
 * endpoint's own correlation logic determined this specific result can
 * never match a specimen/mapping, and retrying it changes nothing) used to
 * be treated identically to a retryable one, permanently blocking every
 * other item queued behind it -- one mislabeled specimen from any
 * instrument could silently stall an entire lab's worth of other
 * instruments' results. A 422 now parks that one item (LocalQueueService
 * .park -- moved to `parked/`, never deleted, per KB-29's "park, never
 * drop") and the drain continues past it. Every other non-2xx outcome
 * (network error, 401, 403, other 4xx, 5xx) still breaks the loop --
 * those genuinely may indicate a problem with the gateway/cloud-core link
 * itself, not just this one item, and silently parking every subsequent
 * item in that case would hide a systemic outage as a pile of individually
 * "resolved" parked files instead of a visibly growing pending queue.
 */
@Injectable()
export class ForwarderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForwarderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  // Explicit @Inject on both params -- see IngestController's identical
  // comment on why implicit-typed constructor injection is unsafe under
  // this repo's vitest transform.
  constructor(
    @Inject(LocalQueueService) private readonly queue: LocalQueueService,
    @Inject(GatewayAuthService) private readonly auth: GatewayAuthService,
  ) {}

  private get targetUrl(): string {
    return (
      process.env.GATEWAY_FORWARD_URL ??
      'http://localhost:4000/internal/gateway/ingest'
    );
  }

  private get intervalMs(): number {
    return Number(process.env.GATEWAY_FORWARD_INTERVAL_MS ?? 2000);
  }

  onModuleInit() {
    // GATEWAY_FORWARD_AUTOSTART=false lets tests drive drain() explicitly
    // instead of racing a background timer.
    if (process.env.GATEWAY_FORWARD_AUTOSTART === 'false') {
      return;
    }
    this.timer = setInterval(() => {
      this.drain().catch((err) => this.logger.error('drain failed', err));
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async drain(): Promise<{
    forwarded: number;
    parked: number;
    remaining: number;
  }> {
    if (this.draining) {
      return { forwarded: 0, parked: 0, remaining: await this.queue.size() };
    }
    this.draining = true;
    let forwarded = 0;
    let parked = 0;
    try {
      const items = await this.queue.listPending<RawResult>();
      for (const item of items) {
        const outcome = await this.forwardOne(item);
        if (outcome === 'retry') {
          break;
        }
        if (outcome === 'park') {
          await this.queue.park(item.id);
          parked++;
          this.logger.warn(
            `parked unmatched result ${item.id} (instrument=${item.payload.instrumentId}, specimen=${item.payload.specimenId}, analyte=${item.payload.analyte}) -- will not be retried automatically`,
          );
          continue;
        }
        await this.queue.remove(item.id);
        forwarded++;
      }
    } finally {
      this.draining = false;
    }
    return { forwarded, parked, remaining: await this.queue.size() };
  }

  private async forwardOne(
    item: QueuedItem<RawResult>,
  ): Promise<ForwardOutcome> {
    try {
      const token = await this.auth.getToken();
      const response = await fetch(this.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey(item.payload),
        },
        body: JSON.stringify(item.payload),
      });
      if (response.status === 401) {
        this.auth.invalidate();
        return 'retry';
      }
      if (response.status === 422) {
        return 'park';
      }
      return response.ok ? 'forwarded' : 'retry';
    } catch {
      // Network error (cloud core unreachable) -- leave the item queued.
      return 'retry';
    }
  }
}
