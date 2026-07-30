/**
 * Resolved from a validated JWT by JwtAuthGuard. `roles` is always present but
 * currently always empty — the `lis-web` Keycloak client (TASK-028) does not
 * grant the `roles` client scope yet, since realm-role/capability modeling is
 * deliberately deferred to FEAT-009 (Authorization & audit), not invented here.
 */
export interface RequestContext {
  sub: string;
  tenantId: string;
  roles: string[];
}
