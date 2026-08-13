import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WholeSlideImageController } from './whole-slide-image.controller';

@Module({
  imports: [AuthModule],
  controllers: [WholeSlideImageController],
})
export class WholeSlideImageModule {}
