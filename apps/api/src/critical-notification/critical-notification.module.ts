import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriticalNotificationController } from './critical-notification.controller';
import { CriticalNotificationEscalationService } from './critical-notification-escalation.service';

@Module({
  imports: [AuthModule],
  controllers: [CriticalNotificationController],
  providers: [CriticalNotificationEscalationService],
})
export class CriticalNotificationModule {}
