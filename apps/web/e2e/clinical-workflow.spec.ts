import { expect, test } from '@playwright/test';
import { loginAsPathologist, loginAsTechnologist } from './auth';

/**
 * The clinical spine of this app, exercised end to end through real forms
 * against a real running server, real API, real Keycloak, real Postgres:
 * register a patient -> place an order -> receive its specimen -> enter and
 * finalize a quantity result -> verify it as a different, pathologist-roled
 * user. Each of these five `'use server'` actions (registerPatient,
 * createOrder, receiveSpecimen, finalizeResult, verifyResult) previously had
 * zero coverage beyond typecheck -- same "can't be unit-tested without a
 * real browser+server" reasoning `referring-facilities.spec.ts` already
 * established for this harness. No mocks anywhere in this path.
 *
 * Needs the chemistry catalog's own GLU (Glucose) test seeded
 * (db/seed/chemistry-catalog.sql, wired into the web-e2e CI job) -- the same
 * fixture apps/api's own case-sign-out.e2e-spec.ts already relies on.
 *
 * Not `{ exact: true }` on any `getByLabel` call here -- packages/ui's
 * FormField renders a required field's label as "Label *" (the asterisk
 * sits inside the same <label>, only `aria-hidden`), which exact:true can
 * never match (referring-facilities.spec.ts's own header comment has the
 * full story, found live via a CI trace).
 */
test.describe('Clinical spine: register -> order -> receive -> finalize -> verify', () => {
  test('a technologist finalizes a quantity result, then a different pathologist-roled user verifies it', async ({
    page,
    browser,
  }) => {
    await loginAsTechnologist(page);

    // -- Register a patient --------------------------------------------
    await page.goto('/patients/new');
    const uniqueLastName = `E2E-Clinical-${Date.now()}`;
    await page.getByLabel(/First name/i).fill('Clinical');
    await page.getByLabel(/Last name/i).fill(uniqueLastName);
    // No birthDate filled -- registerPatient's own duplicate-check branch
    // only runs when birthDate is present (actions.ts:80), and this test
    // has no need to exercise that separate, already-covered path.
    await page.getByLabel(/Sex/i).selectOption('F');
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByRole('heading', { name: 'Patient registered' })).toBeVisible();

    // -- Place an order (real server action: createOrder) ---------------
    await page.getByRole('link', { name: /place an order/i }).click();
    await page.getByLabel(/Glucose/i).click();
    await page.getByRole('button', { name: /place order/i }).click();
    await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();

    await page.getByRole('link', { name: /view order/i }).click();
    const orderIdMatch = page.url().match(/\/orders\/([^/]+)$/);
    if (!orderIdMatch) {
      throw new Error(`expected an order detail URL, got ${page.url()}`);
    }
    const orderId = orderIdMatch[1];

    // -- Receive the specimen (real server action: receiveSpecimen) -----
    await page.getByRole('link', { name: /receive at reception/i }).click();
    await page.getByLabel(/Specimen type/i).fill('serum');
    // The ordered test checkbox defaults checked (reception-form.tsx) --
    // nothing to toggle, matches the real common case of accepting
    // everything the order asked for.
    await page.getByRole('button', { name: /accept & receive/i }).click();
    await expect(page.getByRole('heading', { name: 'Specimen received' })).toBeVisible();

    // -- Enter and finalize a quantity result (real server actions:
    // draftResult on blur, finalizeResult on Enter) --------------------
    await page.goto(`/orders/${orderId}/results`);
    const resultInput = page.getByLabel(/Glucose result/i);
    // Mid-range for the seeded 70-99 reference interval (chemistry-
    // catalog.sql) -- a normal value, not a critical one, so finalize
    // completes cleanly rather than hitting FinalizationRollupInterceptor's
    // panel_hold branch (a real, separate behavior, out of this test's
    // scope).
    await resultInput.fill('90');
    await resultInput.press('Enter');
    await expect(page.getByText('Finalized')).toBeVisible();

    // A technologist session has no `pathologist` role -- the Verify
    // control must not even render (results-grid.tsx's own `isVerifier`
    // gate), not merely be disabled. Real proof the role gate works, not
    // just that a pathologist-roled call happens to succeed below.
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);

    // -- Verify the result, as a genuinely different user (real server
    // action: verifyResult) --------------------------------------------
    // A fresh browser context, not a second `page.goto('/api/auth/login')`
    // in the same context -- Keycloak's own SSO session cookie would just
    // silently re-authenticate as the already-logged-in technologist
    // instead of showing a login form for a different user. Two independent
    // browser contexts is also the honest shape of this real workflow: a
    // different person, at a different terminal.
    const pathologistContext = await browser.newContext();
    try {
      const pathologistPage = await pathologistContext.newPage();
      await loginAsPathologist(pathologistPage);
      await pathologistPage.goto(`/orders/${orderId}/results`);
      await pathologistPage.getByRole('button', { name: 'Verify' }).click();
      await expect(pathologistPage.getByText('Verified')).toBeVisible();
    } finally {
      await pathologistContext.close();
    }
  });
});
