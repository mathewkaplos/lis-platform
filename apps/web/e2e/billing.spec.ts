import { expect, test } from '@playwright/test';
import { loginAsQa, loginAsTechnologist } from './auth';

/**
 * Real money moving through the system: generateInvoice -> recordPayment,
 * exercised through real forms. Order entry is the real prerequisite (an
 * invoice needs priced ordered tests) -- the seeded chemistry catalog's own
 * GLU (Glucose) test has a placeholder price (db/seed/chemistry-
 * catalog.sql, $15.00), same fixture clinical-workflow.spec.ts already
 * relies on. Specimen reception is skipped here -- generateInvoice bills
 * off the order's own ordered tests regardless of receive status, and this
 * spec has no need to exercise that already-covered separate path.
 *
 * Not `{ exact: true }` on any `getByLabel` call -- see
 * clinical-workflow.spec.ts's own header comment for why.
 */
test.describe('Billing: generate invoice -> record payment (real server actions)', () => {
  test('generating an invoice and recording full payment marks it paid', async ({
    page,
    browser,
  }) => {
    // Issue #765 (pilot-readiness audit): explicitly set the tenant's own
    // currency to a non-USD code first, in a separate browser context (qa
    // holds manage_org_settings, technologist does not) -- proves the
    // invoice/payment UI reads this real setting rather than a hardcoded
    // "$"/"USD", without depending on whatever a fresh seed happens to
    // default `tenant.currency` to (confirmed live: it's blank/NULL on a
    // freshly seeded db, unlike this session's own manually-configured local
    // dev tenant, which is not a checked-in fixture).
    const qaContext = await browser.newContext();
    const qaPage = await qaContext.newPage();
    await loginAsQa(qaPage);
    await qaPage.goto('/admin/org-settings');
    await qaPage.getByLabel(/Currency/i).fill('KES');
    await qaPage.getByRole('button', { name: /^save$/i }).click();
    await expect(qaPage.getByText('Saved.')).toBeVisible();
    await qaContext.close();

    await loginAsTechnologist(page);

    await page.goto('/patients/new');
    const uniqueLastName = `E2E-Billing-${Date.now()}`;
    await page.getByLabel(/First name/i).fill('Billing');
    await page.getByLabel(/Last name/i).fill(uniqueLastName);
    await page.getByLabel(/Sex/i).selectOption('F');
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByText('Patient registered')).toBeVisible();

    await page.getByRole('link', { name: /place an order/i }).click();
    await page.getByLabel(/Glucose/i).click();
    await page.getByRole('button', { name: /place order/i }).click();
    await expect(page.getByText('Order placed')).toBeVisible();
    await page.getByRole('link', { name: /view order/i }).click();
    // Same waitForURL-before-read discipline clinical-workflow.spec.ts's
    // own header comment explains -- a client-side (App Router soft)
    // navigation's URL isn't guaranteed to have committed the instant a
    // preceding `.click()` resolves.
    await page.waitForURL(/\/orders\/[0-9a-f-]+$/i);

    // -- Generate the invoice (real server action: generateInvoice) -----
    // generate-invoice-button.tsx does `router.push()` on success -- same
    // client-side navigation race as "View order" above, so wait for the
    // real destination URL rather than asserting on page content
    // immediately after the click.
    await page.getByRole('button', { name: /generate invoice/i }).click();
    await page.waitForURL(/\/billing\/invoices\/[0-9a-f-]+$/i);
    // .first() -- invoice-view.tsx renders "unpaid" twice (the status
    // badge and the receipt card's own "Status: unpaid" line), the same
    // legitimate-double-render class the final "paid" assertion below
    // already accounts for.
    await expect(page.getByText('unpaid', { exact: true }).first()).toBeVisible();

    await expect(page.getByLabel(/Amount \(KES\)/i)).toBeVisible();
    await expect(page.getByText('$', { exact: false })).toHaveCount(0);

    // -- Record full payment (real server action: recordPayment) --------
    // The amount field already defaults to the invoice's own full balance
    // due (invoice-view.tsx) -- no need to type a value, just submit.
    await page.getByRole('button', { name: /record payment/i }).click();

    // invoice-view.tsx's own useEffect calls router.refresh() on success,
    // which re-fetches the invoice server-side -- its status is now
    // 'paid', so the "Take payment" card (and this button) unmounts
    // entirely, same class of "client success state never renders because
    // the whole section re-renders away" behavior case-sign-out.spec.ts's
    // own header comment already documents for signOutCase. Assert the
    // real, persisted status badge instead. exact: true + .first() --
    // "paid" is also a substring of "unpaid", and the real "paid" text
    // legitimately appears twice once status flips (the status badge and
    // the receipt card's own "Status: paid" line).
    await expect(page.getByText('paid', { exact: true }).first()).toBeVisible();
  });
});
