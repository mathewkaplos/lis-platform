import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { rawResultSchema, rawResultIdempotencyKey } from '@lis/domain';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import { GatewayIngestService } from './gateway-ingest.service';

class RawResultDto extends createZodDto(rawResultSchema) {}

/**
 * The cloud-core side of the edge gateway's forwarder (FEAT-026,
 * ADR-0026). Deliberately thin for this phase: dedupe + acknowledge only —
 * no Observation is written here yet. Per the FEAT-026 proposal §5/§9, this
 * feature's scope stops before the result-pipeline hand-off; mapping a raw
 * result into a structured Observation (range resolution, delta, critical
 * detection, QC gate, auto-verify) is FEAT-027's scope, once a real
 * instrument driver exists to produce real mapped values.
 *
 * `TenantContextInterceptor`/RLS are intentionally not applied here — no
 * tenant-scoped table is written by this route in this phase.
 *
 * `@Body()` below explicitly instantiates `new ZodValidationPipe(schema)` —
 * never relies on the global `APP_PIPE` alone to infer the schema from the
 * DTO class's `design:paramtypes` metadata. Same documented gap as
 * `PatientController`'s identical header comment: vitest's esbuild
 * transform doesn't emit that metadata, which silently no-ops
 * metatype-based DTO detection under the e2e test harness (a malformed body
 * reached this handler unvalidated, returning 202 instead of 400, until
 * this was made explicit).
 */
@Controller('internal/gateway')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class GatewayIngestController {
  // Explicit @Inject, not an implicit-typed constructor param -- this
  // repo's vitest configs use Vite's esbuild transform, which strips
  // decorators but does not emit `design:paramtypes` metadata, so Nest's DI
  // resolves an implicit-typed param to `undefined` at runtime (only
  // reachable once a real request hits the route, never in a unit test that
  // constructs the class directly). Same gotcha CapabilityGuard's own
  // constructor already documents and works around.
  constructor(
    @Inject(GatewayIngestService)
    private readonly service: GatewayIngestService,
  ) {}

  @Post('ingest')
  @HttpCode(202)
  @RequireCapability('gateway_ingest')
  ingest(@Body(new ZodValidationPipe(rawResultSchema)) body: RawResultDto) {
    const key = rawResultIdempotencyKey(body);
    const duplicate = this.service.isDuplicate(key);
    this.service.record(key);
    return { status: 'accepted', idempotencyKey: key, duplicate };
  }
}
