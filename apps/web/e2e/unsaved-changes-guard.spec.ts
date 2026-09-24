import { expect, test, type Page } from '@playwright/test';
import { loginAsPathologist, loginAsTechnologist } from './auth';

/**
 * docs/plans/task-unsaved-form-guard.md. Refreshing mid-form used to
 * silently discard everything typed (confirmed live 2026-08-27,
 * docs/pilot/PILOT-USER-GUIDE.md's own edge-case table). Each dirty form
 * now raises the browser's native `beforeunload` prompt -- asserted here by
 * a real reload in a real browser, not a unit test of the hook.
 *
 * Not `{ exact: true }` on any `getByLabel` call -- see
 * clinical-workflow.spec.ts's own header comment.
 */

/**
 * Reloads the page and reports whether a `beforeunload` prompt was raised.
 * The prompt is dismissed (Playwright's `dialog.dismiss()` = "Stay"), so the
 * test then also proves the typed value survived, i.e. the prompt actually
 * protected the input rather than just appearing.
 */
async function reloadAndCapturePrompt(page: Page): Promise<boolean> {
  let prompted = false;
  page.once('dialog', async (dialog) => {
    prompted = dialog.type() === 'beforeunload';
    await dialog.dismiss();
  });
  // A dismissed beforeunload cancels the navigation, so `reload()` never
  // resolves on its own -- don't await its load event.
  await page.reload({ timeout: 5_000 }).catch(() => undefined);
  return prompted;
}

test.describe('Unsaved-changes guard (beforeunload prompt on dirty forms)', () => {
  test('patient registration: a pristine form reloads without prompting', async ({ page }) => {
    await loginAsTechnologist(page);
    await page.goto('/patients/new');
    await expect(page.getByLabel(/First name/i)).toBeVisible();

    expect(await reloadAndCapturePrompt(page)).toBe(false);
  });

  test('patient registration: typed input prompts on reload and survives "Stay"', async ({
    page,
  }) => {
    await loginAsTechnologist(page);
    await page.goto('/patients/new');
    await page.getByLabel(/First name/i).fill('Unsaved');

    expect(await reloadAndCapturePrompt(page)).toBe(true);
    await expect(page.getByLabel(/First name/i)).toHaveValue('Unsaved');
  });

  test('order builder and case accession: dirty forms prompt on reload', async ({ page }) => {
    // Pathologist (technologist + pathologist roles) can both place the
    // order and accession the case -- same fixture case-sign-out.spec.ts uses.
    await loginAsPathologist(page);

    await page.goto('/patients/new');
    await page.getByLabel(/First name/i).fill('UnsavedGuard');
    await page.getByLabel(/Last name/i).fill(`E2E-UnsavedGuard-${Date.now()}`);
    await page.getByLabel(/Sex/i).selectOption('F');
    await page.getByRole('button', { name: /save & register/i }).click();
    // The success screen unmounts the form, so it must not prompt.
    await expect(page.getByText('Patient registered')).toBeVisible();

    await page.getByRole('link', { name: /place an order/i }).click();
    await page.getByLabel(/Glucose/i).click();
    expect(await reloadAndCapturePrompt(page)).toBe(true);
    await expect(page.getByLabel(/Glucose/i)).toBeChecked();

    await page.getByRole('button', { name: /place order/i }).click();
    await expect(page.getByText('Order placed')).toBeVisible();
    await page.getByRole('link', { name: /view order/i }).click();

    await page.getByRole('link', { name: /new ap case/i }).click();
    await page.getByLabel(/Part 1 specimen type/i).fill('tissue');
    expect(await reloadAndCapturePrompt(page)).toBe(true);
    await expect(page.getByLabel(/Part 1 specimen type/i)).toHaveValue('tissue');
  });
});
