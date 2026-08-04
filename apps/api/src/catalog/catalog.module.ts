import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
