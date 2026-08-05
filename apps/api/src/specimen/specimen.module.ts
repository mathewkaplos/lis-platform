import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpecimenController } from './specimen.controller';

@Module({
  imports: [AuthModule],
  controllers: [SpecimenController],
})
export class SpecimenModule {}
