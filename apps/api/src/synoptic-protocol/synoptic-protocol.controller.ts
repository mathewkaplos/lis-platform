import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  synopticProtocolListSchema,
  synopticProtocolVersionSchema,
  synopticResponseCreateSchema,
  type SynopticProtocolList,
  type SynopticProtocolVersion,
} from '@lis/domain';
import {
  caseTable,
  codeSystemValue,
  orderedTest,
  synopticElement,
  synopticElementResponseOption,
  synopticProtocol,
  synopticProtocolVersion,
  unit,
} from '@lis/db';
import { eq, inArray } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { db } from '../auth/db';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { assembleAndPersistSynopticResponse } from './synoptic-response-recorder';

const idParamSchema = z.object({ id: z.uuid() });
const versionParamSchema = z.object({ id: z.uuid(), versionId: z.uuid() });

class SynopticProtocolListDto extends createZodDto(
  synopticProtocolListSchema,
) {}
class SynopticProtocolVersionDto extends createZodDto(
  synopticProtocolVersionSchema,
) {}
class SynopticResponseCreateDto extends createZodDto(
  synopticResponseCreateSchema,
) {}
class IdParamDto extends createZodDto(idParamSchema) {}
class VersionParamDto extends createZodDto(versionParamSchema) {}

/**
 * FEAT-058 (ADR-0050, docs/plans/feat-058-generic-synoptic-protocol-engine.md).
 * `/v1/synoptic-protocols` (global reference data, read-only in this
 * feature's own scope -- no admin/authoring UI, per issue #539) +
 * `/v1/cases/:id/synoptic-responses` (recording, per ADR-0049's own
 * per-Case grouping). No single-resource base path, matching
 * `case.controller.ts`'s own precedent for a controller spanning two
 * resource roots.
 *
 * `manage_specimens` gates the recording route, identical reasoning to
 * `case.controller.ts`'s own capability choice -- no dedicated pathologist
 * role exists in Keycloak yet. The two `GET` routes are ungated reference-
 * data reads with no `TenantContextInterceptor`/`@DbTx()` -- every table
 * they read is global with no RLS policy at all (ADR-0050), the identical
 * reasoning `microbiology-catalog.controller.ts` already established;
 * queries the raw `db` connection directly instead.
 */
