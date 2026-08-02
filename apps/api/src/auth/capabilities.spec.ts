import { describe, expect, it } from 'vitest';
import { resolveGrantingRole } from './capabilities';

describe('resolveGrantingRole', () => {
  it('grants enter_result to a technologist', () => {
    expect(resolveGrantingRole(['technologist'], 'enter_result')).toBe(
      'technologist',
    );
  });

  it('denies verify to a technologist (TASK-032 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'verify')).toBeUndefined();
  });

  it('grants both enter_result and verify to a verifier', () => {
    expect(resolveGrantingRole(['verifier'], 'enter_result')).toBe('verifier');
    expect(resolveGrantingRole(['verifier'], 'verify')).toBe('verifier');
  });

  it('grants manage_patients to both technologist and verifier (TASK-039 AC)', () => {
    expect(resolveGrantingRole(['technologist'], 'manage_patients')).toBe(
      'technologist',
    );
    expect(resolveGrantingRole(['verifier'], 'manage_patients')).toBe(
      'verifier',
    );
  });

  it('denies every capability for an empty roles array (ADR-0011 fail-closed AC)', () => {
    expect(resolveGrantingRole([], 'enter_result')).toBeUndefined();
    expect(resolveGrantingRole([], 'verify')).toBeUndefined();
  });

  it('denies a capability no known role grants', () => {
    expect(
      resolveGrantingRole(['technologist', 'verifier'], 'admin' as never),
    ).toBeUndefined();
  });

  it('denies a role name with no entry in the capability map', () => {
    expect(
      resolveGrantingRole(['some-unmapped-role'], 'verify'),
    ).toBeUndefined();
  });

  it('resolves deterministically when multiple held roles grant the same capability', () => {
    // Both technologist and verifier grant enter_result — the result must
    // always be the same role for the same input, not arbitrary, since two
    // audit rows for the same logical action must never disagree on which
    // role authorized it (ADR-0011 §6).
    const first = resolveGrantingRole(
      ['technologist', 'verifier'],
      'enter_result',
    );
    const second = resolveGrantingRole(
      ['verifier', 'technologist'],
      'enter_result',
    );
    expect(first).toBe(second);
    expect(first).toBeDefined();
  });
});
