import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferringFacilityController } from './referring-facility.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReferringFacilityController],
})
export class ReferringFacilityModule {}
