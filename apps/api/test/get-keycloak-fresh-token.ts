import { createHash, randomBytes } from 'node:crypto';
import { KEYCLOAK_ISSUER_URL } from '../src/auth/keycloak-config';

/**
 * FEAT-059. `getKeycloakToken` (get-keycloak-token.ts) uses the Direct
 * Access Grant (`grant_type=password`) — found for real, not hypothetical,
 * while building this feature's e2e coverage: a direct-grant token never
 * carries an `auth_time` claim on this realm (confirmed by decoding a real
 * token; Keycloak's AUTH_TIME user-session note is set by the interactive
 * browser authentication flow, not the Direct Grant code path, even though
 * both flows share the same `basic` client scope/mapper). Since
 * StepUpGuard's whole point is checking `auth_time`, any test that needs a
 * genuinely fresh step-up assertion needs a token from the *real*
 * Authorization Code + PKCE flow apps/web itself uses
 * (client.authorizationCodeGrant, apps/web/app/api/auth/callback/route.ts)
 * — the same flow a real pathologist goes through.
 *
 * This drives that real flow with plain HTTP, no headless browser: fetch
 * the login form Keycloak's default theme renders, POST credentials to its
 * own form action URL (carrying the session cookie Keycloak sets on the
 * first request), and capture the `code` from the un-followed redirect.
 * `lis-web` is a public client with PKCE required
 * (`pkce.code.challenge.method: S256`, infra/keycloak/lis-realm.json), so
 * this generates and uses a real PKCE pair — cutting that corner would
 * make the whole exchange fail with a real 400 from Keycloak, not a
 * mocked-away requirement.
 */
export async function getKeycloakFreshToken(
  username: string,
  password: string,
): Promise<string> {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const redirectUri = 'http://localhost:3000/e2e-fresh-token-callback';
  const state = randomBytes(16).toString('hex');

  const authUrl = new URL(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/auth`,
  );
  authUrl.searchParams.set('client_id', 'lis-web');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid tenant');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const formRes = await fetch(authUrl, { redirect: 'manual' });
  if (formRes.status !== 200) {
    throw new Error(
      `expected the Keycloak login form (200), got ${formRes.status}: ${await formRes.text()}`,
    );
  }
  const cookie = formRes.headers.get('set-cookie');
  if (!cookie) {
    throw new Error(
      'expected Keycloak to set a session cookie on the login form request',
    );
  }
  const html = await formRes.text();
  const actionMatch = html.match(/id="kc-form-login"[^>]*action="([^"]+)"/);
  if (!actionMatch) {
    throw new Error(
      "could not find the login form action URL in Keycloak's login page — theme markup may have changed",
    );
  }
  const formAction = actionMatch[1].replace(/&amp;/g, '&');

  const loginRes = await fetch(formAction, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      cookie,
    },
    body: new URLSearchParams({ username, password }),
  });
  if (loginRes.status !== 302) {
    throw new Error(
      `expected a redirect after login (302), got ${loginRes.status}: ${await loginRes.text()}`,
    );
  }
  const location = loginRes.headers.get('location');
  if (!location || !location.startsWith(redirectUri)) {
    throw new Error(
      `expected a redirect back to ${redirectUri}, got ${location} — bad credentials for ${username}?`,
    );
  }
  const code = new URL(location).searchParams.get('code');
  if (!code) {
    throw new Error(`expected a ?code= in the redirect, got ${location}`);
  }

  const tokenRes = await fetch(
    `${KEYCLOAK_ISSUER_URL}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'lis-web',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    },
  );
  if (!tokenRes.ok) {
    throw new Error(
      `failed to exchange code for a token: ${tokenRes.status} ${await tokenRes.text()}`,
    );
  }
  const body = (await tokenRes.json()) as { access_token: string };
  return body.access_token;
}
