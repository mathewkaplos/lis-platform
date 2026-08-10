import { Logger } from '@nestjs/common';
import { observation, slaBreach, writeAuditEvent } from '@lis/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { WorkflowCommandHandler } from '../workflow/workflow-command.registry';

const logger = new Logger('NotifySlaBreach');

// Distinct from every other system-process sentinel this repo already has
// (REFLEX_ENGINE_ACTOR_ID ...010, SLA_DETECTOR_ACTOR_ID ...011). No FK
// constrains this column (no user table exists yet, M2).
const NOTIFY_SLA_BREACH_ACTOR_ID = '00000000-0000-0000-0000-000000000012';

/**
 * FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md).
 * The `NotifySlaBreach` command a published `workflow_definition` rule
 * (`"on": "SlaBreached"`) can dispatch. No new delivery channel -- bumps
 * `sla_breach.status`/`escalationLevel` and audits it, same explicit scope
 * note `critical-notification-escalation.service.ts` already established
 * ("escalating means bumping status/level... not a new delivery channel").
 *
 * Re-verifies against live DB state before acting -- `workflow-engine`
 * Skill entry #9: the rule's own `when` is never the safety/correctness
 * boundary, the handler is. Here that means: has this ordered_test's panel
 * been verified in the gap between the detector's own detection and this
 * rule's dispatch (an expected race, not a bug -- the detector runs on its
 * own 5-minute tick, entirely decoupled from when a rule actually fires)?
 * If so, resolve the breach instead of notifying on stale state -- a
 * logged action either way, never a thrown error (`workflow-engine` Skill
 * entry #4: a handler's own "cannot safely act as originally intended"
 * case is a no-op/alternate-path, never a throw, under ADR-0028's no-DLQ
 * design).
 */
export const notifySlaBreachHandler: WorkflowCommandHandler = async (
  _command,
  eventPayload,
  tenantId,
  tx,
  firingContext,
) => {
  const payload = (eventPayload ?? {}) as { orderedTestId?: unknown };
  const orderedTestId = payload.orderedTestId;
  if (typeof orderedTestId !== 'string') {
    logger.warn(
      `triggering event payload has no orderedTestId (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  const [breach] = await tx
    .select()
    .from(slaBreach)
    .where(
      and(
        eq(slaBreach.orderedTestId, orderedTestId),
        eq(slaBreach.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!breach) {
    logger.warn(
      `no sla_breach row found for ordered_test ${orderedTestId} (tenant ${tenantId}) -- no-op`,
    );
    return;
  }
  if (breach.status === 'resolved') {
    logger.log(
      `sla_breach ${breach.id} already resolved -- no-op (idempotent)`,
    );
    return;
  }

  const [verified] = await tx
    .select({ id: observation.id })
    .from(observation)
    .where(
      and(
        eq(observation.orderedTestId, orderedTestId),
        eq(observation.status, 'verified'),
        isNull(observation.supersededBy),
      ),
    )
    .limit(1);

  if (firingContext.dryRun) {
    logger.log(
      `dry-run: would ${verified ? 'resolve' : 'escalate'} sla_breach ${breach.id} (tenant ${tenantId})`,
    );
    return;
  }

  if (verified) {
    // Verified between detection and dispatch -- resolve, don't notify on
    // stale state.
    const [after] = await tx
      .update(slaBreach)
      .set({ status: 'resolved' })
      .where(eq(slaBreach.id, breach.id))
      .returning();

    await writeAuditEvent(tx, {
      tenantId,
      actorPrincipalId: NOTIFY_SLA_BREACH_ACTOR_ID,
      actorRole: 'system',
      actorType: 'service',
      action: 'sla_breach.resolve',
      resourceType: 'sla_breach',
      resourceId: breach.id,
      before: { status: breach.status },
      after: { status: after.status },
    });
    logger.log(
      `sla_breach ${breach.id} resolved -- ordered_test ${orderedTestId} verified before dispatch (tenant ${tenantId})`,
    );
    return;
  }

  const [after] = await tx
    .update(slaBreach)
    .set({
      status: 'escalated',
      escalationLevel: breach.escalationLevel + 1,
      lastEscalatedAt: new Date(),
    })
    .where(eq(slaBreach.id, breach.id))
    .returning();

  await writeAuditEvent(tx, {
    tenantId,
    actorPrincipalId: NOTIFY_SLA_BREACH_ACTOR_ID,
    actorRole: 'system',
    actorType: 'service',
    action: 'sla_breach.notify',
    resourceType: 'sla_breach',
    resourceId: breach.id,
    before: {
      status: breach.status,
      escalationLevel: breach.escalationLevel,
    },
    after: {
      status: after.status,
      escalationLevel: after.escalationLevel,
    },
    context: {
      workflowDefinitionId: firingContext.workflowDefinitionId,
      ruleId: firingContext.ruleId,
    },
  });
  logger.log(
    `sla_breach ${breach.id} escalated to level ${after.escalationLevel} (tenant ${tenantId}, ordered_test ${orderedTestId})`,
  );
};
