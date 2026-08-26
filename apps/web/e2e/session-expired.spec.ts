import { expect, test, type BrowserContext } from '@playwright/test';
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
 * Simulated by overwriting the `lis_session` cookie with a value that fails
 * `verifySession()` (apps/web/auth/session.ts's own JWT-verify, which
 * catches any parse/signature failure and returns `undefined`) -- the same
 * "no session at all" path a genuinely expired/revoked session takes.
 * `context.clearCookies()` (both name-filtered and unfiltered) and a real
 * `GET /api/auth/logout` round trip were both tried first and confirmed
 * unreliable in real CI runs -- the former left the session fully
 * authenticated, the latter landed on Keycloak's own login page rather than
 * completing its redirect back to the app within the test's wait. Directly
 * overwriting the cookie's value is deterministic: no cookie-jar filter
 * semantics and no dependency on Keycloak's own RP-initiated-logout flow.
 */
async function corruptSessionCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: 'lis_session',
      value: 'not-a-valid-session-jwt',
      domain: 'localhost',
      path: '/',
    },
  ]);
}

test.describe('Session-expired error handling', () => {
  test('a user with an invalid session cookie sees the specific session-expired message on the dashboard, not a generic error', async ({
    page,
    context,
  }) => {
    await loginAsTechnologist(page);
    await corruptSessionCookie(context);
    await page.goto('/');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });

  test('a user with an invalid session cookie sees the specific session-expired message on /orders, not a generic error', async ({
    page,
    context,
  }) => {
    await loginAsTechnologist(page);
    await corruptSessionCookie(context);
    await page.goto('/orders');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });
});
