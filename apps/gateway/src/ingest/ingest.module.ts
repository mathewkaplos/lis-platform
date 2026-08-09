import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { IngestController } from './ingest.controller';

@Module({
  imports: [QueueModule],
  controllers: [IngestController],
})
export class IngestModule {}
