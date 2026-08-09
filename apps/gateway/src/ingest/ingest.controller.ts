import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { LocalQueueService } from '../queue/local-queue.service';
import { RawResultDto, rawResultSchema } from './ingest.schema';

@Controller('ingest')
export class IngestController {
  // Explicit @Inject: this repo's vitest configs use Vite's esbuild
  // transform, which strips decorators but does not emit
  // `design:paramtypes` metadata, so an implicit-typed constructor param
  // resolves to `undefined` under Nest's DI at runtime in tests (matches
  // apps/api's CapabilityGuard/GatewayIngestController precedent).
  constructor(
    @Inject(LocalQueueService) private readonly queue: LocalQueueService,
  ) {}

  /**
   * The common ingestion port every instrument driver calls (KB-29).
   * Enqueuing to the local durable queue *is* "persist the raw payload
   * verbatim before any parsing" (KB-29 step 1) -- the gateway acknowledges
   * receipt immediately (202) and forwards to the cloud core asynchronously
   * (ForwarderService), so a slow or unreachable cloud core never blocks or
   * loses an instrument's result.
   *
   * `@Body()` explicitly instantiates `new ZodValidationPipe(schema)`,
   * matching apps/api's `PatientController`/`GatewayIngestController`
   * precedent -- relying on the global `APP_PIPE` alone to infer the schema
   * from the DTO class's `design:paramtypes` metadata silently no-ops under
   * this repo's vitest esbuild transform.
   */
  @Post()
  @HttpCode(202)
  async ingest(
    @Body(new ZodValidationPipe(rawResultSchema)) body: RawResultDto,
  ) {
    const id = await this.queue.enqueue(body);
    return { status: 'queued', id };
  }
}
