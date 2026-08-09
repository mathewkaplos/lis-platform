import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { ForwardModule } from './forward/forward.module';
import { IngestModule } from './ingest/ingest.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [QueueModule, IngestModule, ForwardModule],
  controllers: [AppController],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
