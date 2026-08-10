import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { Hl7InboundModule } from './hl7/hl7-inbound.module';
import { Hl7OutboundModule } from './hl7/hl7-outbound.module';

@Module({
  imports: [AuthModule, Hl7InboundModule, Hl7OutboundModule],
  controllers: [AppController],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
