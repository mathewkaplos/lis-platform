import { expect, test } from '@playwright/test';
import { loginAsLabAdmin, loginAsQa } from './auth';

/**
 * Real-browser coverage for the admin CRUD server actions this repo's
 * lower-priority "Tier 3" coverage pass targets: createUser (lab_admin-
 * gated), createTest/createReferenceRange (qa-gated), updateOrgSettings
 * (qa-gated). Each test is self-contained (own login, own unique data) --
 * these four screens don't share any workflow state the way the clinical
 * spine does.
 *
 * Not `{ exact: true }` on any `getByLabel` call -- see
 * clinical-workflow.spec.ts's own header comment for why (packages/ui's
 * FormField bakes a required field's asterisk into the <label>'s raw text).
 */
test.describe('Admin CRUD (real server actions)', () => {
  test('a lab_admin creates a staff user', async ({ page }) => {
    await loginAsLabAdmin(page);
    await page.goto('/admin/users');

    const uniqueEmail = `e2e-admin-crud-${Date.now()}@example.invalid`;
    await page.getByLabel(/First name/i).fill('Crud');
    await page.getByLabel(/Last name/i).fill('User');
    await page.getByLabel(/Email/i).fill(uniqueEmail);
    await page.getByLabel(/Temporary password/i).fill('E2ePassword123');
    await page.getByLabel(/Role/i).selectOption('technologist');
    await page.getByRole('button', { name: /add user/i }).click();

    await expect(page.getByText('User added')).toBeVisible();
    await expect(page.getByText(uniqueEmail)).toBeVisible();
  });

  test('a qa-roled user creates a test bound to an existing analyte', async ({ page }) => {
    await loginAsQa(page);
    await page.goto('/admin/tests');

    // A new, unique test_definition code -- the seeded chemistry catalog
    // already has its own 'GLU' test bound to the same Glucose analyte;
    // test_definition.code is unique per tenant, not per analyte, so a
    // second test can validly bind to the same analyte again.
    const uniqueCode = `E2E-${Date.now()}`;
    // Not anchored (^$) -- unlike "Low"/"High" below, "Code" is a required
    // field (create-test-form.tsx passes `required`), so its <label> text
    // is "Code *" (see clinical-workflow.spec.ts's own header comment on
    // why exact/anchored matches can never hit a required field's label).
    await page.getByLabel(/Code/i).fill(uniqueCode);
    await page.getByLabel(/Display name/i).fill('E2E Admin Test');
    // Implicit label association (a plain <label> wrapping the Checkbox,
    // no htmlFor/id -- create-test-form.tsx's own shape), not FormField's
    // usual explicit htmlFor -- getByLabel resolves both.
    await page.getByLabel(/Glucose/i).click();
    await page.getByRole('button', { name: /save test/i }).click();

    await expect(page.getByText('Test created')).toBeVisible();
    await expect(page.getByText(uniqueCode)).toBeVisible();
  });

  test('a qa-roled user adds a reference range for an existing analyte', async ({ page }) => {
    await loginAsQa(page);
    await page.goto('/admin/reference-ranges');

    await page.getByRole('button', { name: /add range/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Analyte/range type both keep their own defaults (first catalog
    // analyte, 'normal') -- this test only proves the create action itself
    // works, not any specific analyte's own range content.
    await dialog.getByLabel(/^Low$/i).fill('0');
    await dialog.getByLabel(/^High$/i).fill('100');
    await dialog.getByRole('button', { name: /save range/i }).click();

    // reference-ranges-table.tsx's own state.status === 'created' branch
    // closes the SlideOver (a Radix Dialog) as its own success signal --
    // no separate inline "created" text exists on this screen.
    await expect(dialog).not.toBeVisible();
  });

  test('a qa-roled user updates organization settings', async ({ page }) => {
    await loginAsQa(page);
    await page.goto('/admin/org-settings');

    const uniquePhone = `+1555${Date.now().toString().slice(-7)}`;
    await page.getByLabel(/^Phone$/i).fill(uniquePhone);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // The real proof this persisted server-side, not just optimistic
    // client state: a fresh full page load, re-fetching from the real
    // API/DB (same pattern referring-facilities.spec.ts's own first test
    // established).
    await page.goto('/admin/org-settings');
    await expect(page.getByLabel(/^Phone$/i)).toHaveValue(uniquePhone);
  });
});
