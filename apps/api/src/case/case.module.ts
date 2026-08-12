import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CaseController } from './case.controller';

@Module({
  imports: [AuthModule],
  controllers: [CaseController],
})
export class CaseModule {}
