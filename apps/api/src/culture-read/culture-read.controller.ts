import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  cultureReadSchema,
  recordCultureReadSchema,
  scheduleCultureReadSchema,
  type CultureReadResponse,
} from '@lis/domain';
import { cultureRead, orderedTest, writeOutboxEvent } from '@lis/db';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import type { AuditedMutationResult } from '../auth/audit.interceptor';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

// FEAT-052 (proposal §5/§10 Q2): a placeholder standard incubation window,
// same "placeholder, not partner-validated" framing every other clinical-
// adjacent constant in this codebase carries (e.g. sla-targets.sql's own
// turnaround minutes) -- not a real lab-validated incubation period.
const DEFAULT_INCUBATION_HOURS = 18;

const orderedTestIdParamSchema = z.object({ orderedTestId: z.uuid() });
const cultureReadIdParamSchema = z.object({ id: z.uuid() });

// Actual classes, not plain `z.infer<...>` type aliases -- Swagger's
// reflection-based OpenAPI generation reads the @Param() parameter's own
// runtime type (design:paramtypes), which a type alias erases entirely (it
// only sees a class/constructor). A plain type alias here silently produces
// an empty `parameters: []` in openapi.json -- confirmed by a real failed
// build (packages/sdk's generated client typed the path param as `never`)
// -- same `createZodDto` class shape every other param DTO in this
// controller (and qc-rule-violation.controller.ts's own `ViolationIdParamDto`
// precedent) already uses.
class OrderedTestIdParamDto extends createZodDto(orderedTestIdParamSchema) {}
class CultureReadIdParamDto extends createZodDto(cultureReadIdParamSchema) {}
class ScheduleCultureReadDto extends createZodDto(scheduleCultureReadSchema) {}
class RecordCultureReadDto extends createZodDto(recordCultureReadSchema) {}
class CultureReadDto extends createZodDto(cultureReadSchema) {}

type Tx = RequestWithTx['tx'];
type CultureReadRow = typeof cultureRead.$inferSelect;

