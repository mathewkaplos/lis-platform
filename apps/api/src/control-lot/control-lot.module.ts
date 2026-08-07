import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ControlLotController } from './control-lot.controller';

@Module({
  imports: [AuthModule],
  controllers: [ControlLotController],
})
export class ControlLotModule {}
