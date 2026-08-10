import { Module } from '@nestjs/common';
import { ReportTemplateController } from './report-template.controller';

@Module({
  controllers: [ReportTemplateController],
})
export class ReportTemplateModule {}
