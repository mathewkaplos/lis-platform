import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  amrSurveillanceReportSchema,
  operationalReportQuerySchema,
  type AmrSurveillanceReport,
} from '@lis/domain';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { computeAmrSurveillanceReport } from './amr-surveillance.service';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class AmrSurveillanceQueryDto extends createZodDto(
  operationalReportQuerySchema,
) {}
class AmrSurveillanceReportDto extends createZodDto(
  amrSurveillanceReportSchema,
) {}

/**
 * FEAT-055 (docs/plans/feat-055-amr-surveillance-report.md, §10 Q2
 * approved: a standalone controller, not a fourth route on
 * `OperationalReportsController` -- this report is microbiology-specific
 * in a way TAT/workload/rejection-rate are not). Same
 * `view_operational_reports` capability gate and `from`/`to`-required
 * query shape as every other report in that controller family (proposal
 * §5: `operationalReportQuerySchema` reused directly, no new query
 * schema). Tenant-scoped only (RLS on `observation`) -- cross-tenant
 * de-identified aggregation is `FEAT-056`'s own separate scope.
 */
@Controller('v1/reports/amr-surveillance')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@UseInterceptors(TenantContextInterceptor)
export class AmrSurveillanceController {
  @Get()
  @RequireCapability('view_operational_reports')
  @ZodResponse({ type: AmrSurveillanceReportDto, status: 200 })
  async report(
    @Query(new ZodValidationPipe(operationalReportQuerySchema))
    query: AmrSurveillanceQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<AmrSurveillanceReport> {
    return computeAmrSurveillanceReport(tx, { query });
  }
}
