import { Module } from '@nestjs/common';
import { ObservationModule } from '../observation/observation.module';
import { AnalyzerCorrelationService } from './analyzer-correlation.service';
import { GatewayIngestController } from './gateway-ingest.controller';
import { GatewayIngestService } from './gateway-ingest.service';

@Module({
  // ADR-0027: reuses ObservationModule's exported ObservationWriteService
  // rather than a second, independent write implementation.
  imports: [ObservationModule],
  controllers: [GatewayIngestController],
  providers: [GatewayIngestService, AnalyzerCorrelationService],
})
export class GatewayIngestModule {}
