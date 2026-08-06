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
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  observationSchema,
  resultEntrySchema,
  type ObservationResult,
  type ResultEntryInput,
} from '@lis/domain';
import {
  analyte,
  codeSystemValue,
  computeFlags,
  observation,
  order,
  orderedTest,
  patient,
  resolveObservationRange,
  specimenFulfillment,
  testAnalyte,
  unit,
} from '@lis/db';
import { and, eq } from 'drizzle-orm';
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

const orderedTestIdParamSchema = z.object({ id: z.uuid() });
const resultParamSchema = z.object({ id: z.uuid(), analyteId: z.uuid() });

class OrderedTestIdParamDto extends createZodDto(orderedTestIdParamSchema) {}
class ResultParamDto extends createZodDto(resultParamSchema) {}
class ObservationDto extends createZodDto(observationSchema) {}

// `class X extends createZodDto(resultEntrySchema) {}` fails to typecheck
// for a discriminatedUnion (its inferred type is a union of object types,
// not one the `extends` clause can resolve to a single base) -- real gap
// found during TASK-052 (the OpenAPI doc silently had no request body for
// either write route below, `requestBody?: never` in the generated SDK
// schema, since `@Body() body: ResultEntryInput`'s plain type alias gives
// `@nestjs/swagger`'s reflection nothing to introspect). Fixed the same way
// nestjs-zod's own docs show for non-extendable schemas: bind the DTO as a
// value, not via `extends`, then alias the type to its instance shape --
// `@nestjs/swagger` reflects the real runtime class either way.
const ResultEntryDto = createZodDto(resultEntrySchema);
type ResultEntryDto = InstanceType<typeof ResultEntryDto>;

type Tx = RequestWithTx['tx'];
type ObservationRow = typeof observation.$inferSelect;

const ENTERABLE_ORDERED_TEST_STATUSES = ['received', 'in_process'] as const;

