import { Logger } from '@nestjs/common';
import {
  orderedTest,
  specimen,
  specimenFulfillment,
  testDefinition,
  writeAuditEvent,
} from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { db } from '../auth/db';
import type { WorkflowCommandHandler } from '../workflow/workflow-command.registry';
import { checkReflexGuardrails, MAX_REFLEX_DEPTH } from './reflex-guardrails';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const logger = new Logger('AddReflexTest');

// Distinct from CriticalNotificationEscalationService's own
// ESCALATION_SERVICE_ACTOR_ID (...000000000000) so audit_event's
// actor_principal_id can tell which system process performed a given
// action. No FK constrains this column (no user table exists yet, M2) --
// an arbitrary, documented sentinel, same established convention.
const REFLEX_ENGINE_ACTOR_ID = '00000000-0000-0000-0000-000000000010';

/**
 * Walks `parent_ordered_test_id` up to `maxDepth` levels, collecting each
 * ancestor's `test_definition_id` (immediate parent first). Bounded by the
 * loop itself, not just the guardrail check downstream -- a chain longer
 * than `maxDepth` never gets walked past that point regardless of what
 * `checkReflexGuardrails` does with the result.
 */
async function ancestorTestDefinitionIds(
  tx: Tx,
  tenantId: string,
  startOrderedTestId: string,
  maxDepth: number,
): Promise<string[]> {
  const ids: string[] = [];
  let currentId: string | null = startOrderedTestId;
  for (let i = 0; i <= maxDepth && currentId; i++) {
    const [row] = await tx
      .select({
        testDefinitionId: orderedTest.testDefinitionId,
        parentOrderedTestId: orderedTest.parentOrderedTestId,
      })
      .from(orderedTest)
      .where(
        and(eq(orderedTest.id, currentId), eq(orderedTest.tenantId, tenantId)),
      )
      .limit(1);
    if (!row) {
      break;
    }
    ids.push(row.testDefinitionId);
    currentId = row.parentOrderedTestId;
  }
  return ids;
}

/**
 * FEAT-030 (KB-25 reflex/cascade sub-engine, ADR-0030). The first real
 * `WorkflowCommandRegistry` handler. Every "cannot safely act" branch below
 * (bad `testCode`, cycle, depth-bound, missing fixtures) logs and returns
 * without throwing -- ADR-0030's own reasoning: throwing here would
 * retry-storm the whole triggering event forever under ADR-0028's
 * no-dead-letter-queue design, for a failure a retry can never fix (a rule
 * configuration problem, not a transient one). Only genuinely unexpected
 * errors (e.g. a DB error) are left to propagate/retry normally.
 */