@Controller()
export class SynopticProtocolController {
  @Get('v1/synoptic-protocols')
  @UseGuards(JwtAuthGuard)
  @ZodResponse({ type: SynopticProtocolListDto, status: 200 })
  async list(): Promise<SynopticProtocolList> {
    const rows = await db.select().from(synopticProtocol);
    // issue #642 (proposal §3.1): a caller (the new synoptic-recording UI)
    // needs to know which version of a protocol is currently published
    // without a direct DB query -- at most one published version can ever
    // exist per protocol (ux_synoptic_protocol_version_protocol_published).
    const publishedVersionRows = await db
      .select({
        synopticProtocolId: synopticProtocolVersion.synopticProtocolId,
        id: synopticProtocolVersion.id,
      })
      .from(synopticProtocolVersion)
      .where(eq(synopticProtocolVersion.status, 'published'));
    const publishedVersionIdByProtocolId = new Map(
      publishedVersionRows.map((row) => [row.synopticProtocolId, row.id]),
    );
    return {
      protocols: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        publishedVersionId: publishedVersionIdByProtocolId.get(row.id) ?? null,
      })),
    };
  }

  @Get('v1/synoptic-protocols/:id/versions/:versionId')
  @UseGuards(JwtAuthGuard)
  @ZodResponse({ type: SynopticProtocolVersionDto, status: 200 })
  async getVersion(
    @Param(new ZodValidationPipe(versionParamSchema))
    { id, versionId }: VersionParamDto,
  ): Promise<SynopticProtocolVersion> {
    const [versionRow] = await db
      .select()
      .from(synopticProtocolVersion)
      .where(eq(synopticProtocolVersion.id, versionId))
      .limit(1);
    if (!versionRow || versionRow.synopticProtocolId !== id) {
      throw new NotFoundException('Synoptic protocol version not found');
    }

    const elementRows = await db
      .select()
      .from(synopticElement)
      .where(eq(synopticElement.synopticProtocolVersionId, versionId));
    const elementIds = elementRows.map((e) => e.id);
    const optionRows =
      elementIds.length > 0
        ? await db
            .select()
            .from(synopticElementResponseOption)
            .where(
              inArray(
                synopticElementResponseOption.synopticElementId,
                elementIds,
              ),
            )
        : [];
    const optionsByElementId = new Map<string, typeof optionRows>();
    for (const row of optionRows) {
      const existing = optionsByElementId.get(row.synopticElementId) ?? [];
      existing.push(row);
      optionsByElementId.set(row.synopticElementId, existing);
    }

    // Issue #663: batch-resolve unitId -> display text, matching
    // observation-write.service.ts's own exact precedent
    // (displayOverride ?? codeSystemValue.code) for a different consumer of
    // the same unit/codeSystemValue tables.
    const unitIds = [
      ...new Set(
        elementRows
          .map((e) => e.unitId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const unitRows =
      unitIds.length > 0
        ? await db
            .select({
              id: unit.id,
              code: codeSystemValue.code,
              displayOverride: unit.displayOverride,
            })
            .from(unit)
            .innerJoin(
              codeSystemValue,
              eq(unit.codeSystemValueId, codeSystemValue.id),
            )
            .where(inArray(unit.id, unitIds))
        : [];
    const unitDisplayById = new Map(
      unitRows.map((row) => [row.id, row.displayOverride ?? row.code]),
    );

    return {
      ...versionRow,
      effectiveFrom: versionRow.effectiveFrom.toISOString(),
      effectiveTo: versionRow.effectiveTo
        ? versionRow.effectiveTo.toISOString()
        : null,
      status: versionRow.status as SynopticProtocolVersion['status'],
      elements: elementRows
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((element) => ({
          ...element,
          dataType:
            element.dataType as SynopticProtocolVersion['elements'][number]['dataType'],
          requirement:
            element.requirement as SynopticProtocolVersion['elements'][number]['requirement'],
          visibilityCondition:
            (element.visibilityCondition as SynopticProtocolVersion['elements'][number]['visibilityCondition']) ??
            null,
          unitDisplay: element.unitId
            ? (unitDisplayById.get(element.unitId) ?? null)
            : null,
          responseOptions: (optionsByElementId.get(element.id) ?? [])
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((o) => ({
              id: o.id,
              value: o.value,
              display: o.display,
              displayOrder: o.displayOrder,
            })),
        })),
    };
  }

  /**
   * ADR-0049 §Decision 3 (per-Case grouping) applied to recording: the case
   * is the addressed resource, but the Observations attach to a caller-
   * supplied `orderedTestId` that must belong to the case's own order
   * (proposal §5) -- no new case-level anchor OrderedTest is created here.
   *
   * No `@Audit()`/`AuditInterceptor` here -- `assembleAndPersistSynopticResponse`
   * already writes its own audit event inside the same transaction as its
   * inserts, the identical shape `antibiogram.controller.ts`'s own `record()`
   * already established; stacking `@Audit()` on top would double-write.
   */
  @Post('v1/cases/:id/synoptic-responses')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor)
  async recordResponses(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(synopticResponseCreateSchema))
    body: SynopticResponseCreateDto,
    @Req() request: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [caseRow] = await tx
      .select()
      .from(caseTable)
      .where(eq(caseTable.id, id))
      .limit(1);
    if (!caseRow) {
      throw new NotFoundException('Case not found');
    }

    const [orderedTestRow] = await tx
      .select({ orderId: orderedTest.orderId })
      .from(orderedTest)
      .where(eq(orderedTest.id, body.orderedTestId))
      .limit(1);
    if (!orderedTestRow || orderedTestRow.orderId !== caseRow.orderId) {
      throw new BadRequestException(
        `Ordered test ${body.orderedTestId} does not belong to case ${id}`,
      );
    }

    return assembleAndPersistSynopticResponse(tx, {
      tenantId: request.authContext.tenantId,
      orderedTestId: body.orderedTestId,
      synopticProtocolVersionId: body.synopticProtocolVersionId,
      responses: body.responses,
      actorPrincipalId: request.authContext.sub,
      actorRole: request.grantingRole,
    });
  }
}
