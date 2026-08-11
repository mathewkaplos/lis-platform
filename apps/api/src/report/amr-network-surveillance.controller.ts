import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  networkAmrSurveillanceQuerySchema,
  networkAmrSurveillanceReportSchema,
  type NetworkAmrSurveillanceReport,
} from '@lis/domain';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { computeNetworkAmrSurveillanceReport } from './amr-network-surveillance.service';
import { db } from '../auth/db';
import { CapabilityGuard } from '../auth/capability.guard';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';

class NetworkAmrSurveillanceQueryDto extends createZodDto(
  networkAmrSurveillanceQuerySchema,
) {}
class NetworkAmrSurveillanceReportDto extends createZodDto(
  networkAmrSurveillanceReportSchema,
) {}

/**
 * FEAT-056 (docs/plans/feat-056-cross-tenant-deidentified-aggregation.md,
 * ADR-0048). `platform_analytics`-gated, machine-only (§10 Q2) -- this is
 * the first genuinely cross-tenant route in this codebase, so unlike every
 * other tenant-scoped controller it deliberately does NOT apply
 * `TenantContextInterceptor`: there is no single request tenant to bind,
 * only a machine caller's own JWT `tenant_id` claim (present because
 * `JwtAuthGuard` requires one on every token, same as every other client)
 * which this handler never reads. The service's own per-tenant iteration
 * opens its own real per-tenant transaction with `app.tenant_id`/
 * `search_path` bound correctly for each opted-in tenant in turn.
 */
@Controller('v1/reports/network-amr-surveillance')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class AmrNetworkSurveillanceController {
  @Get()
  @RequireCapability('platform_analytics')
  @ZodResponse({ type: NetworkAmrSurveillanceReportDto, status: 200 })
  async report(
    @Query(new ZodValidationPipe(networkAmrSurveillanceQuerySchema))
    query: NetworkAmrSurveillanceQueryDto,
    @Req() request: RequestWithGrantingRole,
  ): Promise<NetworkAmrSurveillanceReport> {
    return computeNetworkAmrSurveillanceReport(db, {
      query,
      requestedByPrincipalId: request.authContext.sub,
      requestedByRole: request.grantingRole,
    });
  }
}
