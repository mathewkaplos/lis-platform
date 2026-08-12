import { describe, expect, it } from 'vitest';
import { formatObservationValue } from './report-assembly';

/**
 * FEAT-054: `formatObservationValue`'s new `dataType === 'table'` branch --
 * real gap found while building a real culture report template (see this
 * function's own header comment). Only the narrow slice this fix touches
 * is covered here; the pre-existing quantity/coded branches were already
 * exercised indirectly by `report-assembly.e2e-spec.ts` and are unchanged.
 */
describe('formatObservationValue', () => {
  it('renders a table observation (antibiogram shape) as a compact, readable summary', () => {
    const value = formatObservationValue({
      dataType: 'table',
      valueNum: null,
      valueCode: null,
      valueText: null,
      valueJson: {
        organismDisplay: 'Escherichia coli',
        results: [
          {
            antimicrobialDisplay: 'Ampicillin',
            micValue: 16,
            interpretation: 'R',
          },
          {
            antimicrobialDisplay: 'Meropenem',
            micValue: 1,
            interpretation: 'S',
          },
        ],
      },
    });
    expect(value).toBe(
      'Escherichia coli — Ampicillin: R (MIC 16); Meropenem: S (MIC 1)',
    );
  });

  it('renders an empty string, never a fabricated value, when a table observation has no results', () => {
    const value = formatObservationValue({
      dataType: 'table',
      valueNum: null,
      valueCode: null,
      valueText: null,
      valueJson: { organismDisplay: 'Escherichia coli', results: [] },
    });
    expect(value).toBe('');
  });

  it('renders an empty string when a table observation has no valueJson at all', () => {
    const value = formatObservationValue({
      dataType: 'table',
      valueNum: null,
      valueCode: null,
      valueText: null,
      valueJson: null,
    });
    expect(value).toBe('');
  });

  it('still renders quantity/coded observations exactly as before (regression)', () => {
    expect(
      formatObservationValue({
        dataType: 'quantity',
        valueNum: '5.2',
        valueCode: null,
        valueText: null,
        valueJson: null,
      }),
    ).toBe('5.2');
    expect(
      formatObservationValue({
        dataType: 'coded',
        valueNum: null,
        valueCode: 'R',
        valueText: null,
        valueJson: null,
      }),
    ).toBe('R');
  });
});
