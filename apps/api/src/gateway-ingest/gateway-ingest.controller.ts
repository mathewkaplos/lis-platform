import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { rawResultSchema } from '@lis/domain';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { GatewayIngestService } from './gateway-ingest.service';
import { UnmatchedResultException } from './unmatched-result.exception';

class RawResultDto extends createZodDto(rawResultSchema) {}

type Tx = RequestWithTx['tx'];

/**
 * The cloud-core side of the edge gateway's forwarder (FEAT-026/FEAT-027,
 * ADR-0026/ADR-0027). Correlates a raw analyzer result to a real
 * `orderedTest`/`analyte` pair (`AnalyzerCorrelationService`, KB-29 steps
 * 3-5) and writes it through the same `ObservationWriteService` a human
 * `draft()` call uses (ADR-0027) -- identical range resolution, delta
 * check, and critical detection. Dedupes via `observation_idempotency_key`
 * (a real, DB-enforced unique constraint — FEAT-026's in-memory stub is
 * gone).
 *
 * `TenantContextInterceptor` is now applied (unlike FEAT-026's stub) --
 * this route writes real tenant-scoped rows (`observation`,
 * `observation_idempotency_key`) as of FEAT-027.
 *
 * An unmatched result (KB-29: "park in a pending-match queue rather than
 * being dropped") returns 422, not a write. No special "distinguishable
 * from a hard failure" response shape is needed on top of that: the
 * gateway's own forwarder (`ForwarderService.forwardOne`,
 * `apps/gateway/src/forward/forwarder.service.ts`) already treats *every*
 * non-2xx response identically — leave the item queued, retry next
 * interval — so a plain 422 already gets the "reuse the existing
 * queue/retry" behavior the FEAT-027 proposal's §10 Q2 resolution asked
 * for, with no forwarder change required.
 *
 * `@Body()` below explicitly instantiates `new ZodValidationPipe(schema)` —
 * never relies on the global `APP_PIPE` alone to infer the schema from the
 * DTO class's `design:paramtypes` metadata (same documented vitest/esbuild
 * gap as `PatientController`/FEAT-026's own version of this controller).
 */
@Controller('internal/gateway')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class GatewayIngestController {
  // Explicit @Inject, not an implicit-typed constructor param -- see
  // CapabilityGuard's own header comment for why (vitest esbuild
  // design:paramtypes gap).
  constructor(
    @Inject(GatewayIngestService)
    private readonly service: GatewayIngestService,
  ) {}

  @Post('ingest')
  @HttpCode(202)
  @RequireCapability('gateway_ingest')
  @UseInterceptors(TenantContextInterceptor)
  async ingest(
    @Body(new ZodValidationPipe(rawResultSchema)) body: RawResultDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ) {
    const result = await this.service.ingest(tx, user.tenantId, user.sub, body);
    if (!result.matched) {
      throw new UnmatchedResultException(result.reason);
    }
    return {
      status: 'accepted',
      idempotencyKey: result.idempotencyKey,
      duplicate: result.duplicate,
      observationId: result.observationId,
    };
  }
}
