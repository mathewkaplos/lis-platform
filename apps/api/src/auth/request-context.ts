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
}
