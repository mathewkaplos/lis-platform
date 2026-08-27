import { expect, test } from '@playwright/test';
import { loginAsCashier, loginAsQa } from './auth';

/**
 * Issue #751 (docs/plans/task-751-permission-denied-error-handling.md):
 * proves the specific permission-denied message actually renders for a
 * role lacking the relevant capability, in a real production build --
 * this repo's own established "throw + error.tsx" pattern for this does
 * NOT work in production (Next.js redacts a Server Component throw's own
 * message before it reaches the client), a real bug this exact spec's
 * first version caught live in CI. Every page below now uses an inline
 * conditional return instead (matching admin/users/page.tsx's own
 * pre-existing, actually-working pattern) -- these assertions are the
 * proof, not a description of intent.
 *
 * `test-user-5` (qa role) holds neither `enter_result` nor `manage_billing`
 * (`apps/api/src/auth/capabilities.ts`), covering both routes exercised
 * here.
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
  });

  test('a qa-roled user sees a specific permission message on /billing/invoices, not a generic error', async ({
    page,
  }) => {
    await loginAsQa(page);
    await page.goto('/billing/invoices');

    await expect(page.getByText('You do not have permission to view invoices.')).toBeVisible();
  });

  /**
   * Issue #768 (pilot-readiness audit, found live 2026-08-27). The registration
   * *page* itself has no read-time capability gate (a cashier can legitimately
   * navigate there), so this is a write-time 403 from the Server Action on
   * submit, not a page-load throw like the two tests above -- proves
   * `registerPatient()`'s new 403 branch (patients/new/actions.ts) actually
   * renders, instead of the generic "Something went wrong creating the
   * patient" every other non-2xx/409 response fell back to before this fix.
   */
  test('a cashier-roled user submitting patient registration sees a specific permission message, not a generic error', async ({
    page,
  }) => {
    await loginAsCashier(page);
    await page.goto('/patients/new');

    await page.fill('#firstName', 'Permission');
    await page.fill('#lastName', 'DeniedCheck');
    await page.selectOption('#sex', 'F');
    await page.getByRole('button', { name: 'Save & register' }).click();

    await expect(
      page.getByText('You do not have permission to register patients.'),
    ).toBeVisible();
  });
});
