import { describe, expect, it } from 'vitest';
import { requirementLabel } from '@lis/domain';

// Issue #664. requirementLabel is a pure function exported from
// packages/domain (no dedicated test infra exists there yet) -- unit-tested
// here alongside this discipline's other synoptic-engine tests, matching
// how dzi-unzip.service.spec.ts already unit-tests exported pure functions
// in this same package.
describe('requirementLabel (issue #664)', () => {
  it('labels required as Core for both source standards', () => {
    expect(requirementLabel('CAP', 'required')).toBe('Core');
    expect(requirementLabel('ICCR', 'required')).toBe('Core');
  });

  it('labels conditional as Conditional for both source standards', () => {
    expect(requirementLabel('CAP', 'conditional')).toBe('Conditional');
    expect(requirementLabel('ICCR', 'conditional')).toBe('Conditional');
  });

  it('labels recommended differently per source standard: Optional for CAP, Non-core for ICCR', () => {
    expect(requirementLabel('CAP', 'recommended')).toBe('Optional');
    expect(requirementLabel('ICCR', 'recommended')).toBe('Non-core');
  });

  it('falls back to the CAP-style label for any other source standard', () => {
    expect(requirementLabel('Bethesda', 'recommended')).toBe('Optional');
  });
});
