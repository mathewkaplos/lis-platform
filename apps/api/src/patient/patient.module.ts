import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PatientController } from './patient.controller';

@Module({
  imports: [AuthModule],
  controllers: [PatientController],
})
export class PatientModule {}
