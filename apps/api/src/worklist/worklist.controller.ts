import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  worklistQuerySchema,
  worklistResponseSchema,
  WORKLIST_RESULT_LIMIT,
  type WorklistCounts,
  type WorklistItem,
  type WorklistResponse,
} from '@lis/domain';
import { order, orderedTest, patient, testDefinition } from '@lis/db';
import { and, asc, count, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { ZodResponse, ZodValidationPipe, createZodDto } from 'nestjs-zod';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class WorklistQueryDto extends createZodDto(worklistQuerySchema) {}
class WorklistResponseDto extends createZodDto(worklistResponseSchema) {}

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

    const now = Date.now();
    return rows.map((row): WorklistItem => {
      const orderRow = orderById.get(row.orderId);
      const testDefinitionRow = testDefinitionById.get(row.testDefinitionId);
      const patientRow = orderRow
        ? patientById.get(orderRow.patientId)
        : undefined;
      return {
        id: row.id,
        orderId: row.orderId,
        testDefinitionId: row.testDefinitionId,
        testDisplayName: testDefinitionRow?.displayName ?? 'Unknown test',
        status: row.status as WorklistItem['status'], // CHECK-constrained (ck_ordered_test_status), not reflected in drizzle's plain `text` column type
        priority: (orderRow?.priority ?? 'routine') as WorklistItem['priority'], // CHECK-constrained (ck_order_priority)
        patient: {
          firstName: patientRow?.firstName ?? 'Unknown',
          lastName: patientRow?.lastName ?? 'Unknown',
          mrn: patientRow?.mrn ?? '',
        },
        createdAt: row.createdAt.toISOString(),
        ageMinutes: Math.max(
          0,
          Math.floor((now - row.createdAt.getTime()) / 60_000),
        ),
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
}
