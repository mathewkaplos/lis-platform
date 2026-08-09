import { KEYCLOAK_ISSUER_URL } from '../src/auth/keycloak-config';

/**
 * Client-credentials grant against the `lis-gateway` client (ADR-0026) —
 * the machine-token equivalent of get-keycloak-token.ts's password grant,
 * used by e2e specs that need a real gateway-issued token rather than a
 * human user's.
 */
export async function getGatewayToken(): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'lis-gateway',
        client_secret: 'dev-only-lis-gateway-secret',
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `failed to obtain a gateway token: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}
