import { Logger } from '@nestjs/common';
import {
  blockFulfillment,
  orderedTest,
  testDefinition,
  writeAuditEvent,
} from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { db } from '../auth/db';
import type { WorkflowCommandHandler } from '../workflow/workflow-command.registry';
import { checkReflexGuardrails, MAX_REFLEX_DEPTH } from './reflex-guardrails';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const logger = new Logger('AddBlockReflexTest');

// Distinct from REFLEX_ENGINE_ACTOR_ID (...010), SLA_DETECTOR_ACTOR_ID
// (...011), NOTIFY_SLA_BREACH_ACTOR_ID (...012), CULTURE_READ_DETECTOR_ACTOR_ID
// (...013), AUTO_VERIFY_ENGINE_ACTOR_ID (...020) -- continues the reflex-
// adjacent numbering. No FK constrains this column (no user table exists
// yet, M2) -- an arbitrary, documented sentinel, same established convention.
const BLOCK_REFLEX_ENGINE_ACTOR_ID = '00000000-0000-0000-0000-000000000014';

/**
 * Same ancestor walk as add-reflex-test.command.ts's own
 * ancestorTestDefinitionIds -- duplicated rather than imported/shared (§5 of
 * the FEAT-060 proposal: a second, explicitly-named command over a hidden
 * branch in shared code), identical logic since reflex lineage
 * (parent_ordered_test_id) is discipline-agnostic.
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
 * FEAT-060 (KB-17, KB-25 reflex/cascade sub-engine, docs/plans/
 * feat-060-reflex-stains-ihc.md). The one real difference from
 * `add-reflex-test.command.ts`: resolves the parent's **block** via
 * `block_fulfillment` (not `specimen_fulfillment`) and links the new
 * `ordered_test` to that same block, not a specimen -- ADR-0049 §Decision 4's
 * "reflex/add-on stains and IHC create new OrderedTests on existing blocks",
 * FEAT-057's own until-now-unused-by-any-automated-path table.
 *
 * Reuses `ObservationVerified` unchanged as the trigger (same event
 * `AddReflexTest` already consumes) -- an ordered_test with no
 * `block_fulfillment` row (every non-AP discipline, today) is a no-op, not
 * an error, which is what makes this handler safely inert without a new,
 * AP-filtered event. Same no-op-and-log discipline as `AddReflexTest` for
 * every "cannot safely act" branch (ADR-0028's no-DLQ design -- throwing
 * here would retry-storm the whole triggering event forever).
 */
export const addBlockReflexTestHandler: WorkflowCommandHandler = async (
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

  // Idempotency (KB-25: "a no-op if it already exists") -- required for
  // safety under the outbox's at-least-once redelivery, same convention as
  // AddReflexTest's own check.
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
      `block reflex '${testCode}' already exists for parent ${parentOrderedTestId} -- no-op (idempotent)`,
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
      `${violation === 'cycle' ? 'cycle' : `depth > ${MAX_REFLEX_DEPTH}`} guardrail refused block reflex '${testCode}' from parent ${parentOrderedTestId} (tenant ${tenantId}) -- no-op`,
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

  // The real difference from AddReflexTest: resolve the parent's BLOCK, not
  // its specimen. An ordered_test with no block_fulfillment row at all is
  // not part of an AP case -- a structural, expected no-op, not an error
  // (this is what lets this handler share the ObservationVerified trigger
  // with every other discipline's own reflex rules safely).
  const [fulfillment] = await tx
    .select({ blockId: blockFulfillment.blockId })
    .from(blockFulfillment)
    .where(eq(blockFulfillment.orderedTestId, parentOrderedTestId))
    .limit(1);
  if (!fulfillment) {
    logger.log(
      `no block_fulfillment found for parent ordered_test ${parentOrderedTestId} (tenant ${tenantId}) -- not an AP case, no-op`,
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
      // recollection for a block already in hand (KB-25/entry #6's own
      // reasoning, extended from specimen to block: block has no
      // volume/expiry/stability field to check either).
      status: 'received',
      parentOrderedTestId,
    })
    .returning();

  await tx.insert(blockFulfillment).values({
    tenantId,
    blockId: fulfillment.blockId,
    orderedTestId: created.id,
  });

  // Direct writeAuditEvent(), not @Audit() -- this handler runs from
  // OutboxRelayService's @Interval tick, never an HTTP request. Mirrors
  // AddReflexTest's own actorType:'service' pattern.
  await writeAuditEvent(tx, {
    tenantId,
    actorPrincipalId: BLOCK_REFLEX_ENGINE_ACTOR_ID,
    actorRole: 'system',
    actorType: 'service',
    action: 'ordered_test.block_reflex_create',
    resourceType: 'ordered_test',
    resourceId: created.id,
    after: {
      id: created.id,
      testDefinitionId: created.testDefinitionId,
      parentOrderedTestId: created.parentOrderedTestId,
      status: created.status,
      blockId: fulfillment.blockId,
    },
  });

  logger.log(
    `created block reflex ordered_test ${created.id} ('${testCode}') on block ${fulfillment.blockId} from parent ${parentOrderedTestId} (tenant ${tenantId})`,
  );
};
