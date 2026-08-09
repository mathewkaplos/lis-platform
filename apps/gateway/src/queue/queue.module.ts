import { Module } from '@nestjs/common';
import { LocalQueueService } from './local-queue.service';

@Module({
  providers: [LocalQueueService],
  exports: [LocalQueueService],
})
export class QueueModule {}
