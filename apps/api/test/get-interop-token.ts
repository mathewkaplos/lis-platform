import { KEYCLOAK_ISSUER_URL } from '../src/auth/keycloak-config';

/**
 * Client-credentials grant against the `lis-interop` client (ADR-0035) —
 * the interop-side equivalent of get-gateway-token.ts, used by e2e specs
 * that need a real `apps/interop`-issued token rather than a human user's.
 */
export async function getInteropToken(): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'lis-interop',
        client_secret: 'dev-only-lis-interop-secret',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `failed to obtain an interop token: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}
