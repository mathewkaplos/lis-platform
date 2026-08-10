import { BadRequestException, Injectable } from '@nestjs/common';
import { order, orderedTest, panel, panelTest, testDefinition } from '@lis/db';
import { eq, inArray } from 'drizzle-orm';
import type { OrderPriority } from '@lis/domain';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

export interface CreateOrderInput {
  tenantId: string;
  patientId: string;
  testDefinitionIds?: string[];
  panelIds?: string[];
  priority?: OrderPriority;
}

/**
 * FEAT-036 (ADR-0034): extracted out of `OrderController.create()` so
 * `apps/interop`'s own internal write path (`InteropOrderController`) shares
 * exactly this validation/panel-expansion/insert logic, not a second,
 * independently-maintained copy — same discipline ADR-0027 already
 * established for `ObservationWriteService`. Behavior-preserving: every
 * existing `order.e2e-spec.ts` assertion passes unchanged after this
 * extraction (the acceptance bar for the refactor itself, not a nice-to-have,
 * matching ADR-0027's own stated bar).
 *
 * Callers differ only in how they resolve `patientId`/`testDefinitionIds` —
 * `OrderController` from a validated HTTP body's UUIDs directly,
 * `InteropOrderController` from an HL7 PID/OBR segment via its own
 * correlation step (MRN -> patientId, test code -> testDefinitionId).
 * Authorization/audit stay with the caller, not this service — same
 * boundary ADR-0027 drew for `ObservationWriteService`.
 */
@Injectable()
export class OrderCreationService {
  async create(tx: Tx, input: CreateOrderInput) {
    const requestedPanelIds = input.panelIds ?? [];
    const requestedTestIds = input.testDefinitionIds ?? [];

    if (requestedPanelIds.length > 0) {
      const visiblePanels = await tx
        .select({ id: panel.id })
        .from(panel)
        .where(inArray(panel.id, requestedPanelIds));
      const visibleIds = new Set(visiblePanels.map((row) => row.id));
      const missing = requestedPanelIds.filter((id) => !visibleIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown panel id(s): ${missing.join(', ')}`,
        );
      }
    }

    if (requestedTestIds.length > 0) {
      const visibleTests = await tx
        .select({ id: testDefinition.id })
        .from(testDefinition)
        .where(inArray(testDefinition.id, requestedTestIds));
      const visibleIds = new Set(visibleTests.map((row) => row.id));
      const missing = requestedTestIds.filter((id) => !visibleIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown test definition id(s): ${missing.join(', ')}`,
        );
      }
    }

    const expandedTestIds =
      requestedPanelIds.length > 0
        ? (
            await tx
              .select({ testDefinitionId: panelTest.testDefinitionId })
              .from(panelTest)
              .where(inArray(panelTest.panelId, requestedPanelIds))
          ).map((row) => row.testDefinitionId)
        : [];

    const resolvedTestIds = Array.from(
      new Set([...requestedTestIds, ...expandedTestIds]),
    );
    if (resolvedTestIds.length === 0) {
      throw new BadRequestException(
        'No tests resolved from testDefinitionIds/panelIds (an empty panel?)',
      );
    }

    const [orderRow] = await tx
      .insert(order)
      .values({
        tenantId: input.tenantId,
        patientId: input.patientId,
        status: 'ordered',
        priority: input.priority ?? 'routine',
      })
      .returning();

    const orderedTestRows = await tx
      .insert(orderedTest)
      .values(
        resolvedTestIds.map((testDefinitionId) => ({
          tenantId: input.tenantId,
          orderId: orderRow.id,
          testDefinitionId,
          status: 'ordered' as const,
        })),
      )
      .returning();

    return { orderRow, orderedTestRows };
  }
}
