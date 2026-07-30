import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithAuthContext } from './jwt-auth.guard';
import type { RequestContext } from './request-context';

/**
 * Only valid on a route guarded by JwtAuthGuard — that guard is what
 * populates request.authContext. Using this decorator without the guard
 * throws immediately rather than silently returning undefined.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuthContext>();
    if (!request.authContext) {
      throw new Error(
        '@CurrentUser() used on a route with no JwtAuthGuard applied',
      );
    }
    return request.authContext;
  },
);
