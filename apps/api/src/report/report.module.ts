import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CumulativeReportController } from './cumulative-report.controller';
import { OperationalReportsController } from './operational-reports.controller';
import { ReportController } from './report.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    ReportController,
    CumulativeReportController,
    OperationalReportsController,
  ],
})
export class ReportModule {}