function toCultureReadDto(row: CultureReadRow): CultureReadResponse {
  return {
    id: row.id,
    orderedTestId: row.orderedTestId,
    scheduledAt: row.scheduledAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    result: row.result as CultureReadResponse['result'],
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * FEAT-052 (docs/plans/feat-052-culture-workflow-reflex-cascade.md,
 * ADR-0046). Every endpoint here is a normal, human-initiated, audited
 * action -- no route on this controller is ever called by
 * CultureReadDueDetectorService or the workflow engine (ADR-0046 decision 4:
 * a culture read result is never something software records on its own).
 * Gated behind `enter_result`, the same capability every other result-entry-
 * adjacent action in this codebase already uses (control-lot.controller.ts's
 * own QC result entry, observation.controller.ts's draft/finalize) --
 * proposal §5's own stated assumption, not a new capability invented for
 * this one feature.
 */
@Controller()
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class CultureReadController {
  /**
   * Schedules a culture's one v1 read (proposal §5/§10 Q2: single-read
   * scope, approved as drafted -- a completed read is terminal, it never
   * creates a second row). A second call for the same ordered_test while an
   * incomplete read already exists is rejected, not silently reused --
   * unlike AddReflexTest's own idempotent insert-or-reuse (a system process
   * redelivering the same event), this is a direct human action; a second
   * "start incubation" call for the same panel is a real user error worth
   * surfacing, not something to paper over.
   */
  @Post('v1/ordered-tests/:orderedTestId/culture-reads')
  @HttpCode(201)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'culture_read.schedule', resourceType: 'culture_read' })
  async schedule(
    @Param(new ZodValidationPipe(orderedTestIdParamSchema))
    { orderedTestId }: OrderedTestIdParamDto,
    @Body(new ZodValidationPipe(scheduleCultureReadSchema))
    body: ScheduleCultureReadDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<AuditedMutationResult & { after: CultureReadResponse }> {
    const [ot] = await tx
      .select({ id: orderedTest.id })
      .from(orderedTest)
      .where(eq(orderedTest.id, orderedTestId))
      .limit(1);
    if (!ot) {
      throw new NotFoundException(`ordered_test ${orderedTestId} not found`);
    }

    const [existingIncomplete] = await tx
      .select({ id: cultureRead.id })
      .from(cultureRead)
      .where(
        and(
          eq(cultureRead.orderedTestId, orderedTestId),
          isNull(cultureRead.completedAt),
        ),
      )
      .limit(1);
    if (existingIncomplete) {
      throw new BadRequestException(
        `ordered_test ${orderedTestId} already has a scheduled, unrecorded culture read`,
      );
    }

    const scheduledAt = body.scheduledAt
      ? new Date(body.scheduledAt)
      : new Date(Date.now() + DEFAULT_INCUBATION_HOURS * 60 * 60 * 1000);

    const [inserted] = await tx
      .insert(cultureRead)
      .values({
        tenantId: user.tenantId,
        orderedTestId,
        scheduledAt,
      })
      .returning();

    const after = toCultureReadDto(inserted);
    return { resourceId: inserted.id, after };
  }

  /**
   * "Cultures due for reading" worklist -- ADR-0046 decision 3's own live
   * query over `culture_read` rows where `scheduledAt <= now() AND
   * completedAt IS NULL`, not a separate list-maintenance mechanism. Reads
   * `culture_read` directly, independent of whether
   * CultureReadDueDetectorService has ticked yet -- its own `CultureReadDue`
   * outbox event is an audited fact-of-record, not this list's data source.
   */
  @Get('v1/culture-reads')
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [CultureReadDto], status: 200 })
  async listDue(@DbTx() tx: Tx): Promise<CultureReadResponse[]> {
    const rows = await tx
      .select()
      .from(cultureRead)
      .where(
        and(
          isNull(cultureRead.completedAt),
          lte(cultureRead.scheduledAt, new Date()),
        ),
      )
      .orderBy(asc(cultureRead.scheduledAt));
    return rows.map(toCultureReadDto);
  }

  /**
   * Records a culture read's result -- always a human-initiated action
   * (ADR-0046 decision 4). On `result: 'growth'`, emits a
   * `CultureGrowthDetected` outbox event in the same transaction as the
   * completion write -- the metadata-driven reflex cascade
   * (`AddReflexTest`, unmodified, dispatched by a published
   * `workflow_definition` rule reacting to this event) is what creates the
   * next-step organism-ID `ordered_test`, not this handler directly. Never
   * emitted for `'no_growth'` -- same "only emit once the fact is real"
   * precedent `SlaBreachDetectorService` already established for
   * `SlaBreached`.
   */
  @Post('v1/culture-reads/:id/record')
  @HttpCode(200) // an action on an existing resource, not a creation
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'culture_read.record', resourceType: 'culture_read' })
  async record(
    @Param(new ZodValidationPipe(cultureReadIdParamSchema))
    { id }: CultureReadIdParamDto,
    @Body(new ZodValidationPipe(recordCultureReadSchema))
    body: RecordCultureReadDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<
    AuditedMutationResult & {
      before: CultureReadResponse;
      after: CultureReadResponse;
    }
  > {
    const [existing] = await tx
      .select()
      .from(cultureRead)
      .where(eq(cultureRead.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException(`culture_read ${id} not found`);
    }
    if (existing.completedAt) {
      throw new BadRequestException(
        `culture_read ${id} already recorded -- cannot re-record (v1: exactly one read per culture)`,
      );
    }

    const [updated] = await tx
      .update(cultureRead)
      .set({
        completedAt: new Date(),
        result: body.result,
        recordedBy: user.sub,
      })
      .where(eq(cultureRead.id, id))
      .returning();

    if (body.result === 'growth') {
      await writeOutboxEvent(tx, {
        tenantId: user.tenantId,
        eventType: 'CultureGrowthDetected',
        payload: {
          orderedTestId: existing.orderedTestId,
          result: 'growth',
        },
      });
    }

    return {
      resourceId: updated.id,
      before: toCultureReadDto(existing),
      after: toCultureReadDto(updated),
    };
  }
}
