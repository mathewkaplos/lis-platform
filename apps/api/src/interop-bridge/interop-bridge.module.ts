import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { InteropBridgeController } from './interop-bridge.controller';
import { InteropOrderCorrelationService } from './interop-order-correlation.service';
import { InteropOruDataService } from './interop-oru-data.service';

@Module({
  // ADR-0034/ADR-0027-equivalent reasoning: reuses OrderModule's exported
  // OrderCreationService rather than a second, independent write path.
  imports: [OrderModule],
  controllers: [InteropBridgeController],
  providers: [InteropOrderCorrelationService, InteropOruDataService],
})
export class InteropBridgeModule {}
