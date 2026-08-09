import {
  Controller,
  Get,
  HttpCode,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  worklistQuerySchema,
  worklistResponseSchema,
  worklistBulkAssignSchema,
  worklistBulkAssignResponseSchema,
  worklistBulkCancelSchema,
  worklistBulkCancelResponseSchema,
  computeSlaStatus,
  WORKLIST_RESULT_LIMIT,
  type WorklistCounts,
  type WorklistItem,
  type WorklistResponse,
  type WorklistBulkAssignResult,
  type WorklistBulkCancelResult,
} from '@lis/domain';
import {
  order,
  orderedTest,
  patient,
  slaTarget,
  testDefinition,
  writeAuditEvent,
} from '@lis/db';
import { and, asc, count, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { ZodResponse, ZodValidationPipe, createZodDto } from 'nestjs-zod';
import {
  CapabilityGuard,
  type RequestWithGrantingRole,
} from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class WorklistQueryDto extends createZodDto(worklistQuerySchema) {}
class WorklistResponseDto extends createZodDto(worklistResponseSchema) {}
class WorklistBulkAssignDto extends createZodDto(worklistBulkAssignSchema) {}
class WorklistBulkAssignResponseDto extends createZodDto(
  worklistBulkAssignResponseSchema,
) {}
class WorklistBulkCancelDto extends createZodDto(worklistBulkCancelSchema) {}
class WorklistBulkCancelResponseDto extends createZodDto(
  worklistBulkCancelResponseSchema,
) {}

/** The 4 real, currently-written statuses that make up "active" work — see
 * docs/plans/feat-017-minimal-worklist.md finding #1. 'collected'/'reported'
 * are never written by any code today; 'cancelled'/'rejected' are excluded
 * by default (§10 Q3) and only reachable via an explicit `status` filter. */
const ACTIVE_STATUSES = [
  'ordered',
  'received',
  'in_process',
  'resulted',
] as const;
const PENDING_STATUSES = ['ordered', 'received'] as const;

/**
 * TASK-061 (FEAT-017 proposal, docs/plans/feat-017-minimal-worklist.md):
 * a live query over `ordered_test`, not a stored worklist/task record (KB-26's
 * "worklist" half only). Read-only, no capability gate — matches
 * OrderController.search()'s/CatalogController's own gate-free read
 * precedent. Not audited, per the same reasoning (`engineering/api-design`
 * entry #6).
 */
@Controller('v1/worklist')
export class WorklistController {
  /**
   * §10 Q4 (approved): one combined `{ counts, items }` response, not two
   * routes — the future worklist UI (TASK-062) needs both on first paint.
   * §10 Q1 (approved): stage counts always reflect the tenant's full active
   * set, independent of `items`' own filters — a global snapshot, not
   * narrowed by whatever query params happened to be passed for the list.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: WorklistResponseDto, status: 200 })
  async list(
    @Query(new ZodValidationPipe(worklistQuerySchema))
    query: WorklistQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<WorklistResponse> {
    const counts = await this.loadCounts(tx);
    const items = await this.loadItems(tx, query);
    return { counts, items };
  }

  private async loadCounts(tx: RequestWithTx['tx']): Promise<WorklistCounts> {
    const rows = await tx
      .select({ status: orderedTest.status, total: count() })
      .from(orderedTest)
      .where(inArray(orderedTest.status, ACTIVE_STATUSES))
      .groupBy(orderedTest.status);

    const totalByStatus = new Map(rows.map((row) => [row.status, row.total]));
    return {
      pending:
        (totalByStatus.get('ordered') ?? 0) +
        (totalByStatus.get('received') ?? 0),
      inProgress: totalByStatus.get('in_process') ?? 0,
      verified: totalByStatus.get('resulted') ?? 0,
    };
  }

  private async loadItems(
    tx: RequestWithTx['tx'],
    query: WorklistQueryDto,
  ): Promise<WorklistItem[]> {
    // §10 Q3 (approved): priority lives only on the parent `order`
    // (finding #3) — resolve matching order ids first via a separate query,
    // same "resolve related ids, then inArray()" convention already used by
    // OrderController.create()'s panel-expansion step, not a `.innerJoin()`.
    let orderIdsMatchingPriority: string[] | undefined;
    if (query.priority !== undefined) {
      const matchingOrders = await tx
        .select({ id: order.id })
        .from(order)
        .where(eq(order.priority, query.priority));
      orderIdsMatchingPriority = matchingOrders.map((row) => row.id);
    }

    const sharedConditions = [
      query.createdFrom !== undefined
        ? gte(orderedTest.createdAt, new Date(query.createdFrom))
        : undefined,
      query.createdTo !== undefined
        ? lte(orderedTest.createdAt, new Date(query.createdTo))
        : undefined,
      orderIdsMatchingPriority !== undefined
        ? inArray(orderedTest.orderId, orderIdsMatchingPriority)
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    // Real bug found and fixed during this task's own implementation: a
    // single query capped at WORKLIST_RESULT_LIMIT across the WHOLE default
    // active set silently starves the smaller stages once one status
    // dominates (confirmed directly against real data — this local DB's own
    // `ordered_test` table has 116 'ordered' rows vs. 25 'in_process' after
    // repeated e2e runs, a completely realistic real-lab volume too, not a
    // test-only artifact). With no `stage`/`status` filter given, each of
    // the 3 counted buckets is queried and capped independently, so a large
    // 'pending' backlog can never crowd 'in_process'/'verified' items out of
    // the default view.
    const isDefaultView =
      query.status === undefined && query.stage === undefined;
    const rows = isDefaultView
      ? (
          await Promise.all(
            [PENDING_STATUSES, ['in_process'], ['resulted']].map((statuses) =>
              this.fetchOrderedTestRows(tx, statuses, sharedConditions),
            ),
          )
        )
          .flat()
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      : await this.fetchOrderedTestRows(
          tx,
          this.resolveStatusFilter(query),
          sharedConditions,
        );

    if (rows.length === 0) return [];

    // Batch-resolve related order/testDefinition/patient rows via inArray()
    // + in-memory Map, not `.innerJoin()` — this repo's established no-join
    // convention (order.controller.ts's search(), catalog.controller.ts).
    const orderIds = Array.from(new Set(rows.map((row) => row.orderId)));
    const orderRows = await tx
      .select({
        id: order.id,
        patientId: order.patientId,
        priority: order.priority,
      })
      .from(order)
      .where(inArray(order.id, orderIds));
    const orderById = new Map(orderRows.map((row) => [row.id, row]));

    const testDefinitionIds = Array.from(
      new Set(rows.map((row) => row.testDefinitionId)),
    );
    const testDefinitionRows = await tx
      .select({
        id: testDefinition.id,
        displayName: testDefinition.displayName,
      })
      .from(testDefinition)
      .where(inArray(testDefinition.id, testDefinitionIds));
    const testDefinitionById = new Map(
      testDefinitionRows.map((row) => [row.id, row]),
    );

    const patientIds = Array.from(
      new Set(orderRows.map((row) => row.patientId)),
    );
    const patientRows =
      patientIds.length > 0
        ? await tx
            .select({
              id: patient.id,
              firstName: patient.firstName,
              lastName: patient.lastName,
              mrn: patient.mrn,
            })
            .from(patient)
            .where(inArray(patient.id, patientIds))
        : [];
    const patientById = new Map(patientRows.map((row) => [row.id, row]));

    // FEAT-022 Part 1: exactly 2 real priority values (routine|stat) -- a
    // plain unfiltered select, no inArray() batching needed, same reasoning
    // this method already applies to small fixed sets elsewhere.
    const slaTargetRows = await tx
      .select({
        priority: slaTarget.priority,
        targetMinutes: slaTarget.targetMinutes,
      })
      .from(slaTarget);
    const targetMinutesByPriority = new Map(
      slaTargetRows.map((row) => [row.priority, row.targetMinutes]),
    );

    const now = Date.now();
    return rows.map((row): WorklistItem => {
      const orderRow = orderById.get(row.orderId);
      const testDefinitionRow = testDefinitionById.get(row.testDefinitionId);
      const patientRow = orderRow
        ? patientById.get(orderRow.patientId)
        : undefined;
      const priority = (orderRow?.priority ??
        'routine') as WorklistItem['priority']; // CHECK-constrained (ck_order_priority)
      const ageMinutes = Math.max(
        0,
        Math.floor((now - row.createdAt.getTime()) / 60_000),
      );
      return {
        id: row.id,
        orderId: row.orderId,
        testDefinitionId: row.testDefinitionId,
        testDisplayName: testDefinitionRow?.displayName ?? 'Unknown test',
        status: row.status as WorklistItem['status'], // CHECK-constrained (ck_ordered_test_status), not reflected in drizzle's plain `text` column type
        priority,
        patient: {
          firstName: patientRow?.firstName ?? 'Unknown',
          lastName: patientRow?.lastName ?? 'Unknown',
          mrn: patientRow?.mrn ?? '',
        },
        createdAt: row.createdAt.toISOString(),
        ageMinutes,
        slaStatus: computeSlaStatus(
          ageMinutes,
          targetMinutesByPriority.get(priority),
        ),
        assignedUserId: row.assignedUserId,
      };
    });
  }

  private async fetchOrderedTestRows(
    tx: RequestWithTx['tx'],
    statusValues: readonly string[],
    sharedConditions: SQL[],
  ) {
    return tx
      .select()
      .from(orderedTest)
      .where(
        and(inArray(orderedTest.status, statusValues), ...sharedConditions),
      )
      .orderBy(asc(orderedTest.createdAt))
      .limit(WORKLIST_RESULT_LIMIT);
  }

  /**
   * §10 Q1/Q3 (approved): `stage` maps to its bucket's real status value(s);
   * `status` narrows to one exact value, including 'cancelled'/'rejected'
   * (the "optional filter to include them" Q3 resolved for). With neither
   * given, the default active set (finding #1) applies.
   */
  private resolveStatusFilter(query: WorklistQueryDto): readonly string[] {
    if (query.status !== undefined) return [query.status];
    if (query.stage === 'pending') return PENDING_STATUSES;
    if (query.stage === 'in_progress') return ['in_process'];
    if (query.stage === 'verified') return ['resulted'];
    return ACTIVE_STATUSES;
  }

  /**
   * FEAT-022 Part 1 (ADR-0024): sets `assignedUserId` on every id in the
   * request that resolves to a real, tenant-visible `ordered_test` row --
   * RLS makes a cross-tenant id structurally invisible to the `inArray()`
   * lookup below (same "RLS, not a manual filter" pattern this repo uses
   * everywhere), so a wrong-tenant id lands in `notFoundIds`, not a
   * cross-tenant mutation. `assignedUserId: null` clears the assignment
   * (bulk-unassign) -- a real, explicit request shape, not an omitted field.
   * No status-transition side effect, so (unlike bulk-cancel) every status
   * is a valid target for this action.
   *
   * Deliberately NOT `@Audit()`/`AuditInterceptor` -- that mechanism writes
   * exactly one `audit_event` row per call, driven by a single
   * `resourceId: string` on the handler's return value (a real, non-null
   * `uuid` column, `packages/db/src/schema/audit.ts`). This is this repo's
   * first genuinely multi-resource action with no single natural parent id
   * (unlike `order.cancel()`'s own cascade, which is scoped to one order) --
   * a real, previously-undiscovered gap in `AuditInterceptor`'s own
   * single-resource shape, found by a real 500 (a `NOT NULL` violation on
   * `resource_id`) during this task's own implementation, not anticipated
   * in the proposal. Fixed here by calling `writeAuditEvent` directly, once
   * per actually-updated id, still inside the same transaction
   * `TenantContextInterceptor` already opened (Constitution Law #5's "same
   * transaction as the change" is satisfied by `tx` itself, not by which
   * mechanism issues the write).
   */
  @Post('bulk-assign')
  @HttpCode(200) // an action, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_orders')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: WorklistBulkAssignResponseDto, status: 200 })
  async bulkAssign(
    @Body(new ZodValidationPipe(worklistBulkAssignSchema))
    body: WorklistBulkAssignDto,
    @CurrentUser() user: RequestContext,
    @Req() req: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<WorklistBulkAssignResult> {
    const existing = await tx
      .select({
        id: orderedTest.id,
        assignedUserId: orderedTest.assignedUserId,
      })
      .from(orderedTest)
      .where(inArray(orderedTest.id, body.orderedTestIds));
    const existingById = new Map(existing.map((row) => [row.id, row]));
    const updatedIds = body.orderedTestIds.filter((id) => existingById.has(id));
    const notFoundIds = body.orderedTestIds.filter(
      (id) => !existingById.has(id),
    );

    if (updatedIds.length > 0) {
      await tx
        .update(orderedTest)
        .set({ assignedUserId: body.assignedUserId })
        .where(inArray(orderedTest.id, updatedIds));

      for (const id of updatedIds) {
        await writeAuditEvent(tx, {
          tenantId: user.tenantId,
          actorPrincipalId: user.sub,
          actorRole: req.grantingRole,
          actorType: 'human',
          action: 'worklist.bulk_assign',
          resourceType: 'ordered_test',
          resourceId: id,
          before: { assignedUserId: existingById.get(id)!.assignedUserId },
          after: { assignedUserId: body.assignedUserId },
        });
      }
    }

    return { updatedIds, notFoundIds };
  }

  /**
   * FEAT-022 Part 1 (proposal §1 finding #2/#3): the ONE status transition
   * with no real domain side effect to bypass -- deliberately not a generic
   * `toStatus` endpoint. Eligibility mirrors `order.controller.ts`'s own
   * single-order `cancel()` exactly (`status === 'ordered'` only), extended
   * across potentially many orders in one call. Each affected order's own
   * cascade-to-`'cancelled'` rule ("only if *every* test on that order ends
   * up cancelled") is evaluated per order, not globally -- a bulk selection
   * spanning two orders where only one order's tests are all cancelled must
   * cascade that one order only.
   */
  @Post('bulk-cancel')
  @HttpCode(200) // an action, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_orders')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: WorklistBulkCancelResponseDto, status: 200 })
  async bulkCancel(
    @Body(new ZodValidationPipe(worklistBulkCancelSchema))
    body: WorklistBulkCancelDto,
    @CurrentUser() user: RequestContext,
    @Req() req: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<WorklistBulkCancelResult> {
    const candidates = await tx
      .select({
        id: orderedTest.id,
        orderId: orderedTest.orderId,
        status: orderedTest.status,
      })
      .from(orderedTest)
      .where(inArray(orderedTest.id, body.orderedTestIds));
    const candidateById = new Map(candidates.map((row) => [row.id, row]));

    const cancelledIds: string[] = [];
    const ineligibleIds: string[] = [];
    for (const id of body.orderedTestIds) {
      const row = candidateById.get(id);
      if (row && row.status === 'ordered') {
        cancelledIds.push(id);
      } else {
        ineligibleIds.push(id);
      }
    }

    if (cancelledIds.length === 0) {
      return { cancelledIds, ineligibleIds };
    }

    await tx
      .update(orderedTest)
      .set({ status: 'cancelled' })
      .where(inArray(orderedTest.id, cancelledIds));

    // Same "no single natural resourceId" gap as bulkAssign above -- direct
    // writeAuditEvent per cancelled id, not @Audit()/AuditInterceptor.
    for (const id of cancelledIds) {
      await writeAuditEvent(tx, {
        tenantId: user.tenantId,
        actorPrincipalId: user.sub,
        actorRole: req.grantingRole,
        actorType: 'human',
        action: 'worklist.bulk_cancel',
        resourceType: 'ordered_test',
        resourceId: id,
        before: { status: candidateById.get(id)!.status },
        after: { status: 'cancelled' },
      });
    }

    // Per-order cascade (finding #2/#3): re-evaluate only the orders this
    // call actually touched, each independently -- mirrors
    // `order.controller.ts`'s own single-order cascade rule, not a new one.
    const affectedOrderIds = Array.from(
      new Set(cancelledIds.map((id) => candidateById.get(id)!.orderId)),
    );
    const allTestsOnAffectedOrders = await tx
      .select({ orderId: orderedTest.orderId, status: orderedTest.status })
      .from(orderedTest)
      .where(inArray(orderedTest.orderId, affectedOrderIds));
    const testsByOrder = new Map<string, string[]>();
    for (const row of allTestsOnAffectedOrders) {
      const statuses = testsByOrder.get(row.orderId) ?? [];
      statuses.push(row.status);
      testsByOrder.set(row.orderId, statuses);
    }
    const fullyCancelledOrderIds = affectedOrderIds.filter((orderId) =>
      (testsByOrder.get(orderId) ?? []).every(
        (status) => status === 'cancelled',
      ),
    );
    if (fullyCancelledOrderIds.length > 0) {
      await tx
        .update(order)
        .set({ status: 'cancelled' })
        .where(inArray(order.id, fullyCancelledOrderIds));
    }

    return { cancelledIds, ineligibleIds };
  }
}
