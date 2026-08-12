import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { checkStepUpFreshness } from './step-up-freshness';
import { StepUpRequiredException } from './step-up-required.exception';
import { STEP_UP_KEY } from './require-step-up.decorator';
import type { RequestWithAuthContext } from './jwt-auth.guard';

// Anchored to the realm's own accessTokenLifespan (300s,
// infra/keycloak/lis-realm.json), not an arbitrary separate value (proposal
// §5/§10 Q4).
export const STEP_UP_MAX_AGE_SECONDS = 300;

/**
 * Must run after JwtAuthGuard (needs request.authContext.authTime populated)
 * — apply both together on any route decorated with @RequireStepUp(), same
 * ordering CapabilityGuard already requires.
 *
 * Denies (403, step_up_required) whenever the caller's `auth_time` is older
 * than STEP_UP_MAX_AGE_SECONDS. A silent access-token refresh
 * (apps/web's getValidAccessToken()) never advances auth_time — only a real
 * interactive re-login does (client.buildAuthorizationUrl with
 * prompt: 'login', apps/web/app/api/auth/login/route.ts) — so this
 * genuinely requires the caller to have re-authenticated recently, not just
 * to hold a live session.
 *
 * A route with no @RequireStepUp() metadata is not gated at all (returns
 * true) — same opt-in shape as CapabilityGuard/JwtAuthGuard.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresStepUp = this.reflector.get<boolean | undefined>(
      STEP_UP_KEY,
      context.getHandler(),
    );
    if (!requiresStepUp) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    const now = Math.floor(Date.now() / 1000);
    const fresh = checkStepUpFreshness(
      request.authContext.authTime,
      now,
      STEP_UP_MAX_AGE_SECONDS,
    );
    if (!fresh) {
      throw new StepUpRequiredException();
    }

    return true;
  }
}
