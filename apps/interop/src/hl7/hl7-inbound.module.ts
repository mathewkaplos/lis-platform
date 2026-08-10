import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrmInboundService } from './orm-inbound.service';

@Module({
  imports: [AuthModule],
  providers: [OrmInboundService],
  exports: [OrmInboundService],
})
export class Hl7InboundModule {}
