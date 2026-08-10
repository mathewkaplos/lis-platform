import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogController } from './catalog.controller';
import { ReferenceRangeController } from './reference-range.controller';
import { TestDefinitionController } from './test-definition.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogController,
    TestDefinitionController,
    ReferenceRangeController,
  ],
})
export class CatalogModule {}
