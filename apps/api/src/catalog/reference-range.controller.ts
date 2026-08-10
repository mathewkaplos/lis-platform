import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  referenceRangeCreateSchema,
  referenceRangeListSchema,
  type ReferenceRangeList,
  type ReferenceRangeResult,
} from '@lis/domain';
import { analyte, codeSystemValue, referenceRange, unit } from '@lis/db';
import { eq, inArray } from 'drizzle-orm';
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

class ReferenceRangeCreateDto extends createZodDto(
  referenceRangeCreateSchema,
) {}

const listQuerySchema = z.object({ analyteId: z.uuid().optional() });
class ListQueryDto extends createZodDto(listQuerySchema) {}
class ReferenceRangeListDto extends createZodDto(referenceRangeListSchema) {}

type ReferenceRangeRow = typeof referenceRange.$inferSelect;

function toResult(
  row: ReferenceRangeRow,
  analyteDisplay: string,
  unitDisplay: string | null,
): ReferenceRangeResult {
  return {
    id: row.id,
    analyteId: row.analyteId,
    analyteDisplay,
    unitId: row.unitId,
    unitDisplay,
    sex: row.sex,
    ageLowDays: row.ageLowDays,
    ageHighDays: row.ageHighDays,
    condition: row.condition,
    method: row.method,
    specimenType: row.specimenType,
    population: row.population,
    rangeType: row.rangeType,
    low: row.low === null ? null : Number(row.low),
    high: row.high === null ? null : Number(row.high),
    textualRange: row.textualRange,
    interpretationWhenIn: row.interpretationWhenIn,
    priority: row.priority,
    source: row.source,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). `reference_range`
 * already carries real versioning/effective-dating columns (TASK-018) --
 * this controller only exposes create + list over them, no schema change
 * (proposal finding #3). §10 Q3 (resolved: add-only): `POST` creates a new
 * row only, never mutates/closes an existing one's `effectiveTo` -- no
 * `PATCH`/archive route here.
 */
@Controller('v1/reference-ranges')
export class ReferenceRangeController {
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_catalog')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'reference_range.create', resourceType: 'reference_range' })
  async create(
    @Body(new ZodValidationPipe(referenceRangeCreateSchema))
    body: ReferenceRangeCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [analyteRow] = await tx
      .select({ id: analyte.id, display: analyte.display })
      .from(analyte)
      .where(eq(analyte.id, body.analyteId))
      .limit(1);
    if (!analyteRow) {
      throw new BadRequestException(`Unknown analyte id: ${body.analyteId}`);
    }
    const [unitRow] = await tx
      .select({ id: unit.id })
      .from(unit)
      .where(eq(unit.id, body.unitId))
      .limit(1);
    if (!unitRow) {
      throw new BadRequestException(`Unknown unit id: ${body.unitId}`);
    }

    const [row] = await tx
      .insert(referenceRange)
      .values({
        tenantId: user.tenantId,
        analyteId: body.analyteId,
        unitId: body.unitId,
        sex: body.sex,
        ageLowDays: body.ageLowDays,
        ageHighDays: body.ageHighDays,
        condition: body.condition,
        method: body.method,
        specimenType: body.specimenType,
        population: body.population,
        rangeType: body.rangeType,
        // drizzle's numeric() column round-trips as a string, not a JS
        // number (observed directly in report-assembly.ts's own reads --
        // `Number(row.refLow)` -- and report-assembly.e2e-spec.ts's own
        // fixture inserts, which pass '1'/'100' as strings).
        low: body.low === undefined ? undefined : String(body.low),
        high: body.high === undefined ? undefined : String(body.high),
        textualRange: body.textualRange,
        interpretationWhenIn: body.interpretationWhenIn,
        priority: body.priority,
        source: body.source,
        effectiveFrom: body.effectiveFrom
          ? new Date(body.effectiveFrom)
          : undefined,
      })
      .returning();

    const after = toResult(row, analyteRow.display, null);
    return { resourceId: row.id, before: null, after };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ status: 200, type: ReferenceRangeListDto })
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<ReferenceRangeList> {
    const rows = await tx
      .select()
      .from(referenceRange)
      .where(
        query.analyteId
          ? eq(referenceRange.analyteId, query.analyteId)
          : undefined,
      );

    const analyteIds = Array.from(new Set(rows.map((row) => row.analyteId)));
    const analyteRows =
      analyteIds.length > 0
        ? await tx
            .select({ id: analyte.id, display: analyte.display })
            .from(analyte)
            .where(inArray(analyte.id, analyteIds))
        : [];
    const analyteDisplayById = new Map(
      analyteRows.map((row) => [row.id, row.display]),
    );

    const unitIds = Array.from(new Set(rows.map((row) => row.unitId)));
    const unitRows =
      unitIds.length > 0
        ? await tx
            .select({
              id: unit.id,
              codeSystemValueId: unit.codeSystemValueId,
              displayOverride: unit.displayOverride,
            })
            .from(unit)
            .where(inArray(unit.id, unitIds))
        : [];
    const codeSystemValueIds = Array.from(
      new Set(unitRows.map((row) => row.codeSystemValueId)),
    );
    const codeSystemValueRows =
      codeSystemValueIds.length > 0
        ? await tx
            .select({ id: codeSystemValue.id, code: codeSystemValue.code })
            .from(codeSystemValue)
            .where(inArray(codeSystemValue.id, codeSystemValueIds))
        : [];
    const codeById = new Map(
      codeSystemValueRows.map((row) => [row.id, row.code]),
    );
    const unitDisplayById = new Map(
      unitRows.map((row) => [
        row.id,
        row.displayOverride ?? codeById.get(row.codeSystemValueId) ?? null,
      ]),
    );

    return {
      ranges: rows.map((row) =>
        toResult(
          row,
          analyteDisplayById.get(row.analyteId) ?? 'Unknown analyte',
          unitDisplayById.get(row.unitId) ?? null,
        ),
      ),
    };
  }
}
