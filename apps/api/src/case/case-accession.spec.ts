import { describe, expect, it } from 'vitest';
import {
  deriveBlockCode,
  deriveCaseSpecimenAccessionNumber,
  deriveSlideCode,
} from '@lis/db';

/**
 * FEAT-057 (proposal §5/§8): pure derivation of part/block/slide identifiers
 * off a Case's own accession number -- no DB/network involved, so covered
 * directly rather than only indirectly through case.e2e-spec.ts.
 */
describe('anatomic pathology accession-code derivation', () => {
  it('derives a part accession number as {case}-P{n}', () => {
    expect(deriveCaseSpecimenAccessionNumber('260812-000045', 1)).toBe(
      '260812-000045-P1',
    );
    expect(deriveCaseSpecimenAccessionNumber('260812-000045', 2)).toBe(
      '260812-000045-P2',
    );
  });

  it('derives a case-scoped block code as {case}-B{n}', () => {
    expect(deriveBlockCode('260812-000045', 1)).toBe('260812-000045-B1');
    expect(deriveBlockCode('260812-000045', 2)).toBe('260812-000045-B2');
  });

  it('derives a block-scoped slide code as {block}-S{n}', () => {
    expect(deriveSlideCode('260812-000045-B1', 1)).toBe('260812-000045-B1-S1');
    expect(deriveSlideCode('260812-000045-B1', 2)).toBe('260812-000045-B1-S2');
  });
});
