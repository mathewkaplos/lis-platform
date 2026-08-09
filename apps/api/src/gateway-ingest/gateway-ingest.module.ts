import { Module } from '@nestjs/common';
import { GatewayIngestController } from './gateway-ingest.controller';
import { GatewayIngestService } from './gateway-ingest.service';

@Module({
  controllers: [GatewayIngestController],
  providers: [GatewayIngestService],
})
export class GatewayIngestModule {}
