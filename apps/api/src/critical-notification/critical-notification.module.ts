import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CriticalNotificationController } from './critical-notification.controller';

@Module({
  imports: [AuthModule],
  controllers: [CriticalNotificationController],
})
export class CriticalNotificationModule {}
