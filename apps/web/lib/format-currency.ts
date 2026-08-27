/**
 * Issue #765 (pilot-readiness audit, found live 2026-08-26). Invoice/payment/
 * facility-statement UI hardcoded a `$` (USD) symbol and "Amount (USD)"
 * label regardless of the tenant's own `currency` setting
 * (`packages/domain/src/org-settings.ts`) -- confirmed live with the tenant
 * set to `KES`, every amount still showed `$`.
 *
 * `currency` is free text, not a constrained enum (org-settings-form.tsx's
 * own header comment) -- `Intl.NumberFormat` throws a `RangeError` on an
 * invalid ISO 4217 code (e.g. the guide's own "banana" example), so this
 * falls back to a plain "<code> <amount>" rendering rather than crashing the
 * page. A missing/blank currency (tenant never set one) defaults to USD,
 * matching this form's own placeholder/prior hardcoded behavior.
 */
export function formatMoneyCents(cents: number, currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(
      cents / 100,
    );
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}
