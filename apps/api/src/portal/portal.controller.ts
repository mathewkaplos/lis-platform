import {
  Controller,
  Get,
  Inject,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  portalResultsResponseSchema,
  type PortalResultsResponse,
} from '@lis/domain';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { resolveOwnPatientId } from './patient-self-scope';
import { PortalResultsService } from './portal-results.service';

class PortalResultsResponseDto extends createZodDto(
  portalResultsResponseSchema,
) {}

type Tx = RequestWithTx['tx'];

/**
 * FEAT-039: the patient portal's own-data-only results/trends read (KB-32:
 * "own-data-only... enforced server-side"). `view_own_results` (RBAC) +
 * `resolveOwnPatientId` (ABAC, `patient_portal_account`) together --
 * proposal §10 Q3.
 */
@Controller('v1/portal')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class PortalController {
  constructor(
    @Inject(PortalResultsService)
    private readonly resultsService: PortalResultsService,
  ) {}

  @Get('results')
  @RequireCapability('view_own_results')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: PortalResultsResponseDto, status: 200 })
  async getResults(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<PortalResultsResponse> {
    const patientId = await resolveOwnPatientId(tx, user.sub);
    if (!patientId) {
      // Not enrolled yet (proposal §5: no self-service enrollment ships in
      // this task) -- a real, valid state, not an error.
      return { analytes: [] };
    }
    const analytes = await this.resultsService.getResultsForPatient(
      tx,
      user.tenantId,
      patientId,
    );
    return { analytes };
  }
}
