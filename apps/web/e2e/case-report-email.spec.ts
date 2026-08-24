import { expect, test } from '@playwright/test';
import { loginAsPathologist } from './auth';

const MAILHOG_API = 'http://localhost:8025/api/v2';

interface MailhogMessage {
  To: { Mailbox: string; Domain: string }[];
  Content: { Body: string; Headers: Record<string, string[]> };
}

/**
 * Real-browser coverage for the send-report-email feature (pilot-readiness
 * audit follow-up, #741/#742): sign a case out, then send its report by
 * email through the real form -- clicking the real "Send by email" button,
 * not calling the API directly. Verified against a real MailHog instance
 * (`web-e2e`'s own CI job, `apps/api`'s `SMTP_*` env vars point at it) via
 * its REST API, the same "test the real thing, verify via a real received
 * message" approach `case-report-email.e2e-spec.ts` already established at
 * the API layer -- this spec is the UI half of that same feature, not a
 * re-test of the send logic itself.
 *
 * `loginAsPathologist` (test-user-4: technologist+pathologist) for the
 * whole flow, same single-session shape `case-sign-out.spec.ts` already
 * uses -- nothing here needs two different actors.
 *
 * Not `{ exact: true }` on any `getByLabel` call -- see
 * clinical-workflow.spec.ts's own header comment for why.
 */
test.describe('Case report email (real server action + real SMTP)', () => {
  test('signs a case out, then sends its report by email through the real form', async ({
    page,
  }) => {
    await loginAsPathologist(page);

    // -- A patient with a real email on file, so the send-email form's own
    // "Email to" field prefills from it (page.tsx's own patient fetch). --
    await page.goto('/patients/new');
    const uniqueLastName = `E2E-ReportEmail-${Date.now()}`;
    const patientEmail = `e2e-report-email-${Date.now()}@example.invalid`;
    await page.getByLabel(/First name/i).fill('ReportEmail');
    await page.getByLabel(/Last name/i).fill(uniqueLastName);
    await page.getByLabel(/Sex/i).selectOption('F');
    await page.getByLabel(/^Email$/i).fill(patientEmail);
    await page.getByRole('button', { name: /save & register/i }).click();
    await expect(page.getByText('Patient registered')).toBeVisible();

    await page.getByRole('link', { name: /place an order/i }).click();
    await page.getByLabel(/Glucose/i).click();
    await page.getByRole('button', { name: /place order/i }).click();
    await expect(page.getByText('Order placed')).toBeVisible();
    await page.getByRole('link', { name: /view order/i }).click();

    // -- Accession and sign out an AP case (same minimal 1-part/1-block/
    // 1-slide shape case-sign-out.spec.ts already established) --
    await page.getByRole('link', { name: /new ap case/i }).click();
    await page.getByLabel(/Part 1 specimen type/i).fill('tissue');
    await page.getByRole('button', { name: /accession case/i }).click();
    await expect(page.getByText('Case accessioned')).toBeVisible();
    await page.getByRole('link', { name: /view case/i }).click();

    await page.getByRole('button', { name: /^add block$/i }).click();
    await expect(page.getByText(/^Block /)).toBeVisible();
    await page.getByRole('button', { name: /^add slide$/i }).click();
    await expect(page.getByText(/^Slide /)).toBeVisible();

    await page.getByRole('button', { name: /sign out this case/i }).click();
    // signOutCase's own success proof (see case-sign-out.spec.ts's header
    // comment): the case's status badge, not a client state that unmounts.
    await expect(page.getByText('signed_out', { exact: true })).toBeVisible();

    // -- Send the now-signed report by email through the real form -----
    // The "Email to" field is already prefilled from the patient's own
    // on-file email (page.tsx's own fetch) -- no need to fill it, matches
    // the real common case of accepting the default recipient.
    await expect(page.getByLabel(/Email to/i)).toHaveValue(patientEmail);
    await page.getByRole('button', { name: /send by email/i }).click();
    await expect(page.getByText(`Sent to ${patientEmail}.`)).toBeVisible();

    // -- The real proof this isn't just a client-side success message:
    // a genuine SMTP conversation happened, verified via MailHog's own
    // REST API against the actual received message. --
    await expect(async () => {
      const res = await page.request.get(`${MAILHOG_API}/messages`);
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as { items: MailhogMessage[] };
      const match = body.items.find((m) =>
        m.To.some(
          (recipient) => `${recipient.Mailbox}@${recipient.Domain}` === patientEmail,
        ),
      );
      expect(match).toBeTruthy();
      // Q-encoding leaves plain ASCII words (and underscores for spaces)
      // untouched -- no need to decode the header to check this substring.
      expect(match?.Content.Headers.Subject?.[0]).toContain('Pathology_report');
      expect(match?.Content.Body).toContain('application/pdf');
      expect(match?.Content.Body).toMatch(/filename="case-report-.*\.pdf"/);
    }).toPass({ timeout: 10_000 });
  });
});
