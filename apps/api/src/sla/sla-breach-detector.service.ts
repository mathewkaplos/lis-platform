import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  observation,
  order,
  orderedTest,
  slaBreach,
  slaTarget,
  writeAuditEvent,
  writeOutboxEvent,
} from '@lis/db';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '../auth/db';
import { schedulerDb } from '../auth/scheduler-db';

// Distinct from REFLEX_ENGINE_ACTOR_ID/ESCALATION_SERVICE_ACTOR_ID -- see
// their own header comments for why each system process gets its own
// sentinel. No FK constrains this column (no user table exists yet, M2).
const SLA_DETECTOR_ACTOR_ID = '00000000-0000-0000-0000-000000000011';

// Matches CriticalNotificationEscalationService's own POLL_INTERVAL_MS --
// one scheduling rhythm in the app rather than two, no stated reason to
// pick a different cadence (proposal §5).
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const NOT_YET_TERMINAL_STATUSES = ['reported', 'cancelled', 'rejected'];

/**
 * FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md).
 * Two-phase per tick, reusing `CriticalNotificationEscalationService`'s
 * exact proven shape (ADR-0017):
 *
 * 1. Enumeration (`schedulerDb`, `lis_scheduler`): a cheap, deliberately
 *    conservative over-approximation of "which tenants might have a
 *    breach" -- `ordered_test`'s own `scheduler_enumeration` policy
 *    (order.ts) restricts this to exactly `status NOT IN ('reported',
 *    'cancelled', 'rejected')` rows, the closest available proxy for "not
 *    yet done" given `ordered_test.status` never actually reaches a
 *    literal 'verified' or 'reported' value anywhere in this codebase
 *    (confirmed by FEAT-034's own real finding, `operational-reports
 *    .service.ts`).
 * 2. Detection + write (`db`, `lis_app`, per tenant): the real,
 *    RLS-scoped read/write -- joins each candidate's `order.priority`
 *    against that tenant's own `sla_target.targetMinutes`, excludes any
 *    panel that already has a verified observation (the same "done" bar
 *    `computeTatReport`, FEAT-034, already established:
 *    `observation.status = 'verified'`, not `ordered_test.status`), and
 *    inserts-or-reuses the `sla_breach` row plus a same-transaction
 *    `SlaBreached` outbox event -- the breach record and the event that
 *    announces it never diverge.
 */
@Injectable()
export class SlaBreachDetectorService {
  private readonly logger = new Logger(SlaBreachDetectorService.name);

