import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { CapabilityCheckController } from './capability-check.controller';
import { CapabilityGuard } from './capability.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TenantCheckController } from './tenant-check.controller';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Module({
  controllers: [
    AuthController,
    TenantCheckController,
    CapabilityCheckController,
  ],
  providers: [JwtAuthGuard, TenantContextInterceptor, CapabilityGuard],
  exports: [JwtAuthGuard, TenantContextInterceptor, CapabilityGuard],
})
export class AuthModule {}
