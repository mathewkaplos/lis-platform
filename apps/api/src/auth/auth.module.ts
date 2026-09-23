import { Module } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
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
    // Issue #827: CapabilityCheckController exists purely to prove the
    // audit/capability-guard mechanism for capability-check.e2e-spec.ts --
    // several of its routes insert real patient/order rows. Gated the same
    // way main.ts already gates the Swagger docs route (NODE_ENV !==
    // 'production'), rather than leaving a second, inconsistent pattern for
    // test-only surface area in this codebase.
    ...(process.env.NODE_ENV !== 'production'
      ? [CapabilityCheckController]
      : []),
  ],
  providers: [
    JwtAuthGuard,
    TenantContextInterceptor,
    CapabilityGuard,
    AuditInterceptor,
  ],
  exports: [
    JwtAuthGuard,
    TenantContextInterceptor,
    CapabilityGuard,
    AuditInterceptor,
  ],
})
export class AuthModule {}
