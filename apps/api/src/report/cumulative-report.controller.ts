import {
  Controller,
  Get,
  Inject,
  Param,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { assembleCumulativeReport } from './cumulative-report-assembly';
import { renderCumulativeReport } from './cumulative-report-render';
import { InferenceGatewayService } from '../ai/inference-gateway.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestContext } from '../auth/request-context';
import { CurrentUser } from '../auth/current-user.decorator';
import { db } from '../auth/db';
import { DbTx } from '../auth/db-tx.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const paramSchema = z.object({ patientId: z.uuid(), analyteId: z.uuid() });
class ParamDto extends createZodDto(paramSchema) {}

/**
 * FEAT-033 (docs/plans/feat-033-cumulative-clinical-reports.md finding #4,
 * §10 Q2 resolved: unaudited, not persisted). The first route in this repo
 * scoped to a whole patient across every one of their orders, not one
 * `ordered_test_id` -- no route prefix to nest under, hence the new
 * `v1/patients/:patientId/cumulative-report` resource path.
 *
 * Unmutating read (`engineering/api-design` entry #6) -- no `@Audit()`, no
 * `CapabilityGuard`/`@RequireCapability`, matching `observation.controller.ts`'s
 * own `prior()` precedent exactly (this proposal's own closest analog, not
 * `report.controller.ts`'s official-report precedent, which mutates/persists
 * a `report` row this feature deliberately does not).
 *
 * `StreamableFile`, not `@Res()` -- `report.controller.ts`'s own TASK-060
 * finding (a raw `@Res()` response can be sent before
 * `TenantContextInterceptor`'s own transaction commits) applies identically
 * here even though this route never writes; reusing the same safe shape
 * rather than re-deriving it.
 */
@Controller('v1/patients/:patientId/cumulative-report')
export class CumulativeReportController {
  constructor(
    @Inject(InferenceGatewayService)
    private readonly inferenceGateway: InferenceGatewayService,
  ) {}

  @Get(':analyteId')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async generate(
    @Param(new ZodValidationPipe(paramSchema))
    { patientId, analyteId }: ParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<StreamableFile> {
    const data = await assembleCumulativeReport(tx, {
      tenantId: user.tenantId,
      patientId,
      analyteId,
    });
    const { pdf } = await renderCumulativeReport(data);

    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="cumulative-report-${patientId}-${analyteId}.pdf"`,
    });
  }

  /**
   * FEAT-043: an AI-generated (deterministic, ADR-0037/FEAT-042 §10 Q1
   * inherited) prose summary of the same data `generate()` streams as a
   * PDF -- unmutating read, same "no `@Audit()`, no
   * `CapabilityGuard`/`@RequireCapability`" precedent as `generate()`
   * itself (this class's own header comment). `InferenceGatewayService
   * .invoke()` already audits the AI call (`actorType: 'ai'`).
   *
   * Pre-shapes `entries` to only the five fields the summary actually
   * needs (never `observationId`/`verifierUserId`, neither of which this
   * capability needs) before allowlisting the whole array -- belt-and-
   * suspenders with phi-minimization.ts's own deny-by-default mechanism,
   * which allowlists a field wholesale rather than recursing into array
   * elements (ai/governed-inference Skill).
   *
   * Deliberately does NOT use `TenantContextInterceptor`/`@DbTx()` -- same
   * reason `ObservationController.draftNarrative()` doesn't
   * (`engineering/database-design` entry #14): nesting
   * `InferenceGatewayService.invoke()`'s own transaction inside an
   * already-open one on the same pool deadlocks under `DB_POOL_MAX=1`.
   */
  @Get(':analyteId/summary')
  @UseGuards(JwtAuthGuard)
  async summary(
    @Param(new ZodValidationPipe(paramSchema))
    { patientId, analyteId }: ParamDto,
    @CurrentUser() user: RequestContext,
  ): Promise<{ summary: string }> {
    const { data } = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${user.tenantId}, true)`,
      );
      const dataResult = await assembleCumulativeReport(tx, {
        tenantId: user.tenantId,
        patientId,
        analyteId,
      });
      return { data: dataResult };
    });

    const entries = data.entries.map((entry) => ({
      value: entry.value,
      unit: entry.unit,
      flags: entry.flags,
      isCritical: entry.isCritical,
      producedAt: entry.producedAt,
    }));

    const result = await this.inferenceGateway.invoke({
      tenantId: user.tenantId,
      actorPrincipalId: user.sub,
      capability: 'summarization.cumulative-trend',
      prompt: `Summarize the verified result history for ${data.analyte.display}.`,
      context: { analyteDisplay: data.analyte.display, entries },
      allowedContextFields: ['analyteDisplay', 'entries'],
      resourceType: 'cumulative-report',
      resourceId: analyteId,
    });

    return { summary: result.output };
  }
}
