import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantCheckController } from './tenant-check.controller';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Module({
  controllers: [AuthController, TenantCheckController],
  providers: [JwtAuthGuard, TenantContextInterceptor],
  exports: [JwtAuthGuard, TenantContextInterceptor],
})
export class AuthModule {}
