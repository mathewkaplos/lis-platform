import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { FinalizationRollupInterceptor } from './finalization-rollup.interceptor';
import { ObservationController } from './observation.controller';
import { ObservationWriteService } from './observation-write.service';

@Module({
  // FEAT-042: AiModule for InferenceGatewayService (draft-narrative route).
  imports: [AuthModule, AiModule],
  controllers: [ObservationController],
  providers: [FinalizationRollupInterceptor, ObservationWriteService],
  // ADR-0027: exported so GatewayIngestModule (FEAT-027) can reuse the same
  // write path a human draft()/finalize() call uses, not a second copy.
  exports: [ObservationWriteService],
})
export class ObservationModule {}
