import { expect, test } from '@playwright/test';

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
 * A brand-new Playwright test context starts with no cookies at all --
 * `getSession()` (apps/web/auth/get-session.ts) short-circuits to
 * `undefined` the moment `cookies().get('lis_session')` itself is
 * `undefined`, without needing a signed/verified token either way. This is
 * the exact same "no session at all" condition every page's own
 * `!accessToken` check guards, and needs neither a real login nor any
 * cookie-jar manipulation -- three separate attempts at simulating an
 * *expired* session that way (a `context.clearCookies()` filtered by name,
 * an unfiltered `clearCookies()`, and a real `GET /api/auth/logout` round
 * trip) were each tried and confirmed unreliable/non-deterministic against
 * a real CI run; simply never logging in sidesteps all three failure modes.
 */
test.describe('Session-expired error handling', () => {
  test('an unauthenticated request sees the specific session-expired message on the dashboard, not a generic error', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });

  test('an unauthenticated request sees the specific session-expired message on /orders, not a generic error', async ({
    page,
  }) => {
    await page.goto('/orders');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });
});
