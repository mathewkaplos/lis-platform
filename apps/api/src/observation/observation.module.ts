import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ObservationController } from './observation.controller';

@Module({
  imports: [AuthModule],
  controllers: [ObservationController],
})
export class ObservationModule {}
