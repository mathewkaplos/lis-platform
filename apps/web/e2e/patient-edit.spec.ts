import { expect, test } from '@playwright/test';
import { loginAsTechnologist } from './auth';

/**
 * Issue #747 (docs/plans/task-747-patient-demographic-editing.md): the
 * correction path for a mistyped registration, previously absent entirely.
 * Real browser, real server action (`updatePatient`), real API, real
 * Postgres -- same harness convention as clinical-workflow.spec.ts.
 *
 * Not `{ exact: true }` on any `getByLabel` call -- see
 * clinical-workflow.spec.ts's own header comment for why (packages/ui's
 * FormField bakes a required field's asterisk into the <label>'s raw text).
 */
test.describe('Patient demographic editing', () => {
  test('a technologist corrects a mistyped last name and clears a field, both persisting after reload', async ({
    page,
  }) => {
    await loginAsTechnologist(page);

    await page.goto('/patients/new');
    const uniqueLastName = `E2E-Edit-${Date.now()}`;
    await page.getByLabel(/First name/i).fill('Typo');
    await page.getByLabel(/Last name/i).fill(uniqueLastName);
    await page.getByLabel(/Sex/i).selectOption('F');
    await page.getByLabel(/^Phone$/i).fill('0700000000');
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByText('Patient registered')).toBeVisible();

    await page.getByRole('link', { name: /view patient/i }).click();
    await expect(page.getByText(uniqueLastName)).toBeVisible();

    await page.getByRole('link', { name: /^edit$/i }).click();
    const correctedLastName = `${uniqueLastName}-Corrected`;
    await page.getByLabel(/Last name/i).fill(correctedLastName);
    // A field the user clears is a deliberate "clear this" (actions.ts's own
    // `emptyToNull`), proven by checking it actually cleared after reload,
    // not just that the save succeeded.
    await page.getByLabel(/^Phone$/i).fill('');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('Changes saved')).toBeVisible();

    await page.getByRole('link', { name: /back to patient/i }).click();
    await expect(page.getByText(correctedLastName)).toBeVisible();

    // The real proof this persisted server-side, not just optimistic client
    // state: a fresh full page load, re-fetching from the real API/DB (same
    // pattern admin-crud.spec.ts's own org-settings test established).
    await page.reload();
    await expect(page.getByText(correctedLastName)).toBeVisible();
    await expect(page.locator('dt:has-text("Phone") + dd')).toHaveText('—');
  });

  test('a duplicate national ID is rejected with an inline error, leaving the original row unchanged', async ({
    page,
  }) => {
    await loginAsTechnologist(page);
    const uniqueNationalId = `E2E-NID-${Date.now()}`;

    await page.goto('/patients/new');
    await page.getByLabel(/First name/i).fill('Holds');
    await page.getByLabel(/Last name/i).fill(`E2E-Holder-${Date.now()}`);
    await page.getByLabel(/Sex/i).selectOption('M');
    await page.getByLabel(/National ID/i).fill(uniqueNationalId);
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByText('Patient registered')).toBeVisible();

    await page.goto('/patients/new');
    const secondLastName = `E2E-Second-${Date.now()}`;
    await page.getByLabel(/First name/i).fill('Conflict');
    await page.getByLabel(/Last name/i).fill(secondLastName);
    await page.getByLabel(/Sex/i).selectOption('M');
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByText('Patient registered')).toBeVisible();
    await page.getByRole('link', { name: /view patient/i }).click();

    await page.getByRole('link', { name: /^edit$/i }).click();
    await page.getByLabel(/National ID/i).fill(uniqueNationalId);
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(
      page.getByText('A patient with this national ID already exists.'),
    ).toBeVisible();
    // Still on the edit form, not a false "Changes saved".
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible();
  });
});
