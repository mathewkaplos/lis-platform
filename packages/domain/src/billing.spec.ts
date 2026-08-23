import { describe, expect, it } from 'vitest';
import { generateInvoiceRequestSchema } from './billing';

/**
 * `generateInvoiceRequestSchema` is the one schema in this module with a
 * real cross-field rule (payerType 'corporate' requires
 * referringFacilityId) plus a `.default({})` specifically added so every
 * existing no-body caller of `POST /v1/orders/:id/invoice` keeps parsing
 * (its own comment) -- both are exactly the kind of behavior a schema
 * refactor could silently break without a test catching it.
 */
describe('generateInvoiceRequestSchema', () => {
  it('parses a completely absent body to the cash/no-facility default', () => {
    const result = generateInvoiceRequestSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it('parses an explicit empty object', () => {
    expect(generateInvoiceRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts payerType "cash" with no referringFacilityId', () => {
    expect(generateInvoiceRequestSchema.safeParse({ payerType: 'cash' }).success).toBe(true);
  });

  it('accepts payerType "corporate" with a referringFacilityId', () => {
    const result = generateInvoiceRequestSchema.safeParse({
      payerType: 'corporate',
      referringFacilityId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.success).toBe(true);
  });

  it('rejects payerType "corporate" with no referringFacilityId', () => {
    const result = generateInvoiceRequestSchema.safeParse({ payerType: 'corporate' });
    expect(result.success).toBe(false);
  });

  it('rejects a referringFacilityId that is not a real UUID', () => {
    const result = generateInvoiceRequestSchema.safeParse({
      payerType: 'corporate',
      referringFacilityId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a referringFacilityId with no payerType set at all -- the refine only fires for "corporate"', () => {
    const result = generateInvoiceRequestSchema.safeParse({
      referringFacilityId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unrecognized payerType value', () => {
    expect(generateInvoiceRequestSchema.safeParse({ payerType: 'insurance' }).success).toBe(false);
  });
});
