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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  reportTemplateCreateSchema,
  reportTemplateListSchema,
  reportTemplateResultSchema,
  reportTemplateVersionCreateSchema,
  reportTemplateVersionResultSchema,
  type ReportTemplateDefinition,
  type ReportTemplateList,
  type ReportTemplateResult,
  type ReportTemplateVersionResult,
} from '@lis/domain';
import { reportTemplate, reportTemplateVersion, testAnalyte } from '@lis/db';
import { and, eq, max } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { validateReportTemplateDefinition } from './report-template-guardrails';

type Tx = RequestWithTx['tx'];
type TemplateRow = typeof reportTemplate.$inferSelect;
type VersionRow = typeof reportTemplateVersion.$inferSelect;

const idParamSchema = z.object({ id: z.uuid() });
class IdParamDto extends createZodDto(idParamSchema) {}
const versionIdParamSchema = z.object({ id: z.uuid(), versionId: z.uuid() });
class VersionIdParamDto extends createZodDto(versionIdParamSchema) {}
class ReportTemplateCreateDto extends createZodDto(
  reportTemplateCreateSchema,
) {}
class ReportTemplateVersionCreateDto extends createZodDto(
  reportTemplateVersionCreateSchema,
) {}
class ReportTemplateVersionResultDto extends createZodDto(
  reportTemplateVersionResultSchema,
) {}
class ReportTemplateResultDto extends createZodDto(
  reportTemplateResultSchema,
) {}
class ReportTemplateListDto extends createZodDto(reportTemplateListSchema) {}

function toVersionDto(row: VersionRow): ReportTemplateVersionResult {
  return {
    id: row.id,
    reportTemplateId: row.reportTemplateId,
    version: row.version,
    status: row.status as ReportTemplateVersionResult['status'],
    definition: row.definition as ReportTemplateDefinition,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTemplateDto(
  row: TemplateRow,
  versions: VersionRow[],
): ReportTemplateResult {
  return {
    id: row.id,
    testDefinitionId: row.testDefinitionId,
    createdAt: row.createdAt.toISOString(),
    versions: versions.map(toVersionDto),
  };
}

async function loadValidAnalyteIds(
  tx: Tx,
  testDefinitionId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ analyteId: testAnalyte.analyteId })
    .from(testAnalyte)
    .where(eq(testAnalyte.testDefinitionId, testDefinitionId));
  return new Set(rows.map((row) => row.analyteId));
}

/**
 * FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md).
 * report_template/report_template_version CRUD + publish -- mirrors
 * `workflow-definition.controller.ts`'s exact shape (proposal finding #5):
 * deliberately not `@Audit()`'d, matching that same established convention
 * for catalog/configuration tables. Gated by `manage_report_templates`
 * (`qa` only), the identical reasoning `manage_workflow` already used.
 *
 * API/JSON authoring only (§10 Q2, resolved) -- no `apps/web` screen in this
 * proposal's scope.
 */
