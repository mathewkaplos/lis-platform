import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorklistController } from './worklist.controller';

@Module({
  imports: [AuthModule],
  controllers: [WorklistController],
})
export class WorklistModule {}
