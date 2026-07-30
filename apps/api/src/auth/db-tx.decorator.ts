import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithTx } from './tenant-context.interceptor';

/**
 * Only valid on a route guarded by both JwtAuthGuard and
 * TenantContextInterceptor — the interceptor is what populates request.tx.
 * A handler must run its tenant-scoped queries through this transaction,
 * not a fresh db call, or it bypasses the SET LOCAL binding entirely.
 */
export const DbTx = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestWithTx['tx'] => {
    const request = ctx.switchToHttp().getRequest<RequestWithTx>();
    if (!request.tx) {
      throw new Error(
        '@DbTx() used on a route with no TenantContextInterceptor applied',
      );
    }
    return request.tx;
  },
);
