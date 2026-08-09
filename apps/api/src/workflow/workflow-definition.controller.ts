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
import { workflowDefinition } from '@lis/db';
import { and, desc, eq, max } from 'drizzle-orm';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { validateWorkflowDefinition } from './workflow-guardrails';
import { workflowDefinitionCreateSchema } from './workflow-schemas';
import type { WorkflowRule } from './workflow-types';

type Tx = RequestWithTx['tx'];
type WorkflowDefinitionRow = typeof workflowDefinition.$inferSelect;

const idParamSchema = z.object({ id: z.uuid() });
class IdParamDto extends createZodDto(idParamSchema) {}
class WorkflowDefinitionCreateDto extends createZodDto(
  workflowDefinitionCreateSchema,
) {}

function toDto(row: WorkflowDefinitionRow) {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    rules: row.rules as WorkflowRule[],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * FEAT-029 (ADR-0029): workflow_definition CRUD -- deliberately not
 * `@Audit()`'d, matching this repo's own established convention for
 * catalog/configuration tables (delta_check_rule, instrument_analyte_
 * mapping, sla_target all lack it too) rather than a gap introduced here.
 * Gated by `manage_workflow` (`qa` only) -- a genuine new capability, not a
 * grant onto an existing human role (see capabilities.ts's own header
 * comment).
 */
@Controller('v1/workflow-definitions')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@UseInterceptors(TenantContextInterceptor)
export class WorkflowDefinitionController {
  @Post()
  @RequireCapability('manage_workflow')
  async create(
    @Body(new ZodValidationPipe(workflowDefinitionCreateSchema))
    body: WorkflowDefinitionCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const [{ maxVersion }] = await tx
      .select({ maxVersion: max(workflowDefinition.version) })
      .from(workflowDefinition)
      .where(eq(workflowDefinition.tenantId, user.tenantId));

    const [row] = await tx
      .insert(workflowDefinition)
      .values({
        tenantId: user.tenantId,
        version: (maxVersion ?? 0) + 1,
        status: 'draft',
        rules: body.rules,
      })
      .returning();

    return toDto(row);
  }

  /**
   * Runs the publish-time guardrail validator (KB-25/ADR-0029) -- the only
   * code path that ever sets `status: 'published'`, never bypassable by a
   * direct write. Archives any currently-published definition for this
   * tenant first (`ux_workflow_definition_tenant_published` allows at most
   * one), so this is the single atomic "swap the active rule set" action.
   */
  @Post(':id/publish')
  @HttpCode(200)
  @RequireCapability('manage_workflow')
  async publish(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const [existing] = await tx
      .select()
      .from(workflowDefinition)
      .where(eq(workflowDefinition.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException('Workflow definition not found');
    }
    if (existing.status === 'published') {
      throw new ConflictException('Workflow definition is already published');
    }

    const errors = validateWorkflowDefinition(existing.rules as WorkflowRule[]);
    if (errors.length > 0) {
      // A plain string message, not { message, errors } -- ProblemDetailsFilter's
      // generic HttpException branch only ever reads `.message` off a bare
      // exception's response body (see UnmatchedResultException's own header
      // comment for the identical gap, found the same way there: a custom
      // payload field is silently discarded in favor of the RFC 9457 shape
      // unless the exception gets its own filter branch, which a one-off
      // validation-error list doesn't warrant here).
      throw new BadRequestException(
        `Workflow definition failed guardrail validation: ${errors.join('; ')}`,
      );
    }

    await tx
      .update(workflowDefinition)
      .set({ status: 'archived' })
      .where(
        and(
          eq(workflowDefinition.tenantId, user.tenantId),
          eq(workflowDefinition.status, 'published'),
        ),
      );

    const [published] = await tx
      .update(workflowDefinition)
      .set({ status: 'published' })
      .where(eq(workflowDefinition.id, id))
      .returning();

    return toDto(published);
  }

  @Get()
  async list(@DbTx() tx: Tx) {
    const rows = await tx
      .select()
      .from(workflowDefinition)
      .orderBy(desc(workflowDefinition.createdAt));
    return rows.map(toDto);
  }
}
