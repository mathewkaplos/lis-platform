import {
  Controller,
  Get,
  Param,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { assembleCumulativeReport } from './cumulative-report-assembly';
import { renderCumulativeReport } from './cumulative-report-render';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestContext } from '../auth/request-context';
import { CurrentUser } from '../auth/current-user.decorator';
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
}
