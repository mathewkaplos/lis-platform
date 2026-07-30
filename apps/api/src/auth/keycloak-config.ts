/**
 * Single source of truth for the realm this API validates tokens against.
 * Matches infra/keycloak/lis-realm.json's realm name ("lis") and TASK-028's
 * local-dev/CI Keycloak service (both bind to localhost:8080). Staging sets
 * KEYCLOAK_ISSUER_URL to the docker-compose-internal "keycloak" hostname —
 * see infra/docker-compose.staging.yml.
 */
export const KEYCLOAK_ISSUER_URL =
  process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/lis';

export const KEYCLOAK_JWKS_URI = `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/certs`;