@Controller('v1/report-templates')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@UseInterceptors(TenantContextInterceptor)
export class ReportTemplateController {
  @Post()
  @RequireCapability('manage_report_templates')
  @ZodResponse({ type: ReportTemplateResultDto, status: 201 })
  async create(
    @Body(new ZodValidationPipe(reportTemplateCreateSchema))
    body: ReportTemplateCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<ReportTemplateResult> {
    const [existing] = await tx
      .select({ id: reportTemplate.id })
      .from(reportTemplate)
      .where(
        and(
          eq(reportTemplate.tenantId, user.tenantId),
          eq(reportTemplate.testDefinitionId, body.testDefinitionId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictException(
        `A report template already exists for test definition ${body.testDefinitionId} -- use POST /v1/report-templates/:id/versions to add a new version instead`,
      );
    }

    const [templateRow] = await tx
      .insert(reportTemplate)
      .values({
        tenantId: user.tenantId,
        testDefinitionId: body.testDefinitionId,
      })
      .returning();

    const [versionRow] = await tx
      .insert(reportTemplateVersion)
      .values({
        tenantId: user.tenantId,
        reportTemplateId: templateRow.id,
        version: 1,
        status: 'draft',
        definition: body.definition,
      })
      .returning();

    return toTemplateDto(templateRow, [versionRow]);
  }

  @Post(':id/versions')
  @RequireCapability('manage_report_templates')
  @ZodResponse({ type: ReportTemplateVersionResultDto, status: 201 })
  async createVersion(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(reportTemplateVersionCreateSchema))
    body: ReportTemplateVersionCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<ReportTemplateVersionResult> {
    const [templateRow] = await tx
      .select()
      .from(reportTemplate)
      .where(eq(reportTemplate.id, id))
      .limit(1);
    if (!templateRow) {
      throw new NotFoundException('Report template not found');
    }

    const [{ maxVersion }] = await tx
      .select({ maxVersion: max(reportTemplateVersion.version) })
      .from(reportTemplateVersion)
      .where(eq(reportTemplateVersion.reportTemplateId, id));

    const [versionRow] = await tx
      .insert(reportTemplateVersion)
      .values({
        tenantId: user.tenantId,
        reportTemplateId: id,
        version: (maxVersion ?? 0) + 1,
        status: 'draft',
        definition: body.definition,
      })
      .returning();

    return toVersionDto(versionRow);
  }

  /**
   * Runs the publish-time analyte-binding guardrail (KB-12) -- the only
   * code path that ever sets `status: 'published'`, never bypassable by a
   * direct write. Archives any currently-published version for this
   * template first (`ux_report_template_version_template_published` allows
   * at most one), the same single atomic "swap the active version" action
   * `workflow-definition.controller.ts`'s own `publish()` already
   * established.
   */
  @Post(':id/versions/:versionId/publish')
  @HttpCode(200)
  @RequireCapability('manage_report_templates')
  @ZodResponse({ type: ReportTemplateVersionResultDto, status: 200 })
  async publish(
    @Param(new ZodValidationPipe(versionIdParamSchema))
    { id, versionId }: VersionIdParamDto,
    @DbTx() tx: Tx,
  ): Promise<ReportTemplateVersionResult> {
    const [templateRow] = await tx
      .select()
      .from(reportTemplate)
      .where(eq(reportTemplate.id, id))
      .limit(1);
    if (!templateRow) {
      throw new NotFoundException('Report template not found');
    }

    const [versionRow] = await tx
      .select()
      .from(reportTemplateVersion)
      .where(
        and(
          eq(reportTemplateVersion.id, versionId),
          eq(reportTemplateVersion.reportTemplateId, id),
        ),
      )
      .limit(1);
    if (!versionRow) {
      throw new NotFoundException('Report template version not found');
    }
    if (versionRow.status === 'published') {
      throw new ConflictException(
        'Report template version is already published',
      );
    }

    const validAnalyteIds = await loadValidAnalyteIds(
      tx,
      templateRow.testDefinitionId,
    );
    const errors = validateReportTemplateDefinition(
      versionRow.definition as ReportTemplateDefinition,
      validAnalyteIds,
    );
    if (errors.length > 0) {
      // Plain string message, not { message, errors } -- ProblemDetailsFilter's
      // generic HttpException branch only reads `.message`, same gap
      // UnmatchedResultException/WorkflowDefinitionController's own publish()
      // already found and worked around the same way.
      throw new BadRequestException(
        `Report template version failed guardrail validation: ${errors.join('; ')}`,
      );
    }

    await tx
      .update(reportTemplateVersion)
      .set({ status: 'archived' })
      .where(
        and(
          eq(reportTemplateVersion.reportTemplateId, id),
          eq(reportTemplateVersion.status, 'published'),
        ),
      );

    const [published] = await tx
      .update(reportTemplateVersion)
      .set({ status: 'published' })
      .where(eq(reportTemplateVersion.id, versionId))
      .returning();

    return toVersionDto(published);
  }

  @Get()
  @ZodResponse({ type: ReportTemplateListDto, status: 200 })
  async list(@DbTx() tx: Tx): Promise<ReportTemplateList> {
    const templates = await tx.select().from(reportTemplate);
    const versions = await tx.select().from(reportTemplateVersion);
    const versionsByTemplateId = new Map<string, VersionRow[]>();
    for (const version of versions) {
      const bucket = versionsByTemplateId.get(version.reportTemplateId) ?? [];
      bucket.push(version);
      versionsByTemplateId.set(version.reportTemplateId, bucket);
    }
    return {
      templates: templates.map((template) =>
        toTemplateDto(template, versionsByTemplateId.get(template.id) ?? []),
      ),
    };
  }
}
