import { describe, expect, it } from 'vitest';
import { checkAutoVerifyGates } from './auto-verify-gates';

const base = { flags: ['N'], source: 'analyzer', qcHeld: false };

describe('checkAutoVerifyGates', () => {
  it('allows a clean-normal, analyzer-sourced, QC-clear result', () => {
    expect(checkAutoVerifyGates(base)).toBeNull();
  });

  it('refuses a critical (HH/LL) result, regardless of other fields', () => {
    expect(checkAutoVerifyGates({ ...base, flags: ['HH'] })).toBe('critical');
    expect(checkAutoVerifyGates({ ...base, flags: ['LL'] })).toBe('critical');
  });

  it("refuses anything other than exactly ['N'] (H/L, and N with an extra flag like D)", () => {
    expect(checkAutoVerifyGates({ ...base, flags: ['H'] })).toBe(
      'not_clean_normal',
    );
    expect(checkAutoVerifyGates({ ...base, flags: ['L'] })).toBe(
      'not_clean_normal',
    );
    expect(checkAutoVerifyGates({ ...base, flags: ['N', 'D'] })).toBe(
      'not_clean_normal',
    );
    expect(checkAutoVerifyGates({ ...base, flags: [] })).toBe(
      'not_clean_normal',
    );
  });

  it('refuses a manually-entered result, even if clean-normal', () => {
    expect(checkAutoVerifyGates({ ...base, source: 'manual' })).toBe(
      'not_analyzer',
    );
    expect(checkAutoVerifyGates({ ...base, source: 'calculated' })).toBe(
      'not_analyzer',
    );
  });

  it('refuses a result held by an unresolved QC violation', () => {
    expect(checkAutoVerifyGates({ ...base, qcHeld: true })).toBe('qc_held');
  });

  it(
    'refuses a synoptic-response Observation (FEAT-058/059 AC #4) — every ' +
      'discrete/grid Observation assembleAndPersistSynopticResponse writes ' +
      "is source: 'manual' (synoptic-response-recorder.ts), so this gate " +
      'structurally blocks the auto-verify engine from ever finalizing AP ' +
      'content, with no AP-specific exclusion code needed anywhere',
    () => {
      expect(checkAutoVerifyGates({ ...base, source: 'manual' })).toBe(
        'not_analyzer',
      );
    },
  );

  it('checks critical before any other gate, even when multiple would fail', () => {
    expect(
      checkAutoVerifyGates({
        flags: ['HH'],
        source: 'manual',
        qcHeld: true,
      }),
    ).toBe('critical');
  });
});
