import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderController } from './order.controller';
import { OrderCreationService } from './order-creation.service';

@Module({
  imports: [AuthModule],
  controllers: [OrderController],
  // FEAT-036 (ADR-0034): exported so InteropBridgeModule's own internal
  // write path reuses this exact service, not a second implementation.
  providers: [OrderCreationService],
  exports: [OrderCreationService],
})
export class OrderModule {}
