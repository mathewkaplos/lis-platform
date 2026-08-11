import { Module } from '@nestjs/common';
import { CultureReadController } from './culture-read.controller';
import { CultureReadDueDetectorService } from './culture-read-due-detector.service';

/**
 * FEAT-052 (ADR-0046). No `WorkflowModule` import needed here, unlike
 * `SlaModule`/`ReflexModule` -- this feature registers no new
 * `WorkflowCommandRegistry` command. The organism-ID reflex reuses
 * `AddReflexTest` unmodified (already registered by `ReflexModule`);
 * `CultureGrowthDetected`'s own outbox-event registration lives on
 * `WorkflowEngineService` directly (`workflow-engine.service.ts`), the same
 * module that already owns `SlaBreached`'s registration.
 */
@Module({
  controllers: [CultureReadController],
  providers: [CultureReadDueDetectorService],
})
export class CultureReadModule {}
