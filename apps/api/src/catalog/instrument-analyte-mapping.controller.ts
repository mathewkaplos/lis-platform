import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  instrumentAnalyteMappingCreateSchema,
  instrumentAnalyteMappingListSchema,
  type InstrumentAnalyteMappingList,
  type InstrumentAnalyteMappingResult,
} from '@lis/domain';
import {
  analyte,
  instrumentAnalyteMapping,
  unit,
  codeSystemValue,
} from '@lis/db';
import { eq, inArray } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
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

class InstrumentAnalyteMappingCreateDto extends createZodDto(
  instrumentAnalyteMappingCreateSchema,
) {}
class InstrumentAnalyteMappingListDto extends createZodDto(
  instrumentAnalyteMappingListSchema,
) {}

type InstrumentAnalyteMappingRow = typeof instrumentAnalyteMapping.$inferSelect;

/** Postgres unique_violation, per https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = '23505';

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } })?.cause?.code;
}

function pgConstraintName(err: unknown): string | undefined {
  return (err as { cause?: { constraint?: string } })?.cause?.constraint;
}

function toResult(
  row: InstrumentAnalyteMappingRow,
  analyteDisplay: string,
  unitDisplay: string | null,
): InstrumentAnalyteMappingResult {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    channelCode: row.channelCode,
    analyteId: row.analyteId,
    analyteDisplay,
    unitId: row.unitId,
    unitDisplay,
    conversionFactor: Number(row.conversionFactor),
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Issue #812 (docs/plans/task-812-instrument-analyte-mapping-admin-ui.md).
 * `instrument_analyte_mapping` already has a real, correct schema (draft/
 * published/archived lifecycle, a partial unique index on the published
 * (tenant, instrument, channel) triple) but no controller/route/UI --
 * mirrors `ReferenceRangeController`'s create-then-list shape exactly. §10
 * Q1 (resolved): `POST` creates a `published` mapping directly unless the
 * caller explicitly requests `draft`/`archived`. §10 Q2 (resolved,
 * add-only): no `PATCH`/archive route here -- a duplicate published
 * (tenant, instrument, channel) 409s rather than superseding.
 */
@Controller('v1/instrument-analyte-mappings')
export class InstrumentAnalyteMappingController {
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_catalog')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'instrument_analyte_mapping.create',
    resourceType: 'instrument_analyte_mapping',
  })
  async create(
    @Body(new ZodValidationPipe(instrumentAnalyteMappingCreateSchema))
    body: InstrumentAnalyteMappingCreateDto,
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
      .select({
        id: unit.id,
        codeSystemValueId: unit.codeSystemValueId,
        displayOverride: unit.displayOverride,
      })
      .from(unit)
      .where(eq(unit.id, body.unitId))
      .limit(1);
    if (!unitRow) {
      throw new BadRequestException(`Unknown unit id: ${body.unitId}`);
    }
    let unitDisplay = unitRow.displayOverride;
    if (!unitDisplay && unitRow.codeSystemValueId) {
      const [codeRow] = await tx
        .select({ code: codeSystemValue.code })
        .from(codeSystemValue)
        .where(eq(codeSystemValue.id, unitRow.codeSystemValueId))
        .limit(1);
      unitDisplay = codeRow?.code ?? null;
    }

    let row: InstrumentAnalyteMappingRow;
    try {
      [row] = await tx
        .insert(instrumentAnalyteMapping)
        .values({
          tenantId: user.tenantId,
          instrumentId: body.instrumentId,
          channelCode: body.channelCode,
          analyteId: body.analyteId,
          unitId: body.unitId,
          conversionFactor:
            body.conversionFactor === undefined
              ? undefined
              : String(body.conversionFactor),
          status: body.status ?? 'published',
        })
        .returning();
    } catch (err) {
      if (
        pgErrorCode(err) === UNIQUE_VIOLATION &&
        pgConstraintName(err) === 'ux_instrument_mapping_published'
      ) {
        throw new ConflictException(
          'A published mapping already exists for this instrument/channel — archive it first',
        );
      }
      throw err;
    }

    const after = toResult(row, analyteRow.display, unitDisplay);
    return { resourceId: row.id, before: null, after };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ status: 200, type: InstrumentAnalyteMappingListDto })
  async list(
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<InstrumentAnalyteMappingList> {
    const rows = await tx.select().from(instrumentAnalyteMapping);

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
      mappings: rows.map((row) =>
        toResult(
          row,
          analyteDisplayById.get(row.analyteId) ?? 'Unknown analyte',
          unitDisplayById.get(row.unitId) ?? null,
        ),
      ),
    };
  }
}
