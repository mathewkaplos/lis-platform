import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  operationalReportQuerySchema,
  rejectionRateReportSchema,
  tatReportSchema,
  workloadReportSchema,
  type RejectionRateReport,
  type TatReport,
  type WorkloadReport,
} from '@lis/domain';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import {
  computeRejectionRateReport,
  computeTatReport,
  computeWorkloadReport,
} from './operational-reports.service';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class OperationalReportQueryDto extends createZodDto(
  operationalReportQuerySchema,
) {}
class TatReportDto extends createZodDto(tatReportSchema) {}
class WorkloadReportDto extends createZodDto(workloadReportSchema) {}
class RejectionRateReportDto extends createZodDto(rejectionRateReportSchema) {}

/**
 * FEAT-034 (docs/plans/feat-034-operational-reports-tat-workload.md). Three
 * distinct routes, not one combined endpoint with a `type` discriminator
 * (proposal §5) -- KB-43's own "canned report catalog" framing treats TAT/
 * workload/rejection-rate as separate named reports. `from`/`to` both
 * required (400 if either is missing) -- an unbounded aggregate scan is a
 * real, different failure mode than the unbounded-list-query risk
 * `engineering/api-design` Skill entry #4 already guards elsewhere.
 *
 * Gated behind `view_operational_reports` (`qa` only, §10 Q1) -- "workload
 * by bench/analyst" is real, individual-staff-performance-shaped data, a
 * different sensitivity class from a purely clinical read (contrast `GET
 * .../prior`, ungated). Unaudited (`engineering/api-design` entry #6: reads
 * aren't audited).
 */
@Controller('v1/reports/operational')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@UseInterceptors(TenantContextInterceptor)
export class OperationalReportsController {
  @Get('tat')
  @RequireCapability('view_operational_reports')
  @ZodResponse({ type: TatReportDto, status: 200 })
  async tat(
    @Query(new ZodValidationPipe(operationalReportQuerySchema))
    query: OperationalReportQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<TatReport> {
    return computeTatReport(tx, { query });
  }

  @Get('workload')
  @RequireCapability('view_operational_reports')
  @ZodResponse({ type: WorkloadReportDto, status: 200 })
  async workload(
    @Query(new ZodValidationPipe(operationalReportQuerySchema))
    query: OperationalReportQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<WorkloadReport> {
    return computeWorkloadReport(tx, { query });
  }

  @Get('rejection-rate')
  @RequireCapability('view_operational_reports')
  @ZodResponse({ type: RejectionRateReportDto, status: 200 })
  async rejectionRate(
    @Query(new ZodValidationPipe(operationalReportQuerySchema))
    query: OperationalReportQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<RejectionRateReport> {
    return computeRejectionRateReport(tx, { query });
  }
}
