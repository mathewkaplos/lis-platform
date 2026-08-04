import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderController } from './order.controller';

@Module({
  imports: [AuthModule],
  controllers: [OrderController],
})
export class OrderModule {}
