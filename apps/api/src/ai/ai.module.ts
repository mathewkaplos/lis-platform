import { Module } from '@nestjs/common';
import { db } from '../auth/db';
import { InferenceGatewayService } from './inference-gateway.service';
import { selectProvider } from './provider-registry';

@Module({
  providers: [
    {
      provide: InferenceGatewayService,
      useFactory: () => new InferenceGatewayService(selectProvider(), db),
    },
  ],
  exports: [InferenceGatewayService],
})
export class AiModule {}
