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
 * Simulated by deleting the `lis_session` cookie after a real login --
 * `getSession()` (apps/web/auth/get-session.ts) returns `undefined` with no
 * cookie present, which `getValidAccessToken()` propagates as `undefined`,
 * the same "no session at all" path a genuinely expired/revoked session
 * takes.
 */
test.describe('Session-expired error handling', () => {
  test('a user whose session cookie is gone sees the specific session-expired message on the dashboard, not a generic error', async ({
    page,
    context,
  }) => {
    await loginAsTechnologist(page);
    await context.clearCookies({ name: 'lis_session' });
    await page.goto('/');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });

  test('a user whose session cookie is gone sees the specific session-expired message on /orders, not a generic error', async ({
    page,
    context,
  }) => {
    await loginAsTechnologist(page);
    await context.clearCookies({ name: 'lis_session' });
    await page.goto('/orders');

    await expect(
      page.getByText('Your session has expired — please log in again.'),
    ).toBeVisible();
  });
});
