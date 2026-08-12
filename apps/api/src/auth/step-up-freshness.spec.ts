import { describe, expect, it } from 'vitest';
import { checkStepUpFreshness } from './step-up-freshness';

describe('checkStepUpFreshness', () => {
  it('is fresh exactly at the boundary (now - authTime === maxAgeSeconds)', () => {
    expect(checkStepUpFreshness(1000, 1300, 300)).toBe(true);
  });

  it('is fresh just under the boundary', () => {
    expect(checkStepUpFreshness(1000, 1299, 300)).toBe(true);
  });

  it('is stale just over the boundary', () => {
    expect(checkStepUpFreshness(1000, 1301, 300)).toBe(false);
  });

  it('is fresh when authTime is in the future (clock skew, not a real case but must not throw/misbehave)', () => {
    expect(checkStepUpFreshness(2000, 1000, 300)).toBe(true);
  });

  it("treats authTime=0 (JwtAuthGuard's default for a missing claim) as maximally stale", () => {
    expect(checkStepUpFreshness(0, 1000, 300)).toBe(false);
  });
});
