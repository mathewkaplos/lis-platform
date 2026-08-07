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
  qcObservationSchema,
  qcResultEntrySchema,
  type QcObservationResult,
  type QcResultEntryInput,
} from '@lis/domain';
import { analyte, controlLot, observation } from '@lis/db';
import { and, desc, eq } from 'drizzle-orm';
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

const controlLotIdParamSchema = z.object({ id: z.uuid() });
class ControlLotIdParamDto extends createZodDto(controlLotIdParamSchema) {}
class QcObservationDto extends createZodDto(qcObservationSchema) {}

// Same "bind as a value, not via extends" workaround as ResultEntryDto in
// observation.controller.ts (engineering/api-design entry #14) --
// qcResultEntrySchema is the same discriminatedUnion, same gap.
const QcResultEntryDto = createZodDto(qcResultEntrySchema);
type QcResultEntryDto = InstanceType<typeof QcResultEntryDto>;

type Tx = RequestWithTx['tx'];
type QcObservationRow = typeof observation.$inferSelect;

function toQcObservationDto(row: QcObservationRow): QcObservationResult {
  return {
    id: row.id,
    // controlLotId is non-null on every row this controller ever reads or
    // writes (isControl = true rows only, ADR-0015) -- the ! mirrors
    // observation.controller.ts's own orderedTestId! for the patient-flow
    // rows it exclusively reads.
    controlLotId: row.controlLotId!,
    analyteId: row.analyteId,
    dataType: row.dataType as QcObservationResult['dataType'],
    valueNum: row.valueNum === null ? null : Number(row.valueNum),
    valueCode: row.valueCode,
    valueText: row.valueText,
    unit: row.unit,
    source: row.source,
    producedAt: row.producedAt ? row.producedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * TASK-064 (FEAT-018 revision). First real caller of ADR-0015's schema
 * (TASK-063) and the first real consumer of `control_lot`. Reuses the
 * `enter_result` capability (ADR-0015 Decision) -- same real-world actors
 * (technologist/verifier) perform QC runs as patient result entry, no
 * QC-specific capability exists or is needed yet.
 *
 * One route, not draft+finalize: a QC result is a new time-series
 * measurement every time (a control lot's Levey-Jennings history needs
 * every point, FEAT-019's later scope), not a single upsertable "current
 * result" the way a patient ordered-test analyte is -- so every POST is a
 * plain INSERT, never an UPDATE, and the route is audited unconditionally
 * (no unaudited "draft" concept applies here).
 */
@Controller('v1/control-lots/:id')
export class ControlLotController {
  /**
   * TASK-064 proposal §2: validates the control lot exists (RLS makes a
   * cross-tenant lot structurally invisible -- 404, per `engineering/
   * api-design` entry #7) and that the submitted dataType matches the lot's
   * own analyte, the same check `loadWriteContext` makes for patient results.
   */
  private async loadControlLot(
    tx: Tx,
    controlLotId: string,
    dataType: QcResultEntryInput['dataType'],
  ) {
    const [lotRow] = await tx
      .select()
      .from(controlLot)
      .where(eq(controlLot.id, controlLotId))
      .limit(1);
    if (!lotRow) {
      throw new NotFoundException('Control lot not found');
    }

    const [analyteRow] = await tx
      .select()
      .from(analyte)
      .where(eq(analyte.id, lotRow.analyteId))
      .limit(1);
    if (!analyteRow) {
      // Unreachable in practice (control_lot.analyteId carries a real FK to
      // analyte, ADR-0015 §2) -- a real inconsistency, not a validation gap.
      throw new BadRequestException(
        `Control lot ${controlLotId} has no associated analyte`,
      );
    }

    if (dataType !== analyteRow.dataType) {
      throw new BadRequestException(
        `dataType mismatch: analyte is '${analyteRow.dataType}', request was '${dataType}'`,
      );
    }

    return { lotRow, analyteRow };
  }

  /**
   * Records a new QC measurement. Audited unconditionally (proposal §5,
   * ADR-0015's own Consequences note that QC entry should be audited the
   * same way patient result entry is) -- there is no unaudited "draft" call
   * the way patient results have.
   */
  @Post('results')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'observation.qc_record', resourceType: 'observation' })
  async recordResult(
    @Param(new ZodValidationPipe(controlLotIdParamSchema))
    { id }: ControlLotIdParamDto,
    @Body(new ZodValidationPipe(qcResultEntrySchema)) body: QcResultEntryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<AuditedMutationResult & { after: QcObservationResult }> {
    const { lotRow, analyteRow } = await this.loadControlLot(
      tx,
      id,
      body.dataType,
    );

    const valueFields = {
      valueNum: body.dataType === 'quantity' ? String(body.valueNum) : null,
      valueCode: body.dataType === 'coded' ? body.valueCode : null,
      valueText: body.dataType === 'text' ? body.valueText : null,
    };

    const [inserted] = await tx
      .insert(observation)
      .values({
        tenantId: user.tenantId,
        isControl: true,
        controlLotId: lotRow.id,
        analyteId: analyteRow.id,
        dataType: body.dataType,
        ...valueFields,
        status: 'preliminary', // no draft concept for QC entry -- every write here is a complete, audited measurement
        source: 'manual',
        operatorUserId: user.sub,
        producedAt: new Date(),
      })
      .returning();

    const after = toQcObservationDto(inserted);
    // AuditInterceptor requires the handler return an AuditedMutationResult
    // (resourceId + before/after) -- same shape observation.controller.ts's
    // finalize()/verify() return, found the hard way here via a real 500
    // (writeAuditEvent's resourceId column is NOT NULL; a flat DTO with no
    // `resourceId` field left it undefined).
    return { resourceId: after.id, before: null, after };
  }

  /**
   * QC results for this control lot, most recent first -- proves FEAT-018's
   * literal AC ("QC results are queryable independently of patient
   * results"): this query is scoped entirely by `controlLotId`, with no
   * `orderedTestId`/`patientId` concept anywhere in its WHERE clause. No
   * `@Audit()` -- an unmutating read (`engineering/api-design` entry #6).
   */
  @Get('results')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [QcObservationDto], status: 200 })
  async listResults(
    @Param(new ZodValidationPipe(controlLotIdParamSchema))
    { id }: ControlLotIdParamDto,
    @DbTx() tx: Tx,
  ): Promise<QcObservationResult[]> {
    const [lotRow] = await tx
      .select({ id: controlLot.id })
      .from(controlLot)
      .where(eq(controlLot.id, id))
      .limit(1);
    if (!lotRow) {
      throw new NotFoundException('Control lot not found');
    }

    const rows = await tx
      .select()
      .from(observation)
      .where(
        and(eq(observation.isControl, true), eq(observation.controlLotId, id)),
      )
      .orderBy(desc(observation.producedAt), desc(observation.createdAt));

    return rows.map(toQcObservationDto);
  }
}
