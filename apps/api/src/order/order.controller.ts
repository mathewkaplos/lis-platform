import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  orderCreateSchema,
  orderSchema,
  orderSearchQuerySchema,
  ORDER_SEARCH_RESULT_LIMIT,
  type Order,
  type OrderedTest,
} from '@lis/domain';
import {
  order,
  orderedTest,
  panel,
  panelTest,
  patient,
  testDefinition,
} from '@lis/db';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const orderIdParamSchema = z.object({ id: z.uuid() });

class OrderCreateDto extends createZodDto(orderCreateSchema) {}
class OrderDto extends createZodDto(orderSchema) {}
class OrderSearchQueryDto extends createZodDto(orderSearchQuerySchema) {}
class OrderIdParamDto extends createZodDto(orderIdParamSchema) {}

function toOrderedTestDto(row: typeof orderedTest.$inferSelect): OrderedTest {
  return {
    ...row,
    status: row.status as OrderedTest['status'], // CHECK-constrained (ck_ordered_test_status), not reflected in drizzle's plain `text` column type
    createdAt: row.createdAt.toISOString(),
  };
}

function toOrderDto(
  row: typeof order.$inferSelect,
  tests: (typeof orderedTest.$inferSelect)[],
  patientSummary?: { firstName: string; lastName: string; mrn: string },
): Order {
  return {
    ...row,
    status: row.status as Order['status'], // CHECK-constrained (ck_order_status)
    priority: row.priority as Order['priority'], // CHECK-constrained (ck_order_priority)
    createdAt: row.createdAt.toISOString(),
    orderedTests: tests.map(toOrderedTestDto),
    patient: patientSummary,
  };
}

/**
 * TASK-042 (FEAT-012). Second real domain-resource endpoint in this repo —
 * built against the same ADR-0013 baseline and `engineering/api-design`
 * Skill as `PatientController`. `/v1/orders` per ADR-0013 §3.
 *
 * `POST /v1/orders/:id/cancel` is this repo's first action sub-resource.
 * KB-08's own literal example (08-api-architecture.md:64-75) is colon-suffix
 * (`:id:cancel`), not slash — deviated from here per a real, two-stage
 * finding (docs/plans/feat-012-order-entry.md §6/§11), not a stylistic
 * choice: (1) a bare `:id:cancel` route string crashes NestJS's route
 * registration entirely under `path-to-regexp@8` ("Missing text before
 * "cancel" param"); escaping the colon (`:id\\:cancel`) fixes registration
 * and (2) is parsed correctly end-to-end under this suite's Express-backed
 * e2e harness -- but (3) the real compiled Fastify server (this app's actual
 * production adapter) registers and *matches* the escaped-colon route
 * (returns a real domain response, not a 404) yet fails to bind the `id`
 * param at all (`undefined` reaches the handler), a genuine divergence
 * between path-to-regexp (Express/Nest's route-registration validator) and
 * Fastify's own `find-my-way` router at request-match time. Caught only by
 * booting the real compiled server directly and hitting it with `curl`
 * (§8), exactly the class of harness mismatch `engineering/api-design`
 * entry #10 and AGENTS.md's own standing rule both warn about -- the
 * e2e suite alone would have shipped this broken. `/cancel` (slash) is
 * confirmed to register and bind correctly under both harnesses.
 *
 * Every `@Body()`/`@Query()`/`@Param()` below explicitly instantiates `new
 * ZodValidationPipe(schema)`, matching `PatientController`'s own established
 * reason (`engineering/api-design` entry #8): vitest's esbuild transform
 * doesn't emit `design:paramtypes`, so the global pipe alone can't identify
 * a DTO class by reflection under this repo's test harness.
 */
