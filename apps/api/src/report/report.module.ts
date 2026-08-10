import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { CumulativeReportController } from './cumulative-report.controller';
import { OperationalReportsController } from './operational-reports.controller';
import { ReportController } from './report.controller';

@Module({
  // FEAT-043: AiModule for InferenceGatewayService (cumulative-report summary route).
  imports: [AuthModule, AiModule],
  controllers: [
    ReportController,
    CumulativeReportController,
    OperationalReportsController,
  ],
})
export class ReportModule {}
