import { describe, expect, it } from 'vitest';
import { formatMoneyCents } from './format-currency';

describe('formatMoneyCents', () => {
  it('formats cents using the tenant currency symbol, not a hardcoded $', () => {
    // Intl.NumberFormat separates a currency code from the amount with a
    // non-breaking space (U+00A0), not a plain space -- confirmed via a
    // direct Node repro, not assumed.
    expect(formatMoneyCents(150000, 'KES')).toBe('KES 1,500.00');
  });

  it('formats USD with its own symbol', () => {
    expect(formatMoneyCents(1050, 'USD')).toBe('$10.50');
  });

  it('is case-insensitive on the stored currency code', () => {
    expect(formatMoneyCents(1050, 'usd')).toBe('$10.50');
  });

  it('defaults to USD when the tenant has no currency set', () => {
    expect(formatMoneyCents(1050, null)).toBe('$10.50');
    expect(formatMoneyCents(1050, undefined)).toBe('$10.50');
    expect(formatMoneyCents(1050, '')).toBe('$10.50');
  });

  it('falls back to a plain "<code> <amount>" rendering for an invalid ISO 4217 code instead of throwing', () => {
    expect(formatMoneyCents(1050, 'banana')).toBe('BANANA 10.50');
  });
});
