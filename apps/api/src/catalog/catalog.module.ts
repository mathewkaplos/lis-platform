import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogController } from './catalog.controller';
import { InstrumentAnalyteMappingController } from './instrument-analyte-mapping.controller';
import { ReferenceRangeController } from './reference-range.controller';
import { TestDefinitionController } from './test-definition.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogController,
    TestDefinitionController,
    ReferenceRangeController,
    InstrumentAnalyteMappingController,
  ],
})
export class CatalogModule {}
