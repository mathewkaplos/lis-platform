import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalResultsService } from './portal-results.service';

@Module({
  controllers: [PortalController],
  // FEAT-038: exported so ClinicianModule's own results route reuses this
  // exact query, same ADR-0027-equivalent reasoning as every other cross-
  // module service export in this app.
  providers: [PortalResultsService],
  exports: [PortalResultsService],
})
export class PortalModule {}
