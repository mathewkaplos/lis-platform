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
    // No explicit .where() on status: lis_scheduler's column-scoped GRANT
    // covers only tenant_id (this table's own migration) -- referencing
    // `status` directly in an app-level WHERE clause requires its own
    // column grant, even though the RLS policy's USING clause (evaluated
    // with the table's own rights, not the querying role's column grants)
    // already restricts every visible row to status='pending'. Confirmed
    // the hard way, against real Postgres: `SELECT DISTINCT tenant_id ...
    // WHERE status = 'pending'` fails "permission denied for table" for
    // lis_scheduler even though the identical query with no status filter
    // succeeds -- exactly matching CriticalNotificationEscalationService's
    // own enumeration query, which likewise never filters on the column
    // (`status`) its own RLS policy already restricts, only on a genuinely
    // granted one (createdAt).
    const rows = await schedulerDb
      .selectDistinct({ tenantId: outboxEvent.tenantId })
      .from(outboxEvent);
    return rows.map((row) => row.tenantId);
  }

  private async processForTenant(tenantId: string): Promise<void> {
    // Deliberately three separate transactions per event, not one wrapping
    // transaction: a handler (WorkflowEngineService's own handleEvent(), the
    // first real one registered -- FEAT-029) opens its own db.transaction()
    // against this same singleton `db` pool, by design decoupled from the
    // relay's own bookkeeping (see WorkflowEngineService's header comment).
    // Calling a handler from *inside* an already-open transaction on that
    // same pool is a nested-checkout deadlock -- fatal under this repo's own
    // DB_POOL_MAX=1 e2e config (the outer transaction holds the pool's only
    // connection while the inner one waits forever for a second), and a
    // latent starvation risk under any pool size in production. Reading
    // pending rows and writing the status update are each their own short
    // transaction so the connection is always released before a handler
    // (which may need one of its own) runs.
    const pending = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return tx
        .select()
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.tenantId, tenantId),
            eq(outboxEvent.status, 'pending'),
          ),
        );
    });

    for (const event of pending) {
      const handlers = this.handlers.handlersFor(event.eventType);
      try {
        for (const handler of handlers) {
          await handler(event.payload, tenantId);
        }
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
          );
          await tx
            .update(outboxEvent)
            .set({ status: 'processed', processedAt: new Date() })
            .where(eq(outboxEvent.id, event.id));
        });
      } catch (err) {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
          );
          await tx
            .update(outboxEvent)
            .set({
              attempts: event.attempts + 1,
              lastError: err instanceof Error ? err.message : String(err),
            })
            .where(eq(outboxEvent.id, event.id));
        });
      }
    }
  }
}
