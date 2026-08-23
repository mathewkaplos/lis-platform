import { expect, test } from '@playwright/test';
import { loginAsTechnologist } from './auth';

/**
 * apps/web's first real-browser integration test -- establishes the
 * pattern this session's coverage-improvement pass set out to build:
 * `createReferringFacility` (admin/referring-facilities/actions.ts) is a
 * real `'use server'` action, exercised here through a real form
 * submission in a real browser against a real running Next.js server,
 * real API, real Keycloak, real Postgres. No mocks anywhere in this path.
 */
test.describe('Referring facilities: create (real server action)', () => {
  test('creating a facility through the real form persists it server-side, not just in optimistic UI state', async ({
    page,
  }) => {
    await loginAsTechnologist(page);
    await page.goto('/admin/referring-facilities');

    // Unique per run -- this suite runs against a real, shared, persistent
    // tenant (same TENANT_A every other e2e spec in this repo uses), so a
    // fixed name would collide across repeated local runs.
    const uniqueName = `E2E Referring Facility ${Date.now()}`;

    await page.getByLabel('Name', { exact: true }).fill(uniqueName);
    await page.getByLabel('Phone').fill('555-0100');
    await page.getByRole('button', { name: /save facility/i }).click();

    await expect(page.getByText(`${uniqueName} was added.`)).toBeVisible();

    // The real proof this isn't just optimistic client state: a fresh
    // full page load, re-fetching the list from the real API/DB.
    await page.goto('/admin/referring-facilities');
    await expect(page.getByText(uniqueName, { exact: true })).toBeVisible();
  });

  test('submitting with no name shows the real server-side validation error, not a silent failure', async ({
    page,
  }) => {
    await loginAsTechnologist(page);
    await page.goto('/admin/referring-facilities');

    // The Input itself is `required` (HTML5 constraint validation), which
    // would block submission client-side before this form's own server
    // action ever runs -- remove that attribute first so this test
    // actually exercises the schema's own server-side validation
    // (referringFacilityCreateSchema's `name: z.string().min(1)`), not
    // just the browser's built-in form guard.
    await page.getByLabel('Name', { exact: true }).evaluate((el) => el.removeAttribute('required'));
    await page.getByRole('button', { name: /save facility/i }).click();

    // Loose on exact wording (Zod's own default message, not this app's to
    // guarantee) -- the real assertion is that a real server-side
    // validation error rendered at all, not a silent no-op or a generic
    // 500, and that the "added" success state never appears.
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByText(/was added\./)).not.toBeVisible();
  });
});
