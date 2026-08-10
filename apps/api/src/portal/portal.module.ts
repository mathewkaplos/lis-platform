import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalResultsService } from './portal-results.service';

@Module({
  controllers: [PortalController],
  providers: [PortalResultsService],
})
export class PortalModule {}
