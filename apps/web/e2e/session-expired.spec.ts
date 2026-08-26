import { expect, test } from '@playwright/test';
import { loginAsTechnologist } from './auth';

/**
 * Issue #758 (docs/plans/task-758-server-component-error-redaction.md):
 * proves the near-universal "Your session has expired -- please log in
 * again." message actually renders in a real production build, the same
 * proof standard issue #751's `permission-denied.spec.ts` established for
 * its own message class. Every page's own `getValidAccessToken()` check now
 * returns inline (matching `admin/users/page.tsx`'s pre-existing pattern)
 * instead of throwing -- a thrown Error's message is redacted by Next.js in
 * production (`frontend-design` Skill entry #12), so only an assertion
 * against CI's real `web-e2e` production build (`playwright.config.ts`),
 * not `pnpm dev`, actually proves this.
 *
 * **This branch is genuinely hard to reach, and three earlier attempts at
 * this spec each proved a different naive simulation wrong, live in CI:**
 * `proxy.ts` (Next.js middleware) runs the exact same `verifySession()`
 * check as every page, before any page ever renders, and redirects to
 * Keycloak login itself whenever a session is missing or fails
 * verification ((app)/layout.tsx's own comment: this is a defensive-only
 * guard for the race between proxy's check and the page's own token
 * refresh). So neither an unauthenticated request nor a cookie with a
 * tampered/garbage *value* ever reaches this branch -- proxy intercepts
 * both before any page component runs (confirmed live: both landed on
 * Keycloak's real login page or, for a `Secure`-flagged production cookie
 * overwritten by a non-`Secure` one, silently failed to take effect at all
 * and stayed authenticated). The only real way in is the actual race
 * itself: a signed session cookie that still verifies (so proxy lets it
 * through) whose *refresh* then genuinely fails against Keycloak.
 *
 * Reproduced here by temporarily shortening the realm's own
 * `accessTokenLifespan` (via a direct Keycloak Admin REST call, `admin`/
 * `admin` -- the same bootstrap credentials `pr.yml`'s own Keycloak
 * container step sets) to 2 seconds -- shorter than
 * `REFRESH_BUFFER_SECONDS` (access-token.ts), so the very next request
 * after login is already due for a refresh -- then revoking the user's
 * Keycloak session outright (`POST .../users/{id}/logout`) so that refresh
 * attempt genuinely fails, the same way an expired/revoked refresh token
 * would in production. The realm's original lifespan is restored in a
 * `finally`, since other spec files share this same running Keycloak
 * instance.
 */
const KEYCLOAK_BASE_URL = 'http://localhost:8080';
const REALM = 'lis';

async function getAdminToken(): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: 'admin',
      }),
    },
  );
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function getRealmRepresentation(adminToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${KEYCLOAK_BASE_URL}/admin/realms/${REALM}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function putRealmRepresentation(
  adminToken: string,
  realm: Record<string, unknown>,
): Promise<void> {
  await fetch(`${KEYCLOAK_BASE_URL}/admin/realms/${REALM}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(realm),
  });
}

async function revokeUserSessions(adminToken: string, username: string): Promise<void> {
  const usersRes = await fetch(
    `${KEYCLOAK_BASE_URL}/admin/realms/${REALM}/users?username=${username}&exact=true`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  const [user] = (await usersRes.json()) as Array<{ id: string }>;
  await fetch(`${KEYCLOAK_BASE_URL}/admin/realms/${REALM}/users/${user.id}/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

test.describe('Session-expired error handling', () => {
  test('a user whose refresh genuinely fails against Keycloak sees the specific session-expired message, not a generic error', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const adminToken = await getAdminToken();
    const realm = await getRealmRepresentation(adminToken);
    const originalLifespan = realm.accessTokenLifespan;

    try {
      await putRealmRepresentation(adminToken, { ...realm, accessTokenLifespan: 2 });
      await loginAsTechnologist(page);
      await revokeUserSessions(adminToken, 'test-user');

      await page.goto('/');

      await expect(
        page.getByText('Your session has expired — please log in again.'),
      ).toBeVisible();
    } finally {
      await putRealmRepresentation(adminToken, { ...realm, accessTokenLifespan: originalLifespan });
    }
  });
});