function toObservationDto(row: ObservationRow): ObservationResult {
  return {
    id: row.id,
    orderedTestId: row.orderedTestId,
    analyteId: row.analyteId,
    dataType: row.dataType as ObservationResult['dataType'], // restricted to this task's 3 dataTypes by the write path itself
    valueNum: row.valueNum === null ? null : Number(row.valueNum),
    valueCode: row.valueCode,
    valueText: row.valueText,
    unit: row.unit,
    refLow: row.refLow === null ? null : Number(row.refLow),
    refHigh: row.refHigh === null ? null : Number(row.refHigh),
    refCondition: row.refCondition,
    refSource: row.refSource,
    flags: row.flags,
    status: row.status as ObservationResult['status'], // this task only ever writes 'registered'/'preliminary'
    producedAt: row.producedAt ? row.producedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * TASK-051 (FEAT-014 revision). First real writer to `observation` — the
 * schema every prior FEAT-014 task treats as the system's central table.
 * `enter_result` capability already existed (TASK-032, proven ahead of any
 * real feature needing it) — this is its first real consumer, no new
 * capability or ADR needed (proposal §1 finding #1).
 *
 * Two write routes per analyte, not one with a `status` body field (proposal
 * §10 Q1): `PUT .../results/:analyteId` (draft, unaudited, live flags) and
 * `POST .../results/:analyteId/finalize` (audited). NestJS's `@Audit()`
 * decorator applies per method, not per call — splitting the routes is the
 * only way to audit finalize without also auditing every high-frequency
 * autosave, without inventing a manual `writeAuditEvent()` call this repo
 * has never used elsewhere.
 *
 * Every `@Body()`/`@Query()`/`@Param()` below explicitly instantiates `new
 * ZodValidationPipe(schema)`, matching every other controller in this repo
 * (`engineering/api-design` entry #8).
 */
@Controller('v1/ordered-tests/:id')
export class ObservationController {
  /**
   * Shared by both write routes (proposal §2): resolves and validates the
   * orderedTest/analyte/specimen/patient context a result write needs.
   * Throws the same errors either route would need to throw on its own.
   */
  private async loadWriteContext(
    tx: Tx,
    orderedTestId: string,
    analyteId: string,
    body: ResultEntryInput,
  ) {
    const [orderedTestRow] = await tx
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.id, orderedTestId))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!orderedTestRow) {
      throw new NotFoundException('Ordered test not found');
    }

    if (
      !ENTERABLE_ORDERED_TEST_STATUSES.includes(
        orderedTestRow.status as (typeof ENTERABLE_ORDERED_TEST_STATUSES)[number],
      )
    ) {
      throw new ConflictException(
        `Ordered test status '${orderedTestRow.status}' does not accept result entry (must be 'received' or 'in_process')`,
      );
    }

    const [analyteRow] = await tx
      .select()
      .from(analyte)
      .where(eq(analyte.id, analyteId))
      .limit(1);
    if (!analyteRow) {
      throw new BadRequestException(`Unknown analyte id: ${analyteId}`);
    }

    const [linkRow] = await tx
      .select({ id: testAnalyte.id })
      .from(testAnalyte)
      .where(
        and(
          eq(testAnalyte.testDefinitionId, orderedTestRow.testDefinitionId),
          eq(testAnalyte.analyteId, analyteId),
        ),
      )
      .limit(1);
    if (!linkRow) {
      throw new BadRequestException(
        `Analyte ${analyteId} is not part of this ordered test's test definition`,
      );
    }

    if (body.dataType !== analyteRow.dataType) {
      throw new BadRequestException(
        `dataType mismatch: analyte is '${analyteRow.dataType}', request was '${body.dataType}'`,
      );
    }

    const [fulfillmentRow] = await tx
      .select({ specimenId: specimenFulfillment.specimenId })
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.orderedTestId, orderedTestId))
      .limit(1);
    if (!fulfillmentRow) {
      // Should be unreachable given the status guard above (TASK-047 only
      // ever sets 'received' when a specimen_fulfillment row is created in
      // the same transaction) -- a real inconsistency, not a validation gap.
      throw new ConflictException(
        'Ordered test has no associated specimen (specimen_fulfillment) despite its status',
      );
    }

    const [orderRow] = await tx
      .select({ patientId: order.patientId })
      .from(order)
      .where(eq(order.id, orderedTestRow.orderId))
      .limit(1);
    if (!orderRow) {
      throw new ConflictException('Ordered test has no associated order');
    }

    const [patientRow] = await tx
      .select({ sex: patient.sex, birthDate: patient.birthDate })
      .from(patient)
      .where(eq(patient.id, orderRow.patientId))
      .limit(1);
    if (!patientRow) {
      throw new ConflictException('Order has no associated patient');
    }

    return {
      orderedTestRow,
      analyteRow,
      specimenId: fulfillmentRow.specimenId,
      patientId: orderRow.patientId,
      patientSex: patientRow.sex as 'M' | 'F' | 'U',
      patientBirthDate: patientRow.birthDate,
    };
  }

  /**
   * `resolveObservationRange`/`computeFlags` (TASK-049/050) run on every
   * write, draft or final (proposal §5) -- live flags, not deferred. Only
   * `'quantity'` gets a resolved range; `'coded'`/`'text'` have no
   * reference-range concept (KB-15).
   */
  private async resolveRangeAndFlags(
    tx: Tx,
    body: ResultEntryInput,
    analyteRow: typeof analyte.$inferSelect,
    patientSex: 'M' | 'F' | 'U',
    patientBirthDate: Date | null,
    at: Date,
  ) {
    if (body.dataType !== 'quantity' || !analyteRow.defaultUnitId) {
      return {
        flags: [] as string[],
        unitId: null as string | null,
        unitDisplay: null as string | null,
        refLow: null,
        refHigh: null,
        refCondition: null,
        refSource: null,
      };
    }

    const [unitRow] = await tx
      .select({
        code: codeSystemValue.code,
        displayOverride: unit.displayOverride,
      })
      .from(unit)
      .innerJoin(
        codeSystemValue,
        eq(unit.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(unit.id, analyteRow.defaultUnitId))
      .limit(1);

    const range = await resolveObservationRange(tx, {
      analyteId: analyteRow.id,
      unitId: analyteRow.defaultUnitId,
      patientSex,
      patientBirthDate,
      at,
    });
    const flags = computeFlags(body.valueNum, range.normal, range.critical);

    return {
      flags,
      unitId: analyteRow.defaultUnitId,
      unitDisplay: unitRow ? (unitRow.displayOverride ?? unitRow.code) : null,
      refLow: range.normal.matched ? range.normal.low : null,
      refHigh: range.normal.matched ? range.normal.high : null,
      refCondition: range.normal.matched ? range.normal.condition : null,
      refSource: range.normal.matched ? range.normal.source : null,
    };
  }

  private async upsertObservation(
    tx: Tx,
    params: {
      tenantId: string;
      orderedTestId: string;
      analyteId: string;
      patientId: string;
      specimenId: string;
      operatorUserId: string;
      status: 'registered' | 'preliminary';
      body: ResultEntryInput;
      flags: string[];
      unitId: string | null;
      unitDisplay: string | null;
      refLow: string | null;
      refHigh: string | null;
      refCondition: string | null;
      refSource: string | null;
    },
  ): Promise<ObservationRow> {
    const [existing] = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, params.orderedTestId),
          eq(observation.analyteId, params.analyteId),
        ),
      )
      .limit(1);

    const valueFields = {
      valueNum:
        params.body.dataType === 'quantity'
          ? String(params.body.valueNum)
          : null,
      valueCode:
        params.body.dataType === 'coded' ? params.body.valueCode : null,
      valueText: params.body.dataType === 'text' ? params.body.valueText : null,
    };

    const sharedFields = {
      dataType: params.body.dataType,
      ...valueFields,
      unitId: params.unitId,
      unit: params.unitDisplay,
      refLow: params.refLow,
      refHigh: params.refHigh,
      refCondition: params.refCondition,
      refSource: params.refSource,
      flags: params.flags,
      status: params.status,
      operatorUserId: params.operatorUserId,
      producedAt: new Date(),
    };

    if (existing) {
      const [updated] = await tx
        .update(observation)
        .set(sharedFields)
        .where(
          and(
            eq(observation.id, existing.id),
            eq(observation.createdAt, existing.createdAt),
          ),
        )
        .returning();
      return updated;
    }

    const [inserted] = await tx
      .insert(observation)
      .values({
        tenantId: params.tenantId,
        orderedTestId: params.orderedTestId,
        analyteId: params.analyteId,
        specimenId: params.specimenId,
        patientId: params.patientId,
        source: 'manual',
        ...sharedFields,
      })
      .returning();
    return inserted;
  }

  /**
   * Draft save: `status: 'registered'` (proposal §1 finding #2), no
   * `@Audit()`, upserts in place (an `UPDATE`, not a new row per save --
   * Constitution invariant #2 scopes append-only to *verified* data, which
   * this isn't yet). Advances `orderedTest.status` `'received' →
   * 'in_process'` on the first draft only.
   */
  @Put('results/:analyteId')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: ObservationDto, status: 200 })
  async draft(
    @Param(new ZodValidationPipe(resultParamSchema))
    { id, analyteId }: ResultParamDto,
    @Body(new ZodValidationPipe(resultEntrySchema)) body: ResultEntryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<ObservationResult> {
    const ctx = await this.loadWriteContext(tx, id, analyteId, body);
    const at = new Date();
    const rangeAndFlags = await this.resolveRangeAndFlags(
      tx,
      body,
      ctx.analyteRow,
      ctx.patientSex,
      ctx.patientBirthDate,
      at,
    );

    const row = await this.upsertObservation(tx, {
      tenantId: user.tenantId,
      orderedTestId: id,
      analyteId,
      patientId: ctx.patientId,
      specimenId: ctx.specimenId,
      operatorUserId: user.sub,
      status: 'registered',
      body,
      ...rangeAndFlags,
    });

    if (ctx.orderedTestRow.status === 'received') {
      await tx
        .update(orderedTest)
        .set({ status: 'in_process' })
        .where(eq(orderedTest.id, id));
    }

    return toObservationDto(row);
  }

  /**
   * Finalize: `status: 'preliminary'` (proposal §1 finding #2), audited.
   * Accepts the same body as draft (a keyboard-only user can type-and-
   * finalize in one call, no prior draft required — FEAT-014's own AC).
   * Advances `orderedTest.status → 'resulted'` once every analyte named by
   * this ordered test's own `test_analyte` rows has a `'preliminary'`
   * observation (proposal §2) — the last analyte to finalize is the one
   * that flips it, not a separate whole-panel submit action (KB-03 names
   * none).
   */
  @Post('results/:analyteId/finalize')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'observation.finalize', resourceType: 'observation' })
  async finalize(
    @Param(new ZodValidationPipe(resultParamSchema))
    { id, analyteId }: ResultParamDto,
    @Body(new ZodValidationPipe(resultEntrySchema)) body: ResultEntryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const ctx = await this.loadWriteContext(tx, id, analyteId, body);
    const at = new Date();

    const [existingBefore] = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, id),
          eq(observation.analyteId, analyteId),
        ),
      )
      .limit(1);
    const before = existingBefore ? toObservationDto(existingBefore) : null;

    const rangeAndFlags = await this.resolveRangeAndFlags(
      tx,
      body,
      ctx.analyteRow,
      ctx.patientSex,
      ctx.patientBirthDate,
      at,
    );

    const row = await this.upsertObservation(tx, {
      tenantId: user.tenantId,
      orderedTestId: id,
      analyteId,
      patientId: ctx.patientId,
      specimenId: ctx.specimenId,
      operatorUserId: user.sub,
      status: 'preliminary',
      body,
      ...rangeAndFlags,
    });

    const requiredLinks = await tx
      .select({ analyteId: testAnalyte.analyteId })
      .from(testAnalyte)
      .where(
        eq(testAnalyte.testDefinitionId, ctx.orderedTestRow.testDefinitionId),
      );
    const requiredAnalyteIds = requiredLinks.map((link) => link.analyteId);

    const finalizedObservations = await tx
      .select({ analyteId: observation.analyteId })
      .from(observation)
      .where(
        and(
          eq(observation.orderedTestId, id),
          eq(observation.status, 'preliminary'),
        ),
      );
    const finalizedAnalyteIds = new Set(
      finalizedObservations.map((o) => o.analyteId),
    );

    const allFinalized = requiredAnalyteIds.every((requiredId) =>
      finalizedAnalyteIds.has(requiredId),
    );
    if (allFinalized) {
      await tx
        .update(orderedTest)
        .set({ status: 'resulted' })
        .where(eq(orderedTest.id, id));
    }

    return {
      resourceId: row.id,
      before,
      after: toObservationDto(row),
    };
  }

  /** Read: current observations (draft and final) for TASK-052's grid UI.
   * No `@Audit()` -- an unmutating read (`engineering/api-design` entry #6:
   * only mutating, operationally significant actions are audited). */
  @Get('results')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [ObservationDto], status: 200 })
  async list(
    @Param(new ZodValidationPipe(orderedTestIdParamSchema))
    { id }: OrderedTestIdParamDto,
    @DbTx() tx: Tx,
  ): Promise<ObservationResult[]> {
    const [orderedTestRow] = await tx
      .select({ id: orderedTest.id })
      .from(orderedTest)
      .where(eq(orderedTest.id, id))
      .limit(1);
    if (!orderedTestRow) {
      throw new NotFoundException('Ordered test not found');
    }
    const rows = await tx
      .select()
      .from(observation)
      .where(eq(observation.orderedTestId, id));
    return rows.map(toObservationDto);
  }
}
