import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinalizationRollupInterceptor } from './finalization-rollup.interceptor';
import { ObservationController } from './observation.controller';

@Module({
  imports: [AuthModule],
  controllers: [ObservationController],
  providers: [FinalizationRollupInterceptor],
})
export class ObservationModule {}
