import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { cultureRead, writeAuditEvent, writeOutboxEvent } from '@lis/db';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../auth/db';
import { schedulerDb } from '../auth/scheduler-db';

// Distinct from every other system-process sentinel this repo already has
// (REFLEX_ENGINE_ACTOR_ID ...010, SLA_DETECTOR_ACTOR_ID ...011,
// NOTIFY_SLA_BREACH_ACTOR_ID ...012). No FK constrains this column (no user
// table exists yet, M2).
const CULTURE_READ_DETECTOR_ACTOR_ID = '00000000-0000-0000-0000-000000000013';

// Matches SlaBreachDetectorService's own cadence -- one scheduling rhythm
// in the app, no stated reason to pick a different one (same precedent that
// service's own header comment already cites for
// CriticalNotificationEscalationService).
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * FEAT-052 (ADR-0046). Two-phase per tick, reusing
 * `SlaBreachDetectorService`'s exact proven shape -- the one structural
 * difference: this detector never *creates* the row it's detecting over
 * (`culture_read` rows already exist the moment a human schedules them,
 * `CultureReadController.schedule`), so phase 2 here marks `dueNotifiedAt`
 * rather than inserting a new row. It does not "perform" anything clinical
 * -- it makes a due read's own detection an audited fact-of-record. No
 * command handler consumes `CultureReadDue` yet (no notification feature
 * exists in this scope) -- same as this class's own header note in
 * ADR-0046's Consequences section.
 */
@Injectable()
export class CultureReadDueDetectorService {
  private readonly logger = new Logger(CultureReadDueDetectorService.name);

  @Interval(POLL_INTERVAL_MS)
  async detectDue(): Promise<void> {
    const tenantIds = await this.enumerateTenantsWithCandidates();

    for (const tenantId of tenantIds) {
      try {
        await this.detectForTenant(tenantId);
      } catch (err) {
        // One tenant's failure must never block another's -- same
        // isolation principle SlaBreachDetectorService's own tick already
        // applies to its error handling.
        this.logger.error(
          `Culture-read-due detection failed for tenant ${tenantId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async enumerateTenantsWithCandidates(): Promise<string[]> {
    // `culture_read` carries no scheduler_enumeration policy of its own
    // (schema file's own header comment) -- lis_scheduler's cheap phase-1
    // enumeration reads it directly anyway via a column-scoped grant, the
    // same shape outbox_event's own scheduler_enumeration policy already
    // establishes for a table where the whole row (not just tenant_id) is
    // the detection target.
    const rows = await schedulerDb
      .selectDistinct({ tenantId: cultureRead.tenantId })
      .from(cultureRead)
      .where(
        and(
          isNull(cultureRead.completedAt),
          lte(cultureRead.scheduledAt, new Date()),
        ),
      );
    return rows.map((row) => row.tenantId);
  }

  private async detectForTenant(tenantId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );

      const due = await tx
        .select()
        .from(cultureRead)
        .where(
          and(
            isNull(cultureRead.completedAt),
            isNull(cultureRead.dueNotifiedAt),
            lte(cultureRead.scheduledAt, new Date()),
          ),
        );
      if (due.length === 0) {
        return;
      }

      for (const row of due) {
        const [after] = await tx
          .update(cultureRead)
          .set({ dueNotifiedAt: new Date() })
          .where(eq(cultureRead.id, row.id))
          .returning({
            id: cultureRead.id,
            dueNotifiedAt: cultureRead.dueNotifiedAt,
          });

        await writeOutboxEvent(tx, {
          tenantId,
          eventType: 'CultureReadDue',
          payload: {
            cultureReadId: row.id,
            orderedTestId: row.orderedTestId,
            scheduledAt: row.scheduledAt.toISOString(),
          },
        });

        await writeAuditEvent(tx, {
          tenantId,
          actorPrincipalId: CULTURE_READ_DETECTOR_ACTOR_ID,
          actorRole: 'system',
          actorType: 'service',
          action: 'culture_read.detect_due',
          resourceType: 'culture_read',
          resourceId: row.id,
          after: {
            id: row.id,
            orderedTestId: row.orderedTestId,
            scheduledAt: row.scheduledAt.toISOString(),
            dueNotifiedAt: after.dueNotifiedAt?.toISOString() ?? null,
          },
        });

        this.logger.log(
          `culture_read ${row.id} marked due (tenant ${tenantId}, ordered_test ${row.orderedTestId})`,
        );
      }
    });
  }
}
