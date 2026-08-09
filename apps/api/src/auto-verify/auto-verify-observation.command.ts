import { Logger } from '@nestjs/common';
import {
  controlLot,
  observation,
  qcRuleViolation,
  writeAuditEvent,
  writeOutboxEvent,
} from '@lis/db';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../auth/db';
import { toObservationDto } from '../observation/observation.controller';
import { ObservationWriteService } from '../observation/observation-write.service';
import type { WorkflowCommandHandler } from '../workflow/workflow-command.registry';
import { checkAutoVerifyGates } from './auto-verify-gates';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const logger = new Logger('AutoVerifyObservation');

// Distinct from CriticalNotificationEscalationService's own
// (...000000000000) and AddReflexTest's own (...000000000010) system-actor
// sentinels, so audit_event.actor_principal_id can tell which system
// process performed a given action.
const AUTO_VERIFY_ENGINE_ACTOR_ID = '00000000-0000-0000-0000-000000000020';

/**
 * FEAT-031 (KB-25 "the safety core", ADR-0031). Triggers on
 * `ObservationFinalized`. Unconditionally re-checks four gates against live
 * DB state before ever verifying anything -- the rule's own `when` is a
 * coarse pre-filter only, never the safety boundary (ADR-0031). Every gate
 * failure (an expected, ordinary outcome for most observations, not an
 * error) is a logged no-op, never a thrown error -- the same ADR-0030
 * reasoning `AddReflexTest` already established: throwing would retry-storm
 * the whole triggering event forever under ADR-0028's no-dead-letter-queue
 * design.
 *
 * A factory, not a bare exported const (unlike `AddReflexTest`) -- this
 * handler needs `ObservationWriteService.applyVerification()`, an already-
 * DI-registered, already-exported (`ObservationModule`) service, so the
 * module wiring injects it once rather than this file constructing its own
 * instance outside Nest's container.
 */
export function createAutoVerifyObservationHandler(
  writeService: ObservationWriteService,
): WorkflowCommandHandler {
  return async (_command, eventPayload, tenantId, tx, firingContext) => {
    const payload = (eventPayload ?? {}) as { id?: unknown };
    const observationId = payload.id;
    if (typeof observationId !== 'string') {
      logger.warn(
        `triggering event payload has no observation id (tenant ${tenantId}) -- no-op`,
      );
      return;
    }

    const [existing] = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.id, observationId),
          eq(observation.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!existing) {
      logger.warn(
        `observation ${observationId} not found (tenant ${tenantId}) -- no-op`,
      );
      return;
    }
    if (existing.status !== 'preliminary') {
      // Ordinary race, not an error: e.g. a human already verified it, or a
      // second rule/tick already processed the same finalize. Nothing to do.
      logger.log(
        `observation ${observationId} status '${existing.status}' is not 'preliminary' -- no-op`,
      );
      return;
    }

    const qcHeld = await isQcHeld(tx, tenantId, existing.analyteId);
    const violation = checkAutoVerifyGates({
      flags: existing.flags,
      source: existing.source,
      qcHeld,
    });

    if (violation) {
      logger.log(
        `observation ${observationId} does not qualify (${violation}) -- no-op${firingContext.dryRun ? ' (dry-run)' : ''}`,
      );
      return;
    }

    if (firingContext.dryRun) {
      logger.log(
        `observation ${observationId} WOULD auto-verify (dry-run, rule ${firingContext.ruleId}) -- no write performed`,
      );
      return;
    }

    const updated = await writeService.applyVerification(tx, existing, null);

    await writeAuditEvent(tx, {
      tenantId,
      actorPrincipalId: AUTO_VERIFY_ENGINE_ACTOR_ID,
      actorRole: 'system',
      actorType: 'service',
      action: 'observation.auto_verify',
      resourceType: 'observation',
      resourceId: updated.id,
      before: { status: existing.status },
      after: toObservationDto(updated),
      context: {
        workflowDefinitionId: firingContext.workflowDefinitionId,
        ruleId: firingContext.ruleId,
      },
    });

    // Same event human verify() emits (FEAT-028) -- any downstream consumer
    // (reflex, future notification/reporting readiness) treats an
    // auto-verified result identically to a human-verified one.
    await writeOutboxEvent(tx, {
      tenantId,
      eventType: 'ObservationVerified',
      payload: toObservationDto(updated),
    });

    logger.log(
      `auto-verified observation ${updated.id} (rule ${firingContext.ruleId}, tenant ${tenantId})`,
    );
  };
}

/**
 * The exact QC gate query `FinalizationRollupInterceptor` (ADR-0019) already
 * runs to hold panel completion, reused verbatim: an unresolved
 * (`resolvedAt IS NULL`), `severity = 'rejection'` `qc_rule_violation` for
 * this analyte, scoped by analyte alone (matching that gate's own
 * documented over-block decision -- `control_lot.instrumentId` is never
 * populated by any code today).
 */
async function isQcHeld(
  tx: Tx,
  tenantId: string,
  analyteId: string,
): Promise<boolean> {
  const [held] = await tx
    .select({ id: qcRuleViolation.id })
    .from(qcRuleViolation)
    .innerJoin(controlLot, eq(controlLot.id, qcRuleViolation.controlLotId))
    .where(
      and(
        eq(qcRuleViolation.tenantId, tenantId),
        eq(controlLot.analyteId, analyteId),
        eq(qcRuleViolation.severity, 'rejection'),
        isNull(qcRuleViolation.resolvedAt),
      ),
    )
    .limit(1);
  return held !== undefined;
}
