import { describe, expect, it } from 'vitest';
import { checkReflexGuardrails } from './reflex-guardrails';

describe('checkReflexGuardrails', () => {
  it('allows a reflex with no ancestors', () => {
    expect(checkReflexGuardrails([], 'ft4', 5)).toBeNull();
  });

  it('allows a reflex whose target is not among its ancestors, under the depth bound', () => {
    expect(checkReflexGuardrails(['tsh'], 'ft4', 5)).toBeNull();
    expect(checkReflexGuardrails(['tsh', 'gram'], 'culture', 5)).toBeNull();
  });

  it('refuses a cycle: the target test is already an ancestor', () => {
    expect(checkReflexGuardrails(['tsh', 'ft4'], 'tsh', 5)).toBe('cycle');
    expect(checkReflexGuardrails(['gram', 'culture', 'id'], 'culture', 5)).toBe(
      'cycle',
    );
  });

  it('refuses once the ancestor chain reaches the depth bound, even without a cycle', () => {
    expect(checkReflexGuardrails(['a', 'b', 'c', 'd', 'e'], 'f', 5)).toBe(
      'depth',
    );
  });

  it('allows a chain one below the depth bound', () => {
    expect(checkReflexGuardrails(['a', 'b', 'c', 'd'], 'e', 5)).toBeNull();
  });

  it('respects a custom maxDepth', () => {
    expect(checkReflexGuardrails(['a'], 'b', 1)).toBe('depth');
    expect(checkReflexGuardrails([], 'b', 1)).toBeNull();
  });
});
