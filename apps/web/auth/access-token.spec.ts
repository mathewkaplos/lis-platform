import { describe, expect, it } from 'vitest';
import * as client from 'openid-client';
import { getOidcConfig } from './oidc-config';
import { refreshIfStale } from './access-token';

/**
 * ADR-0014 / issue #265: proves the actual refresh call against a real
 * Keycloak, not a mocked OIDC response -- matching this repo's own
 * "verify against the real thing" standard already established by every
 * apps/api e2e spec (test/get-keycloak-token.ts's own header comment).
 *
 * Fetches a real refresh_token via the Resource Owner Password grant
 * (directAccessGrantsEnabled: true on lis-web, per infra/keycloak/
 * lis-realm.json) -- the same underlying grant test-user's password already
 * exercises for apps/api's own e2e specs, just used here to obtain a
 * refresh_token rather than to authenticate a request.
 */
async function fetchRealTokens() {
  const config = await getOidcConfig();
  return client.genericGrantRequest(config, 'password', {
    username: 'test-user',
    password: 'test-password',
  });
}

describe('refreshIfStale', () => {
  it('does not call Keycloak when the access token is still comfortably valid', async () => {
    const config = await getOidcConfig();
    const now = Math.floor(Date.now() / 1000);
    const result = await refreshIfStale(
      {
        accessToken: 'irrelevant',
        refreshToken: 'not-a-real-token-would-fail-if-actually-used',
        accessTokenExpiresAt: now + 300,
      },
      config,
      now,
    );
    expect(result).toBeNull();
  });

  it('refreshes via a real Keycloak call when the access token is stale, returning a new real token pair', async () => {
    const initial = await fetchRealTokens();
    const config = await getOidcConfig();
    const now = Math.floor(Date.now() / 1000);

    const result = await refreshIfStale(
      {
        accessToken: initial.access_token,
        refreshToken: initial.refresh_token as string,
        accessTokenExpiresAt: now - 1, // forced stale, no need to wait 5 real minutes
      },
      config,
      now,
    );

    expect(result).not.toBeNull();
    expect(typeof result?.accessToken).toBe('string');
    expect(result?.accessToken.length).toBeGreaterThan(0);
    expect(result?.accessToken).not.toBe(initial.access_token);
    expect(typeof result?.refreshToken).toBe('string');
    expect(result?.accessTokenExpiresAt).toBeGreaterThan(now);
  });

  it('throws when the refresh token is genuinely invalid, rather than returning a stale/invalid token', async () => {
    const config = await getOidcConfig();
    const now = Math.floor(Date.now() / 1000);
    await expect(
      refreshIfStale(
        {
          accessToken: 'irrelevant',
          refreshToken: 'genuinely-not-a-real-refresh-token',
          accessTokenExpiresAt: now - 1,
        },
        config,
        now,
      ),
    ).rejects.toThrow();
  });
});
