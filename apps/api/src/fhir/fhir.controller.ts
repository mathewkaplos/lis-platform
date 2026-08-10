import {
  Controller,
  Get,
  Inject,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { FhirObservationDataService } from './fhir-observation-data.service';
import { mapObservationToFhir } from './observation-mapper';

const observationIdParamSchema = z.object({ id: z.uuid() });
class ObservationIdParamDto extends createZodDto(observationIdParamSchema) {}

type Tx = RequestWithTx['tx'];

/**
 * FEAT-037 (KB-31: "FHIR is a facade over an ACL, not the internal model").
 * Unversioned (`/fhir/...`, not `/v1/...`) -- a deliberately separate
 * contract surface from this repo's own internal REST API, matching
 * `/auth`/`/health`'s existing precedent for routes outside the `/v1`
 * resource-contract namespace (`engineering/api-design` entry #3), extended
 * here for the same reason: FHIR conformance evolves independently of the
 * internal API's own versioning.
 *
 * Auth reuses the existing bearer-token mechanism (`JwtAuthGuard`) --
 * real SMART on FHIR (dynamic client registration, resource-scoped OAuth
 * scopes, launch context) is explicitly out of scope for this task
 * (proposal §10 Q3) and would need its own decision when a real third-party
 * app ecosystem is actually being built.
 */
@Controller('fhir')
export class FhirController {
  constructor(
    @Inject(FhirObservationDataService)
    private readonly dataService: FhirObservationDataService,
  ) {}

  @Get('Observation/:id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async getObservation(
    @Param(new ZodValidationPipe(observationIdParamSchema))
    { id }: ObservationIdParamDto,
    @DbTx() tx: Tx,
  ) {
    const data = await this.dataService.getObservationData(tx, id);
    return mapObservationToFhir(data);
  }
}
