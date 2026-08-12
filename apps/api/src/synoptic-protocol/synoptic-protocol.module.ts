import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SynopticProtocolController } from './synoptic-protocol.controller';

@Module({
  imports: [AuthModule],
  controllers: [SynopticProtocolController],
})
export class SynopticProtocolModule {}
