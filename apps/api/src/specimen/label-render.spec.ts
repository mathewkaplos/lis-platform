import { describe, expect, it } from 'vitest';
import { renderSpecimenLabel } from './label-render';

/**
 * TASK-046 (FEAT-013 revision §8). Real `bwip-js` calls, not a mock
 * (`testing` Skill: verify against the real harness) — the e2e suite
 * (`specimen.e2e-spec.ts`) found that `bwip-js`'s SVG output renders
 * `includetext` as vector glyph paths, not a literal `<text>` element, so
 * string-matching the accession number inside the SVG markup doesn't work
 * for either symbology. Differential testing (different input -> different
 * output) is the real proof available without a barcode-decode dependency
 * (deliberately not added, revision §8): it directly demonstrates the
 * renderer's output actually depends on the accession number passed in,
 * not just that some fixed image was returned.
 */
describe('renderSpecimenLabel', () => {
  it('returns well-formed SVG for both symbologies', () => {
    const { code128Svg, dataMatrixSvg } = renderSpecimenLabel('260805-000123');
    expect(code128Svg.startsWith('<svg')).toBe(true);
    expect(code128Svg.trim().endsWith('</svg>')).toBe(true);
    expect(dataMatrixSvg.startsWith('<svg')).toBe(true);
    expect(dataMatrixSvg.trim().endsWith('</svg>')).toBe(true);
  });

  it('renders different output for different accession numbers, for both symbologies', () => {
    const a = renderSpecimenLabel('260805-000123');
    const b = renderSpecimenLabel('260805-000124');
    expect(a.code128Svg).not.toBe(b.code128Svg);
    expect(a.dataMatrixSvg).not.toBe(b.dataMatrixSvg);
  });

  it('renders identical output for the same accession number (deterministic)', () => {
    const first = renderSpecimenLabel('260805-000999');
    const second = renderSpecimenLabel('260805-000999');
    expect(first.code128Svg).toBe(second.code128Svg);
    expect(first.dataMatrixSvg).toBe(second.dataMatrixSvg);
  });
});
