import { describe, expect, it } from 'vitest';
import { minimize } from './phi-minimization';

describe('phi-minimization: minimize (deny-by-default allowlist)', () => {
  it('keeps only top-level fields named on the allowlist', () => {
    const input = { analyteCode: 'K', value: 5.2, patientName: 'Jane Doe' };
    expect(minimize(input, ['analyteCode', 'value'])).toEqual({
      analyteCode: 'K',
      value: 5.2,
    });
  });

  it('denies everything when the allowlist is empty', () => {
    const input = { analyteCode: 'K', value: 5.2 };
    expect(minimize(input, [])).toEqual({});
  });

  it('keeps only the named nested path, not sibling fields at the same level', () => {
    const input = {
      patient: { age: 45, name: 'Jane Doe', mrn: 'MRN123' },
      observation: { value: 5.2, referenceRange: '3.5-5.1' },
    };
    expect(minimize(input, ['patient.age', 'observation.value'])).toEqual({
      patient: { age: 45 },
      observation: { value: 5.2 },
    });
  });

  it("silently omits an allowlisted path that doesn't exist on the input, rather than throwing", () => {
    const input = { patient: { age: 45 } };
    expect(
      minimize(input, ['patient.age', 'patient.mrn', 'missing.path']),
    ).toEqual({
      patient: { age: 45 },
    });
  });

  it('never leaks a field just because a sibling path was allowlisted', () => {
    const input = { patient: { age: 45, mrn: 'MRN123' } };
    const result = minimize(input, ['patient.age']);
    expect(result).toEqual({ patient: { age: 45 } });
    expect(result.patient).not.toHaveProperty('mrn');
  });
});