@Controller('v1/orders')
export class OrderController {
  /**
   * FEAT-012 proposal §5: `panelIds` are expanded server-side into their
   * member `testDefinitionId`s (via `panelTest`) and unioned with any
   * directly-supplied `testDefinitionIds`, deduplicated — ordering the same
   * test both directly and via a panel creates exactly one `ordered_test`
   * row. Every supplied id (test or panel) is checked for RLS visibility
   * before any row is written — a nonexistent or cross-tenant id fails the
   * whole request with `400`, never a partial order. `patientId` is checked
   * the same way: a foreign key alone would not catch a cross-tenant id,
   * since Postgres FK validation does not consult RLS policies.
   */
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_orders')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'order.create', resourceType: 'order' })
  async create(
    @Body(new ZodValidationPipe(orderCreateSchema)) body: OrderCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [patientRow] = await tx
      .select({ id: patient.id })
      .from(patient)
      .where(eq(patient.id, body.patientId))
      .limit(1);
    if (!patientRow) {
      throw new BadRequestException(`Unknown patient id: ${body.patientId}`);
    }

    const requestedPanelIds = body.panelIds ?? [];
    const requestedTestIds = body.testDefinitionIds ?? [];

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
        tenantId: user.tenantId,
        patientId: body.patientId,
        status: 'ordered',
        priority: body.priority ?? 'routine',
      })
      .returning();

    const orderedTestRows = await tx
      .insert(orderedTest)
      .values(
        resolvedTestIds.map((testDefinitionId) => ({
          tenantId: user.tenantId,
          orderId: orderRow.id,
          testDefinitionId,
          status: 'ordered' as const,
        })),
      )
      .returning();

    return {
      resourceId: orderRow.id,
      before: null,
      after: toOrderDto(orderRow, orderedTestRows),
    };
  }

  /**
   * All filters optional, combine with AND (proposal §5). No free-text
   * search mode — FEAT-012's own AC names status/priority/date range only.
   * Fixed-cap result set, no cursor pagination (`engineering/api-design`
   * entry #4, still deferred).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [OrderDto], status: 200 })
  async search(
    @Query(new ZodValidationPipe(orderSearchQuerySchema))
    query: OrderSearchQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Order[]> {
    const conditions = [
      query.patientId !== undefined
        ? eq(order.patientId, query.patientId)
        : undefined,
      query.status !== undefined ? eq(order.status, query.status) : undefined,
      query.priority !== undefined
        ? eq(order.priority, query.priority)
        : undefined,
      query.createdFrom !== undefined
        ? gte(order.createdAt, new Date(query.createdFrom))
        : undefined,
      query.createdTo !== undefined
        ? lte(order.createdAt, new Date(query.createdTo))
        : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await tx
      .select()
      .from(order)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(ORDER_SEARCH_RESULT_LIMIT);

    const orderIds = rows.map((row) => row.id);
    const testRows =
      orderIds.length > 0
        ? await tx
            .select()
            .from(orderedTest)
            .where(inArray(orderedTest.orderId, orderIds))
        : [];
    const testsByOrderId = new Map<
      string,
      (typeof orderedTest.$inferSelect)[]
    >();
    for (const testRow of testRows) {
      const existing = testsByOrderId.get(testRow.orderId) ?? [];
      existing.push(testRow);
      testsByOrderId.set(testRow.orderId, existing);
    }

    // TASK-044 (proposal §2): batch-resolve every result row's patient in one
    // extra query, not N+1 — a list screen showing raw patientId uuids is
    // unusable, and no endpoint exists to bulk-resolve patients otherwise.
    const patientIds = Array.from(new Set(rows.map((row) => row.patientId)));
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

    return rows.map((row) =>
      toOrderDto(
        row,
        testsByOrderId.get(row.id) ?? [],
        patientById.get(row.patientId),
      ),
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: OrderDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(orderIdParamSchema)) { id }: OrderIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Order> {
    const [row] = await tx
      .select()
      .from(order)
      .where(eq(order.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!row) {
      throw new NotFoundException('Order not found');
    }
    const tests = await tx
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.orderId, id));
    const [patientRow] = await tx
      .select({
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        mrn: patient.mrn,
      })
      .from(patient)
      .where(eq(patient.id, row.patientId))
      .limit(1);
    return toOrderDto(row, tests, patientRow);
  }

  /**
   * FEAT-012 proposal §10 Q1: cascades — every ordered_test still in
   * 'ordered' status transitions to 'cancelled'; the order itself
   * transitions to 'cancelled' only if *all* of its tests end up cancelled
   * (a partial cancel otherwise, order.status left as-is). `409` if zero
   * tests are eligible (already fully cancelled, or every test already
   * progressed past 'ordered') — a repeat cancel is a real conflict, not a
   * silent no-op.
   */
  @Post(':id/cancel')
  @HttpCode(200) // an action on an existing resource, not a creation -- NestJS's POST default (201) doesn't apply
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_orders')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'order.cancel', resourceType: 'order' })
  async cancel(
    @Param(new ZodValidationPipe(orderIdParamSchema)) { id }: OrderIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [orderRow] = await tx
      .select()
      .from(order)
      .where(eq(order.id, id))
      .limit(1);
    if (!orderRow) {
      throw new NotFoundException('Order not found');
    }

    const testsBefore = await tx
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.orderId, id));
    const eligibleIds = testsBefore
      .filter((t) => t.status === 'ordered')
      .map((t) => t.id);
    if (eligibleIds.length === 0) {
      throw new ConflictException(
        'No ordered tests are eligible for cancellation',
      );
    }

    const before = toOrderDto(orderRow, testsBefore);

    await tx
      .update(orderedTest)
      .set({ status: 'cancelled' })
      .where(inArray(orderedTest.id, eligibleIds));

    const allNowCancelled = testsBefore.every(
      (t) => eligibleIds.includes(t.id) || t.status === 'cancelled',
    );

    let afterOrderRow = orderRow;
    if (allNowCancelled) {
      const [updated] = await tx
        .update(order)
        .set({ status: 'cancelled' })
        .where(eq(order.id, id))
        .returning();
      afterOrderRow = updated;
    }

    const testsAfter = await tx
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.orderId, id));
    return {
      resourceId: id,
      before,
      after: toOrderDto(afterOrderRow, testsAfter),
    };
  }
}
