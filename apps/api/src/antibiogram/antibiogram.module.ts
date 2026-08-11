import { Module } from '@nestjs/common';
import { AntibiogramController } from './antibiogram.controller';

@Module({
  controllers: [AntibiogramController],
})
export class AntibiogramModule {}
