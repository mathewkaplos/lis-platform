import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { criticalNotification, writeAuditEvent } from '@lis/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../auth/db';
import { schedulerDb } from '../auth/scheduler-db';
import {
  toCriticalNotificationDto,
  type CriticalNotificationRow,
} from './critical-notification-mapper';

// The first `actorType: 'service'` audit actor this repo has ever written
// (every existing audit write is `'human'`, the interactive-request case) --
// a well-known, documented sentinel representing this job itself, never a
// real user. Not FK-constrained (no user table exists yet, same gap
// `observation.operatorUserId`/`verifierUserId` already have). ADR-0017.
const ESCALATION_SERVICE_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

// ADR-0017 revision (approved 2026-08-08): poll every 5 minutes -- frequent
// enough that the real escalation delay stays close to the configured
// window below, infrequent enough to be a trivial background cost.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

function escalationWindowMs(): number {
  // A real clinical-workflow parameter (ADR-0017 revision), not hardcoded --
  // defaults to the approved 30 minutes if unset, rather than throwing like
  // scheduler-db.ts's DB URLs do, since a missing value here shouldn't take
  // the whole app down.
  const minutes = Number(
    process.env.CRITICAL_NOTIFICATION_ESCALATION_MINUTES ?? '30',
  );
  return minutes * 60 * 1000;
}

/**
 * TASK-066 (FEAT-021, ADR-0017). Two-phase per tick, deliberately using two
 * different roles for the two different trust levels each phase needs:
 *
 * 1. Enumeration (`schedulerDb`, `lis_scheduler`): which tenants have any
 *    `critical_notification` still `'pending'` past the escalation window.
 *    The `scheduler_enumeration` RLS policy (migration 0018) already
 *    restricts this role to `status = 'pending'` rows and a single column
 *    (`tenant_id`) -- this query's own `created_at` filter further narrows
 *    it to genuinely overdue rows, avoiding a wasted per-tenant transaction
 *    for a tenant whose only pending row isn't overdue yet.
 * 2. Escalation (`db`, `lis_app`, per tenant): the real, RLS-scoped
 *    `SELECT`/`UPDATE`/audit write, exactly like every other write in this
 *    repo -- `lis_scheduler` never touches the mutating path at all.
 *
 * No SMS/email/push, no on-call routing (proposal's own scope note,
 * unchanged): escalating means bumping `escalationLevel`/`lastEscalatedAt`
 * and auditing it, re-surfacing more prominently via the existing
 * `GET /v1/critical-notifications` query to the same `verify`-capable pool
 * -- not a new delivery channel.
 */
@Injectable()
export class CriticalNotificationEscalationService {
  private readonly logger = new Logger(
    CriticalNotificationEscalationService.name,
  );

  @Interval(POLL_INTERVAL_MS)
  async escalateOverdue(): Promise<void> {
    const threshold = new Date(Date.now() - escalationWindowMs());
    const tenantIds =
      await this.enumerateTenantsWithOverdueNotifications(threshold);

    for (const tenantId of tenantIds) {
      try {
        await this.escalateForTenant(tenantId, threshold);
      } catch (err) {
        // One tenant's failure must never block another's -- same
        // isolation principle Constitution Law #4 already applies to data,
        // applied here to this job's own error handling.
        this.logger.error(
          `Critical notification escalation failed for tenant ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async enumerateTenantsWithOverdueNotifications(
    threshold: Date,
  ): Promise<string[]> {
    const rows = await schedulerDb
      .selectDistinct({ tenantId: criticalNotification.tenantId })
      .from(criticalNotification)
      .where(lt(criticalNotification.createdAt, threshold));
    return rows.map((row) => row.tenantId);
  }

  private async escalateForTenant(
    tenantId: string,
    threshold: Date,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );

      const overdue: CriticalNotificationRow[] = await tx
        .select()
        .from(criticalNotification)
        .where(
          and(
            eq(criticalNotification.status, 'pending'),
            lt(criticalNotification.createdAt, threshold),
          ),
        );

      for (const before of overdue) {
        const [after] = await tx
          .update(criticalNotification)
          .set({
            status: 'escalated',
            escalationLevel: before.escalationLevel + 1,
            lastEscalatedAt: new Date(),
          })
          .where(eq(criticalNotification.id, before.id))
          .returning();

        await writeAuditEvent(tx, {
          tenantId,
          actorPrincipalId: ESCALATION_SERVICE_ACTOR_ID,
          actorRole: 'system',
          actorType: 'service',
          action: 'critical_notification.escalate',
          resourceType: 'critical_notification',
          resourceId: after.id,
          before: toCriticalNotificationDto(before),
          after: toCriticalNotificationDto(after),
        });
      }
    });
  }
}
