import { describe, expect, it } from 'vitest';
import { patientSearchQuerySchema } from './patient';

/**
 * `patientSearchQuerySchema`'s one real cross-field rule: at least one of
 * five mutually-independent lookup modes must be present (mrn, nationalId,
 * q, recent, or firstName+lastName+birthDate all three together) -- an
 * empty query is deliberately rejected (fail-closed, ADR-0013), not
 * silently treated as "list everything" or "recent." Five real ways to
 * satisfy the refine, each worth its own case.
 */
describe('patientSearchQuerySchema', () => {
  it('accepts mrn alone', () => {
    expect(patientSearchQuerySchema.safeParse({ mrn: 'BC83C29009' }).success).toBe(true);
  });

  it('accepts nationalId alone', () => {
    expect(patientSearchQuerySchema.safeParse({ nationalId: '12345678' }).success).toBe(true);
  });

  it('accepts q (free-text) alone', () => {
    expect(patientSearchQuerySchema.safeParse({ q: 'Wanjiru' }).success).toBe(true);
  });

  it('accepts recent: "true" alone, with nothing else', () => {
    expect(patientSearchQuerySchema.safeParse({ recent: 'true' }).success).toBe(true);
  });

  it('rejects recent as any value other than the literal string "true"', () => {
    expect(patientSearchQuerySchema.safeParse({ recent: 'false' }).success).toBe(false);
    expect(patientSearchQuerySchema.safeParse({ recent: true }).success).toBe(false);
  });

  it('accepts firstName+lastName+birthDate all three together', () => {
    const result = patientSearchQuerySchema.safeParse({
      firstName: 'Amina',
      lastName: 'Wanjiru',
      birthDate: '1990-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects firstName alone, without lastName+birthDate', () => {
    expect(patientSearchQuerySchema.safeParse({ firstName: 'Amina' }).success).toBe(false);
  });

  it('rejects firstName+lastName without birthDate -- all three are required together, not two of three', () => {
    const result = patientSearchQuerySchema.safeParse({
      firstName: 'Amina',
      lastName: 'Wanjiru',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a completely empty query -- fails closed, not "list everything"', () => {
    expect(patientSearchQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a malformed birthDate even when firstName/lastName are present', () => {
    const result = patientSearchQuerySchema.safeParse({
      firstName: 'Amina',
      lastName: 'Wanjiru',
      birthDate: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});
