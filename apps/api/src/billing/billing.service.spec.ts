import { describe, expect, it } from 'vitest';
import { validateAndTotal } from './billing.service';

/**
 * The DB round trip (real order/catalog reads, real invoice/line-item
 * writes, snapshot correctness, RLS isolation) is covered by
 * test/billing.e2e-spec.ts (`engineering/testing` entry #1). This spec
 * covers only the pure validation/total-computation logic in isolation.
 */
describe('validateAndTotal', () => {
  it('sums priced lines correctly', () => {
    expect(validateAndTotal([{ priceCents: 500 }, { priceCents: 1500 }])).toBe(
      2000,
    );
  });

  it('throws for an empty order (nothing to invoice)', () => {
    expect(() => validateAndTotal([])).toThrow(
      'Order has no ordered tests to invoice',
    );
  });

  it('throws rather than silently billing $0 when any line has no price configured', () => {
    expect(() =>
      validateAndTotal([{ priceCents: 500 }, { priceCents: null }]),
    ).toThrow(/no price configured/);
  });
});
