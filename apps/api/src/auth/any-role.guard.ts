import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestWithAuthContext } from './jwt-auth.guard';

/**
 * Issue #762. Denies (403) a caller with zero Keycloak realm roles.
 *
 * Several read routes are intentionally open to *any* authenticated staff
 * role rather than gated on one specific @RequireCapability — the org's own
 * identity (org-settings.controller.ts's `get()`), the patient list/detail
 * (legitimately read by technologist/pathologist/reception/lab_admin *and*
 * a scoped `clinician`, so no single capability fits without breaking one
 * of them), the dashboard worklist, and the order list/detail. That's a
 * real, deliberate design choice for genuine staff accounts (matching
 * `MicrobiologyCatalogController`'s own "informational, same class as
 * browsing the test catalog" precedent) — but a live pilot-readiness pass
 * found it also let a real Keycloak account with **no role assigned at
 * all** fully read the real worklist, org profile, and patient list
 * (confirmed live 2026-08-26 as `test-user-3`, a seeded no-role fixture).
 * That's a materially different case from "an authenticated staff member
 * with some role": a zero-role account is a new hire mid-onboarding, a
 * placeholder, or a leftover test fixture — never someone who should be
 * reading real patient names.
 *
 * Deliberately checks "has at least one role" rather than requiring a
 * specific capability, so it doesn't regress any role that currently reads
 * these routes without holding a narrower capability (e.g. `cashier` on the
 * order list, or `clinician`'s own already-scoped access to patients).
 * Must run after JwtAuthGuard (needs `request.authContext` populated).
 */
@Injectable()
export class AnyRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();
    if (request.authContext.roles.length === 0) {
      throw new ForbiddenException(
        'Your account has not been assigned a role yet — contact your administrator',
      );
    }
    return true;
  }
}
