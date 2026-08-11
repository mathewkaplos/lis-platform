import { KEYCLOAK_ISSUER_URL } from '../src/auth/keycloak-config';

/**
 * Client-credentials grant against the `lis-platform-analytics` client
 * (FEAT-056, ADR-0048) — the machine-token equivalent of
 * get-keycloak-token.ts's password grant, used by e2e specs that need a
 * real platform-analytics-issued token rather than a tenant-scoped human
 * user's, matching `get-gateway-token.ts`'s own shape.
 */
export async function getPlatformAnalyticsToken(): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'lis-platform-analytics',
        client_secret: 'dev-only-lis-platform-analytics-secret',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `failed to obtain a platform-analytics token: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}
