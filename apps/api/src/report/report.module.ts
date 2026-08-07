import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportController } from './report.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportController],
})
export class ReportModule {}