export const addReflexTestHandler: WorkflowCommandHandler = async (
  command,
  eventPayload,
  tenantId,
  tx,
) => {
  const testCode = command.testCode;
  if (typeof testCode !== 'string' || testCode.length === 0) {
    logger.warn(
      `rule's do.testCode is missing or not a string (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  const payload = (eventPayload ?? {}) as { orderedTestId?: unknown };
  const parentOrderedTestId = payload.orderedTestId;
  if (typeof parentOrderedTestId !== 'string') {
    logger.warn(
      `triggering event payload has no orderedTestId (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  const [targetTest] = await tx
    .select({ id: testDefinition.id })
    .from(testDefinition)
    .where(
      and(
        eq(testDefinition.tenantId, tenantId),
        eq(testDefinition.code, testCode),
      ),
    )
    .limit(1);
  if (!targetTest) {
    logger.warn(
      `testCode '${testCode}' does not resolve to any test_definition (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  // Idempotency (KB-25's own literal requirement: "a no-op if it already
  // exists") -- required for safety under the outbox's at-least-once
  // redelivery, exercised for real via a real relay retry, not just read
  // from the code.
  const [existingReflex] = await tx
    .select({ id: orderedTest.id })
    .from(orderedTest)
    .where(
      and(
        eq(orderedTest.tenantId, tenantId),
        eq(orderedTest.parentOrderedTestId, parentOrderedTestId),
        eq(orderedTest.testDefinitionId, targetTest.id),
      ),
    )
    .limit(1);
  if (existingReflex) {
    logger.log(
      `reflex '${testCode}' already exists for parent ${parentOrderedTestId} -- no-op (idempotent)`,
    );
    return;
  }

  const ancestors = await ancestorTestDefinitionIds(
    tx,
    tenantId,
    parentOrderedTestId,
    MAX_REFLEX_DEPTH,
  );
  const violation = checkReflexGuardrails(
    ancestors,
    targetTest.id,
    MAX_REFLEX_DEPTH,
  );
  if (violation) {
    logger.warn(
      `${violation === 'cycle' ? 'cycle' : `depth > ${MAX_REFLEX_DEPTH}`} guardrail refused reflex '${testCode}' from parent ${parentOrderedTestId} (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  const [parent] = await tx
    .select({ orderId: orderedTest.orderId })
    .from(orderedTest)
    .where(
      and(
        eq(orderedTest.id, parentOrderedTestId),
        eq(orderedTest.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!parent) {
    logger.warn(
      `parent ordered_test ${parentOrderedTestId} not found (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  // Acts on the existing specimen where possible (KB-25's own stated
  // preference); raises a recollection instead when it's expired
  // (TASK-440, issue #440 -- see reflex-guardrails.ts's sibling docs and
  // `engineering/workflow-engine` Skill entry #6 for the original gap).
  const [fulfillment] = await tx
    .select({ specimenId: specimenFulfillment.specimenId })
    .from(specimenFulfillment)
    .where(eq(specimenFulfillment.orderedTestId, parentOrderedTestId))
    .limit(1);
  if (!fulfillment) {
    logger.warn(
      `no specimen_fulfillment found for parent ordered_test ${parentOrderedTestId} (tenant ${tenantId}) -- no-op`,
    );
    return;
  }

  const [specimenRow] = await tx
    .select({ expiresAt: specimen.expiresAt })
    .from(specimen)
    .where(eq(specimen.id, fulfillment.specimenId))
    .limit(1);
  const isExpired = Boolean(
    specimenRow?.expiresAt && specimenRow.expiresAt <= new Date(),
  );

  if (isExpired) {
    // Recollection: a fresh `ordered_test` with status 'ordered' and no
    // `specimen_fulfillment` row -- reuses the exact predicate the
    // Collection Queue screen already renders on
    // (apps/web/app/(app)/collection-queue/page.tsx: any orderedTest row
    // still 'ordered'), so this surfaces with zero new UI/endpoint.
    // `parentOrderedTestId` is still set -- reflex lineage is unconditional
    // regardless of which branch a firing takes (workflow-engine Skill
    // entry #5).
    const [created] = await tx
      .insert(orderedTest)
      .values({
        tenantId,
        orderId: parent.orderId,
        testDefinitionId: targetTest.id,
        status: 'ordered',
        parentOrderedTestId,
      })
      .returning();

    await writeAuditEvent(tx, {
      tenantId,
      actorPrincipalId: REFLEX_ENGINE_ACTOR_ID,
      actorRole: 'system',
      actorType: 'service',
      action: 'ordered_test.reflex_recollection_required',
      resourceType: 'ordered_test',
      resourceId: created.id,
      after: {
        id: created.id,
        testDefinitionId: created.testDefinitionId,
        parentOrderedTestId: created.parentOrderedTestId,
        status: created.status,
      },
    });

    logger.log(
      `specimen ${fulfillment.specimenId} expired -- created recollection ordered_test ${created.id} ('${testCode}') from parent ${parentOrderedTestId} (tenant ${tenantId})`,
    );
    return;
  }

  const [created] = await tx
    .insert(orderedTest)
    .values({
      tenantId,
      orderId: parent.orderId,
      testDefinitionId: targetTest.id,
      // 'received' directly, skipping 'ordered'/'collected' -- no physical
      // collection step occurs for material already in hand.
      status: 'received',
      parentOrderedTestId,
    })
    .returning();

  await tx.insert(specimenFulfillment).values({
    tenantId,
    specimenId: fulfillment.specimenId,
    orderedTestId: created.id,
  });

  // Direct writeAuditEvent(), not @Audit() -- this handler runs from
  // OutboxRelayService's @Interval tick, never an HTTP request. Mirrors
  // CriticalNotificationEscalationService's own actorType:'service' pattern.
  await writeAuditEvent(tx, {
    tenantId,
    actorPrincipalId: REFLEX_ENGINE_ACTOR_ID,
    actorRole: 'system',
    actorType: 'service',
    action: 'ordered_test.reflex_create',
    resourceType: 'ordered_test',
    resourceId: created.id,
    after: {
      id: created.id,
      testDefinitionId: created.testDefinitionId,
      parentOrderedTestId: created.parentOrderedTestId,
      status: created.status,
    },
  });

  logger.log(
    `created reflex ordered_test ${created.id} ('${testCode}') from parent ${parentOrderedTestId} (tenant ${tenantId})`,
  );
};
