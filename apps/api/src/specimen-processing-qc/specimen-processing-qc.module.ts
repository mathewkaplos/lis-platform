import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpecimenProcessingQcController } from './specimen-processing-qc.controller';

@Module({
  imports: [AuthModule],
  controllers: [SpecimenProcessingQcController],
})
export class SpecimenProcessingQcModule {}
