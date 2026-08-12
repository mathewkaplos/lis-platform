import { ForbiddenException } from '@nestjs/common';

/**
 * FEAT-059. Distinct from a bare ForbiddenException (CapabilityGuard's own
 * "no role grants this capability" case) so ProblemDetailsFilter can surface
 * a machine-readable `code: 'step_up_required'` — apps/web's own sign-out
 * flow reacts to that specific code by redirecting into
 * `/api/auth/login?step_up=1`, not by treating this as an ordinary 403.
 */
export class StepUpRequiredException extends ForbiddenException {
  constructor(
    message = 'A fresh re-authentication is required for this action',
  ) {
    super(message);
  }
}
