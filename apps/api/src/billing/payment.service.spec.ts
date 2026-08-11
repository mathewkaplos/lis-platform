import { describe, expect, it } from 'vitest';
import { computeInvoiceStatus } from './payment.service';

/**
 * The DB round trip (real payment writes, real invoice status persistence,
 * RLS isolation) is covered by test/billing.e2e-spec.ts
 * (`engineering/testing` entry #1). This spec covers only the pure status-
 * transition arithmetic in isolation.
 */
describe('computeInvoiceStatus', () => {
  it('is unpaid when nothing has been paid', () => {
    expect(computeInvoiceStatus(0, 1000)).toBe('unpaid');
  });

  it('is partial when some but not all has been paid', () => {
    expect(computeInvoiceStatus(400, 1000)).toBe('partial');
  });

  it('is paid when the exact total has been paid', () => {
    expect(computeInvoiceStatus(1000, 1000)).toBe('paid');
  });

  it('is paid when overpaid (never a negative-balance/credit concept -- ADR-0041, no ledger)', () => {
    expect(computeInvoiceStatus(1200, 1000)).toBe('paid');
  });

  it('is unpaid for a negative paid amount (defensive -- should never happen given the SUM(...) query it wraps)', () => {
    expect(computeInvoiceStatus(-1, 1000)).toBe('unpaid');
  });
});
