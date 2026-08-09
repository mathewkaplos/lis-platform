import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ForwarderService } from './forwarder.service';
import { GatewayAuthService } from './gateway-auth.service';

@Module({
  imports: [QueueModule],
  providers: [ForwarderService, GatewayAuthService],
  exports: [ForwarderService],
})
export class ForwardModule {}
