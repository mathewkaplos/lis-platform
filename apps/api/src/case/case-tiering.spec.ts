import { describe, expect, it } from 'vitest';
import { requiresTwoTierReview } from './case-tiering';

describe('requiresTwoTierReview', () => {
  it('returns false for an empty list', () => {
    expect(requiresTwoTierReview([])).toBe(false);
  });

  it('returns false for histology-only specimen types', () => {
    expect(requiresTwoTierReview(['tissue'])).toBe(false);
  });

  it('returns true when the only part is cervical cytology', () => {
    expect(requiresTwoTierReview(['cervical_cytology'])).toBe(true);
  });

  it('returns true when any part among several is cervical cytology', () => {
    expect(requiresTwoTierReview(['tissue', 'cervical_cytology'])).toBe(true);
  });

  it('returns false for an unknown specimen type', () => {
    expect(requiresTwoTierReview(['some_future_specimen_type'])).toBe(false);
  });
});
