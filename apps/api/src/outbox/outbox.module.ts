import { Module } from '@nestjs/common';
import { OutboxHandlerRegistry } from './outbox-handler.registry';
import { OutboxRelayService } from './outbox-relay.service';

@Module({
  providers: [OutboxRelayService, OutboxHandlerRegistry],
  // Exported so a future feature (FEAT-029+) can register its own handlers
  // against the same registry instance, rather than a second one.
  exports: [OutboxHandlerRegistry],
})
export class OutboxModule {}
