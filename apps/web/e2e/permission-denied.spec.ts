import { expect, test } from '@playwright/test';
import { loginAsQa } from './auth';

/**
 * Issue #751 (docs/plans/task-751-permission-denied-error-handling.md):
 * proves the specific permission-denied message actually renders for a
 * role lacking the relevant capability, not just that some error is
 * shown. `culture-reads` is the simplest single-fetch case of the four
 * pages this task fixed -- `test-user-5` (qa role) holds no `enter_result`
 * capability (`apps/api/src/auth/capabilities.ts`), the one
 * `GET /v1/culture-reads` requires.
 */
test.describe('Permission-denied error handling', () => {
  test('a qa-roled user sees a specific permission message on /culture-reads, not a generic error', async ({
    page,
  }) => {
    await loginAsQa(page);
    await page.goto('/culture-reads');

    await expect(
      page.getByText('You do not have permission to view cultures due for reading.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  });
});
