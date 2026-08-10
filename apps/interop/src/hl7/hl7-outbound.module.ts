import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OruGeneratorService } from './oru-generator.service';

@Module({
  imports: [AuthModule],
  providers: [OruGeneratorService],
  exports: [OruGeneratorService],
})
export class Hl7OutboundModule {}
