import { expect, test } from '@playwright/test';
import { loginAsPathologist } from './auth';

/**
 * The anatomic-pathology accessioning + sign-out path, exercised end to end
 * through real forms: place an order -> accession an AP case against it ->
 * add a block -> add a slide -> sign the case out. Covers five previously
 * zero-coverage `'use server'` actions (createCase, addBlock, addSlide,
 * signOutCase, plus createOrder already covered by clinical-workflow.spec.ts
 * but exercised again here as this flow's own real prerequisite) -- same
 * "test the real thing" harness referring-facilities.spec.ts established.
 *
 * signOutCase has `@RequireStepUp()` server-side (StepUpGuard, ADR-0051) --
 * it 403s and redirects to a forced re-login unless the session's own
 * Keycloak `auth_time` is fresh (<=300s old, step-up-freshness.ts). This
 * spec's real Authorization Code + PKCE browser login (auth.ts) always
 * produces a freshly-set auth_time, and this test runs the whole flow
 * within seconds of logging in -- so the positive sign-out path below is,
 * by construction, also live proof StepUpGuard's "pass" branch is wired
 * correctly end to end (mirrors apps/api's own
 * case-sign-out.e2e-spec.ts header comment on the same point).
 *
 * `loginAsPathologist` (test-user-4: technologist+pathologist, TENANT_A) is
 * used for the whole flow, not two separate role logins -- unlike
 * clinical-workflow.spec.ts's finalize/verify split (a real two-person
 * separation-of-duties case worth proving with two sessions), nothing here
 * requires two different actors: `hasSpecimenManagementRole` and
 * `hasPathologistRole` both already accept this one user for every step
 * (accession/add block/add slide need the former, sign out needs the
 * latter).
 *
 * Not `{ exact: true }` on any `getByLabel` call -- see
 * clinical-workflow.spec.ts's own header comment for why (packages/ui's
 * FormField bakes a required field's asterisk into the <label>'s raw text).
 */
test.describe('AP case: accession -> add block -> add slide -> sign out (real server actions)', () => {
  test('a pathologist-roled user accessions, builds out, and signs out a case', async ({ page }) => {
    await loginAsPathologist(page);

    // -- A patient and an order to accession the case against -----------
    await page.goto('/patients/new');
    const uniqueLastName = `E2E-CaseSignOut-${Date.now()}`;
    await page.getByLabel(/First name/i).fill('CaseSignOut');
    await page.getByLabel(/Last name/i).fill(uniqueLastName);
    await page.getByLabel(/Sex/i).selectOption('M');
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByText('Patient registered')).toBeVisible();

    await page.getByRole('link', { name: /place an order/i }).click();
    await page.getByLabel(/Glucose/i).click();
    await page.getByRole('button', { name: /place order/i }).click();
    await expect(page.getByText('Order placed')).toBeVisible();
    await page.getByRole('link', { name: /view order/i }).click();

    // -- Accession the AP case (real server action: createCase) ---------
    await page.getByRole('link', { name: /new ap case/i }).click();
    await page.getByLabel(/Part 1 specimen type/i).fill('tissue');
    await page.getByRole('button', { name: /accession case/i }).click();
    await expect(page.getByText('Case accessioned')).toBeVisible();
    await page.getByRole('link', { name: /view case/i }).click();

    // -- Build out the lineage (real server actions: addBlock, addSlide) --
    // Same minimal "1 part, 1 block, 1 slide" shape apps/api's own
    // case-sign-out.e2e-spec.ts `createFinalizableCase()` fixture uses --
    // confirmed there that finalize needs no screening step and no
    // narrative first.
    await page.getByRole('button', { name: /^add block$/i }).click();
    await expect(page.getByText(/^Block /)).toBeVisible();
    await page.getByRole('button', { name: /^add slide$/i }).click();
    await expect(page.getByText(/^Slide /)).toBeVisible();

    // -- Sign the case out (real server action: signOutCase) ------------
    await page.getByRole('button', { name: /sign out this case/i }).click();
    await expect(page.getByText('Case signed out.')).toBeVisible();
  });
});
