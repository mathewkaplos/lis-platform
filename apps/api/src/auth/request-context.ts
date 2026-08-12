/**
 * Resolved from a validated JWT by JwtAuthGuard. `roles` holds the caller's
 * Keycloak realm roles (TASK-032/ADR-0011) — empty for any user with no
 * realm role assigned, which CapabilityGuard treats as "grants nothing",
 * never as an unrestricted match.
 */
export interface RequestContext {
  sub: string;
  tenantId: string;
  roles: string[];
  // FEAT-059: epoch seconds from the token's `auth_time` claim — when the
  // caller last actually authenticated (password re-entry), not merely when
  // the current access token was issued/refreshed. A silent refresh-token
  // grant (apps/web's getValidAccessToken()) never advances this value; only
  // a real interactive re-login does. See StepUpGuard.
  authTime: number;
}
