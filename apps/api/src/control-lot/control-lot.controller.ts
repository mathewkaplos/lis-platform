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
  evaluateWestgardRules,
  qcChartSchema,
  qcObservationSchema,
  qcResultEntrySchema,
  type QcChartResult,
  type QcObservationResult,
  type QcResultEntryInput,
  type QcRuleViolationResult,
  type WestgardRuleCode,
} from '@lis/domain';
import { analyte, controlLot, observation, qcRuleViolation } from '@lis/db';
import { and, desc, eq, gte, lte, ne, sql } from 'drizzle-orm';
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
class QcChartDto extends createZodDto(qcChartSchema) {}

// Same "bind as a value, not via extends" workaround as ResultEntryDto in
// observation.controller.ts (engineering/api-design entry #14) --
// qcResultEntrySchema is the same discriminatedUnion, same gap.
const QcResultEntryDto = createZodDto(qcResultEntrySchema);
type QcResultEntryDto = InstanceType<typeof QcResultEntryDto>;

type Tx = RequestWithTx['tx'];
type QcObservationRow = typeof observation.$inferSelect;
type ControlLotRow = typeof controlLot.$inferSelect;
export type QcRuleViolationRow = typeof qcRuleViolation.$inferSelect;

// Exported for QcRuleViolationController's own resolve() response (TASK-070)
// -- same shape, no reason to duplicate this mapping (mirrors
// critical-notification.controller.ts's own exported toCriticalNotificationDto
// precedent).
export function toQcRuleViolationDto(
  row: QcRuleViolationRow,
): QcRuleViolationResult {
  return {
    id: row.id,
    controlLotId: row.controlLotId,
    observationId: row.observationId,
    ruleCode: row.ruleCode as WestgardRuleCode,
    severity: row.severity as QcRuleViolationResult['severity'],
    detectedAt: row.detectedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedByUserId: row.resolvedByUserId,
  };
}

