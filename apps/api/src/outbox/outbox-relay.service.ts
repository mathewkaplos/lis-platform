import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { outboxEvent } from '@lis/db';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../auth/db';
import { schedulerDb } from '../auth/scheduler-db';
import { OutboxHandlerRegistry } from './outbox-handler.registry';

// Matches CriticalNotificationEscalationService's own POLL_INTERVAL_MS
// shape -- @Interval's argument is evaluated at class-definition time, so
// it must be a plain constant, not an instance getter.
const POLL_INTERVAL_MS = Number(
  process.env.OUTBOX_RELAY_POLL_INTERVAL_MS ?? 5 * 60 * 1000,
);

/**
 * FEAT-028 (ADR-0028). Directly reuses
 * `CriticalNotificationEscalationService`'s own already-proven two-phase
 * shape (ADR-0017): enumerate via `schedulerDb`/`lis_scheduler` (cheap,
 * cross-tenant, restricted to `status = 'pending'` by
 * `scheduler_enumeration`), then process each tenant's own pending rows via
 * `db`/`lis_app`, fully RLS-scoped, one tenant's failure never blocking
 * another's.
 *
 * At-least-once, no dead-letter queue (ADR-0028): a handler that throws
 * increments `attempts`/records `lastError`, leaving the row `pending` for
 * the next tick.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  // Explicit @Inject -- see CapabilityGuard's own header comment for why
  // (vitest esbuild design:paramtypes gap).
  constructor(
    @Inject(OutboxHandlerRegistry)
    private readonly handlers: OutboxHandlerRegistry,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick(): Promise<void> {
    const tenantIds = await this.enumerateTenantsWithPendingEvents();
    for (const tenantId of tenantIds) {
      try {
        await this.processForTenant(tenantId);
      } catch (err) {
        // One tenant's failure must never block another's -- same isolation
        // principle CriticalNotificationEscalationService already applies.
        this.logger.error(
          `Outbox relay failed for tenant ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async enumerateTenantsWithPendingEvents(): Promise<string[]> {
    const rows = await schedulerDb
      .selectDistinct({ tenantId: outboxEvent.tenantId })
      .from(outboxEvent)
      .where(eq(outboxEvent.status, 'pending'));
    return rows.map((row) => row.tenantId);
  }

  private async processForTenant(tenantId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );

      const pending = await tx
        .select()
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.tenantId, tenantId),
            eq(outboxEvent.status, 'pending'),
          ),
        );

      for (const event of pending) {
        const handlers = this.handlers.handlersFor(event.eventType);
        try {
          for (const handler of handlers) {
            await handler(event.payload, tenantId);
          }
          await tx
            .update(outboxEvent)
            .set({ status: 'processed', processedAt: new Date() })
            .where(eq(outboxEvent.id, event.id));
        } catch (err) {
          await tx
            .update(outboxEvent)
            .set({
              attempts: event.attempts + 1,
              lastError: err instanceof Error ? err.message : String(err),
            })
            .where(eq(outboxEvent.id, event.id));
        }
      }
    });
  }
}
