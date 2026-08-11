import { Module } from '@nestjs/common';
import { MicrobiologyCatalogController } from './microbiology-catalog.controller';

@Module({
  controllers: [MicrobiologyCatalogController],
})
export class MicrobiologyCatalogModule {}
