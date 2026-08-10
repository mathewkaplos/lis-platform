import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriticalNotificationModule } from '../critical-notification/critical-notification.module';
import { OrderModule } from '../order/order.module';
import { PortalModule } from '../portal/portal.module';
import { ClinicianController } from './clinician.controller';

@Module({
  // Reuses OrderModule's/CriticalNotificationModule's own exported "one
  // write path" services, and PortalModule's exported PortalResultsService
  // -- same ADR-0027-equivalent reasoning as InteropBridgeModule's own
  // import of OrderModule (FEAT-036).
  imports: [AuthModule, OrderModule, CriticalNotificationModule, PortalModule],
  controllers: [ClinicianController],
})
export class ClinicianModule {}