  @Interval(POLL_INTERVAL_MS)
  async detectOverdue(): Promise<void> {
    const tenantIds = await this.enumerateTenantsWithCandidates();

    for (const tenantId of tenantIds) {
      try {
        await this.detectForTenant(tenantId);
      } catch (err) {
        // One tenant's failure must never block another's -- same
        // isolation principle Constitution Law #4 already applies to
        // data, applied here to this job's own error handling
        // (CriticalNotificationEscalationService's own precedent).
        this.logger.error(
          `SLA breach detection failed for tenant ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async enumerateTenantsWithCandidates(): Promise<string[]> {
    const rows = await schedulerDb
      .selectDistinct({ tenantId: orderedTest.tenantId })
      .from(orderedTest)
      .where(notInArray(orderedTest.status, NOT_YET_TERMINAL_STATUSES));
    return rows.map((row) => row.tenantId);
  }

  private async detectForTenant(tenantId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );

      const targetRows = await tx
        .select({
          priority: slaTarget.priority,
          targetMinutes: slaTarget.targetMinutes,
        })
        .from(slaTarget);
      if (targetRows.length === 0) {
        return; // no configured SLA targets -- nothing to breach against
      }
      const targetMinutesByPriority = new Map(
        targetRows.map((row) => [row.priority, row.targetMinutes]),
      );

      // Real, tenant-scoped re-check of phase 1's own conservative filter
      // -- `lis_scheduler`'s policy only proves "worth a look," never a
      // real breach (§5's own "phase 1 approximate, phase 2 exact" split).
      const candidates = await tx
        .select({
          id: orderedTest.id,
          createdAt: orderedTest.createdAt,
          priority: order.priority,
        })
        .from(orderedTest)
        .innerJoin(order, eq(orderedTest.orderId, order.id))
        .where(notInArray(orderedTest.status, NOT_YET_TERMINAL_STATUSES));
      if (candidates.length === 0) {
        return;
      }

      const now = Date.now();
      const overdue = candidates.filter((row) => {
        const targetMinutes = targetMinutesByPriority.get(row.priority);
        if (targetMinutes === undefined) {
          return false; // no target configured for this priority -- can't breach an undefined target
        }
        const elapsedMinutes = (now - row.createdAt.getTime()) / 60_000;
        return elapsedMinutes > targetMinutes;
      });
      if (overdue.length === 0) {
        return;
      }

      // "Done" bar reused verbatim from computeTatReport (FEAT-034): any
      // current, non-superseded verified observation for this
      // orderedTestId means the panel is done, regardless of whether every
      // one of its analytes individually reached that state -- the same
      // accepted per-panel completion definition, not a stricter one
      // invented here.
      const verifiedOrderedTestIds = new Set(
        (
          await tx
            .selectDistinct({ orderedTestId: observation.orderedTestId })
            .from(observation)
            .where(
              and(
                inArray(
                  observation.orderedTestId,
                  overdue.map((row) => row.id),
                ),
                eq(observation.status, 'verified'),
                isNull(observation.supersededBy),
              ),
            )
        )
          .map((row) => row.orderedTestId)
          .filter((id): id is string => id !== null),
      );

      const breached = overdue.filter(
        (row) => !verifiedOrderedTestIds.has(row.id),
      );

      for (const row of breached) {
        const targetMinutes = targetMinutesByPriority.get(row.priority);
        if (targetMinutes === undefined) {
          continue; // narrowed already above -- satisfies the type checker
        }

        const [existing] = await tx
          .select({ id: slaBreach.id })
          .from(slaBreach)
          .where(eq(slaBreach.orderedTestId, row.id))
          .limit(1);
        if (existing) {
          continue; // already recorded (open or resolved) -- idempotent, same as reflex/critical-notification's own insert-or-reuse precedent
        }

        const [inserted] = await tx
          .insert(slaBreach)
          .values({
            tenantId,
            orderedTestId: row.id,
            priority: row.priority,
            targetMinutes,
            breachedAt: new Date(),
            status: 'pending',
          })
          .returning({ id: slaBreach.id });

        await writeOutboxEvent(tx, {
          tenantId,
          eventType: 'SlaBreached',
          payload: {
            orderedTestId: row.id,
            priority: row.priority,
            targetMinutes,
          },
        });

        // KB-25's own explicit requirement ("every automated action is
        // audited"). Unlike critical_notification's own creation (folded
        // into finalize()'s existing audit event, since that happens
        // synchronously inside a real user request), there is no user
        // request here to fold into -- this job runs on its own schedule --
        // so it gets its own direct writeAuditEvent(), same
        // actorType:'service' shape CriticalNotificationEscalationService's
        // own escalate action already established, one call site earlier
        // in this same action's own lifecycle (detection, not escalation).
        await writeAuditEvent(tx, {
          tenantId,
          actorPrincipalId: SLA_DETECTOR_ACTOR_ID,
          actorRole: 'system',
          actorType: 'service',
          action: 'sla_breach.detect',
          resourceType: 'sla_breach',
          resourceId: inserted.id,
          after: {
            id: inserted.id,
            orderedTestId: row.id,
            priority: row.priority,
            targetMinutes,
            status: 'pending',
          },
        });

        this.logger.log(
          `sla_breach ${inserted.id} recorded for ordered_test ${row.id} (tenant ${tenantId}, priority ${row.priority})`,
        );
      }
    });
  }
}
