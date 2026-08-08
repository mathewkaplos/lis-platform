import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QcRuleViolationController } from './qc-rule-violation.controller';

@Module({
  imports: [AuthModule],
  controllers: [QcRuleViolationController],
})
export class QcRuleViolationModule {}
