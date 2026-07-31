import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Capability } from './capabilities';
import { resolveGrantingRole } from './capabilities';
import { CAPABILITY_KEY } from './require-capability.decorator';
import type { RequestWithAuthContext } from './jwt-auth.guard';

export type RequestWithGrantingRole = RequestWithAuthContext & {
  grantingRole: string;
};

/**
 * Must run after JwtAuthGuard (needs request.authContext populated) — apply
 * both together, JwtAuthGuard first, on any route decorated with
 * @RequireCapability(...).
 *
 * Denies (403) whenever no role in the caller's token grants the route's
 * required capability. The empty-roles case (ADR-0011's explicit fail-closed
 * AC) is not special-cased — it is simply what resolveGrantingRole already
 * returns for a token with no matching role, same deny path as any other
 * caller who lacks the capability.
 *
 * A route with no @RequireCapability() metadata is not gated by this guard
 * at all (returns true) — same opt-in shape as JwtAuthGuard/
 * TenantContextInterceptor: every route that needs a capability check must
 * apply the decorator explicitly, nothing is enforced by default (FEAT-009
 * proposal §6).
 *
 * `@Inject(Reflector)` is explicit, not implicit-type-inferred, because this
 * repo's vitest configs (test/vitest.e2e.config.ts, vitest.config.ts) use
 * Vite's default esbuild transform, which strips decorators but does not
 * emit `design:paramtypes` reflection metadata — Nest's DI then resolves an
 * implicitly-typed constructor param to `undefined` at runtime instead of
 * throwing, which only surfaces once a real request reaches this guard (a
 * unit test that constructs the class directly, bypassing Nest's container,
 * never exercises this path). This is the first constructor-injected class
 * in this codebase; every guard/interceptor before it had a zero-arg
 * constructor, so this gap was real but previously unreachable.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const capability = this.reflector.get<Capability | undefined>(
      CAPABILITY_KEY,
      context.getHandler(),
    );
    if (!capability) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithGrantingRole>();
    const grantingRole = resolveGrantingRole(
      request.authContext.roles,
      capability,
    );
    if (!grantingRole) {
      throw new ForbiddenException(
        `No role grants the '${capability}' capability`,
      );
    }

    request.grantingRole = grantingRole;
    return true;
  }
}
