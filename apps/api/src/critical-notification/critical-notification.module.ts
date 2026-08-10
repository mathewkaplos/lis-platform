import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriticalAcknowledgeService } from './critical-acknowledge.service';
import { CriticalNotificationController } from './critical-notification.controller';
import { CriticalNotificationEscalationService } from './critical-notification-escalation.service';

@Module({
  imports: [AuthModule],
  controllers: [CriticalNotificationController],
  // FEAT-038 (ADR-0027-equivalent reasoning): exported so ClinicianModule's
  // own critical-acknowledge route reuses this exact write path.
  providers: [
    CriticalNotificationEscalationService,
    CriticalAcknowledgeService,
  ],
  exports: [CriticalAcknowledgeService],
})
export class CriticalNotificationModule {}