// ADR-0018 (TASK-067): the trailing window this lot's own history is
// evaluated over -- large enough for 10x (the longest-lookback rule), small
// enough to keep the query bounded rather than scanning a lot's entire
// history on every write.
const RULE_EVALUATION_HISTORY_LIMIT = 20;
// ADR-0018 §Decision 3: R-4s pairs with the nearest different-level result
// of the same analyte/instrument recorded in the prior 24 hours; no pairing
// (not a violation, not an error) when none exists in that window.
const SIBLING_LEVEL_PAIRING_WINDOW_HOURS = 24;

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
   * TASK-067 (FEAT-019, ADR-0018): evaluates the fixed Westgard multirule
   * set against `insertedObs` (the point just recorded) and persists any
   * fired violations, all within the caller's own transaction -- a rollback
   * anywhere in the request rolls back the violations too. Only meaningful
   * for quantity results (Westgard compares numeric values against a
   * mean/SD, which coded/text QC entries have no concept of) -- returns []
   * without evaluating for any other dataType, not a silent gap: control
   * lots exist for a single, fixed-dataType analyte (ADR-0015 §2), so this
   * only ever skips non-quantity analytes entirely, consistently.
   */
  private async evaluateAndPersistViolations(
    tx: Tx,
    lotRow: ControlLotRow,
    insertedObs: QcObservationRow,
  ): Promise<QcRuleViolationResult[]> {
    if (insertedObs.dataType !== 'quantity' || insertedObs.valueNum === null) {
      return [];
    }
    const newProducedAt = insertedObs.producedAt ?? insertedObs.createdAt;

    const historyRows = await tx
      .select({
        valueNum: observation.valueNum,
        producedAt: observation.producedAt,
        createdAt: observation.createdAt,
      })
      .from(observation)
      .where(
        and(
          eq(observation.isControl, true),
          eq(observation.controlLotId, lotRow.id),
        ),
      )
      .orderBy(desc(observation.producedAt), desc(observation.createdAt))
      .limit(RULE_EVALUATION_HISTORY_LIMIT);
    const history = historyRows
      .map((row) => ({
        value: Number(row.valueNum),
        producedAt: row.producedAt ?? row.createdAt,
      }))
      .reverse(); // oldest -> newest, per evaluateWestgardRules's own contract

    const windowStart = new Date(
      newProducedAt.getTime() -
        SIBLING_LEVEL_PAIRING_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const [sibling] = await tx
      .select({
        valueNum: observation.valueNum,
        siblingTargetMean: controlLot.targetMean,
        siblingTargetSd: controlLot.targetSd,
      })
      .from(observation)
      .innerJoin(controlLot, eq(controlLot.id, observation.controlLotId))
      .where(
        and(
          eq(observation.isControl, true),
          eq(controlLot.analyteId, lotRow.analyteId),
          sql`${controlLot.instrumentId} IS NOT DISTINCT FROM ${lotRow.instrumentId}`,
          ne(controlLot.level, lotRow.level),
          lte(observation.producedAt, newProducedAt),
          gte(observation.producedAt, windowStart),
        ),
      )
      .orderBy(desc(observation.producedAt))
      .limit(1);
    const siblingLevelZScore = sibling
      ? (Number(sibling.valueNum) - Number(sibling.siblingTargetMean)) /
        Number(sibling.siblingTargetSd)
      : null;

    const candidates = evaluateWestgardRules({
      history,
      targetMean: Number(lotRow.targetMean),
      targetSd: Number(lotRow.targetSd),
      siblingLevelZScore,
    });
    if (candidates.length === 0) {
      return [];
    }

    const insertedViolations = await tx
      .insert(qcRuleViolation)
      .values(
        candidates.map((candidate) => ({
          tenantId: insertedObs.tenantId,
          controlLotId: lotRow.id,
          observationId: insertedObs.id,
          // Same precision-mismatch fix as critical_notification's own
          // creation hook (TASK-065, database-design Skill entry #10): a
          // server-side subquery, never the JS-parsed `insertedObs.createdAt`
          // -- node-postgres truncates Postgres's microsecond timestamptz to
          // milliseconds, which breaks this composite FK's exact-equality
          // lookup if the JS value is written back.
          observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${insertedObs.id})`,
          ruleCode: candidate.ruleCode,
          severity: candidate.severity,
        })),
      )
      .returning();

    return insertedViolations.map(toQcRuleViolationDto);
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
  ): Promise<
    AuditedMutationResult & {
      after: QcObservationResult & { violations: QcRuleViolationResult[] };
    }
  > {
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

    // TASK-067 (ADR-0018 §Decision 2): evaluated in the same transaction as
    // the insert above -- a rollback anywhere in this request rolls back any
    // detected violations too.
    const violations = await this.evaluateAndPersistViolations(
      tx,
      lotRow,
      inserted,
    );

    const after = { ...toQcObservationDto(inserted), violations };
    // AuditInterceptor requires the handler return an AuditedMutationResult
    // (resourceId + before/after) -- same shape observation.controller.ts's
    // finalize()/verify() return, found the hard way here via a real 500
    // (writeAuditEvent's resourceId column is NOT NULL; a flat DTO with no
    // `resourceId` field left it undefined). Violations fold into this same
    // audit event's `after` payload rather than a second `@Audit()` write
    // (ADR-0018 §Decision 5, mirroring TASK-065's `criticalNotificationId`
    // precedent).
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

  /**
   * TASK-068 (FEAT-019 revision): the Levey-Jennings chart data for one
   * control lot -- mean/SD band + ordered points, each with its own z-score
   * and any TASK-067 violations, per Stitch §14.2/§14.4. Quantity-only: a
   * mean/SD band is meaningless for a coded/text control lot, the same
   * boundary `evaluateAndPersistViolations` already draws -- 400s rather
   * than silently returning an empty or nonsensical chart, matching
   * `loadControlLot`'s own dataType-mismatch 400 precedent. No `@Audit()` --
   * an unmutating read (`engineering/api-design` entry #6), same as
   * `listResults`.
   */
  @Get('chart')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: QcChartDto, status: 200 })
  async getChart(
    @Param(new ZodValidationPipe(controlLotIdParamSchema))
    { id }: ControlLotIdParamDto,
    @DbTx() tx: Tx,
  ): Promise<QcChartResult> {
    const [lotRow] = await tx
      .select()
      .from(controlLot)
      .where(eq(controlLot.id, id))
      .limit(1);
    if (!lotRow) {
      throw new NotFoundException('Control lot not found');
    }

    const [analyteRow] = await tx
      .select({ dataType: analyte.dataType })
      .from(analyte)
      .where(eq(analyte.id, lotRow.analyteId))
      .limit(1);
    if (analyteRow?.dataType !== 'quantity') {
      throw new BadRequestException(
        'Levey-Jennings charting is only meaningful for a quantity-dataType analyte',
      );
    }

    const observationRows = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.isControl, true),
          eq(observation.controlLotId, id),
          eq(observation.dataType, 'quantity'),
        ),
      )
      .orderBy(observation.producedAt, observation.createdAt); // oldest -> newest, a chart's own reading order

    const violationRows =
      observationRows.length === 0
        ? []
        : await tx
            .select()
            .from(qcRuleViolation)
            .where(eq(qcRuleViolation.controlLotId, id));
    const violationsByObservationId = new Map<
      string,
      QcRuleViolationResult[]
    >();
    for (const row of violationRows) {
      const dto = toQcRuleViolationDto(row);
      const existing = violationsByObservationId.get(dto.observationId);
      if (existing) {
        existing.push(dto);
      } else {
        violationsByObservationId.set(dto.observationId, [dto]);
      }
    }

    const targetMean = Number(lotRow.targetMean);
    const targetSd = Number(lotRow.targetSd);
    const points = observationRows
      .filter((row) => row.valueNum !== null)
      .map((row) => {
        const value = Number(row.valueNum);
        return {
          id: row.id,
          value,
          zScore: (value - targetMean) / targetSd,
          producedAt: row.producedAt ? row.producedAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
          violations: violationsByObservationId.get(row.id) ?? [],
        };
      });

    return {
      controlLotId: lotRow.id,
      analyteId: lotRow.analyteId,
      level: lotRow.level,
      targetMean,
      targetSd,
      points,
    };
  }
}
