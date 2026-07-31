import { KEYCLOAK_ISSUER_URL } from '../src/auth/keycloak-config';

/**
 * Real Keycloak, not a mocked JWKS — same "verify for real" standard as
 * rls-isolation-check.ts (real Postgres). Requires the local/CI Keycloak
 * service (TASK-028) to be up and the requested lis-realm.json user to
 * exist. Shared by every e2e spec that needs a real token (extracted once a
 * third spec needed the identical fetch, TASK-032).
 */
export async function getKeycloakToken(
  username: string,
  password: string,
): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'lis-web',
        username,
        password,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `failed to obtain a token for ${username}: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}
