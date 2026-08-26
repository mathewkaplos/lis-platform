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
 * Simulated via a real logout (`GET /api/auth/logout`), not a Playwright-API
 * cookie manipulation -- `context.clearCookies()` (both name-filtered and
 * unfiltered) was tried first and confirmed unreliable against this app in a
 * real CI run: the page still rendered fully authenticated afterward. The
 * real logout route deletes the `lis_session` cookie server-side (in the
 * same response that redirects to Keycloak's end-session endpoint), which is
 * the same server-side deletion path `getValidAccessToken()`'s own refresh-
 * failure branch takes -- a more faithful "no session at all" simulation
 * than reaching into the browser's cookie jar directly, and consistent with
 * this repo's own no-shortcuts testing convention (`auth.ts`'s own header
 * comment).
 */
test.describe('Session-expired error handling', () => {
  test('a logged-out user sees the specific session-expired message on the dashboard, not a generic error', async ({
    page,
  }) => {
    await loginAsTechnologist(page);
    await page.goto('/api/auth/logout');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });

  test('a logged-out user sees the specific session-expired message on /orders, not a generic error', async ({
    page,
  }) => {
    await loginAsTechnologist(page);
    await page.goto('/api/auth/logout');
    await page.waitForLoadState('networkidle');

    await page.goto('/orders');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });
});
