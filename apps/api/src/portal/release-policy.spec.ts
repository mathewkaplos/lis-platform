import { isReleased, type ReleasePolicy } from './release-policy';

describe('isReleased', () => {
  it('is always released immediately under an immediate policy, regardless of how recently verified', () => {
    const policy: ReleasePolicy = { mode: 'immediate', delayHours: 0 };
    const verifiedAt = new Date('2026-08-10T12:00:00.000Z');
    const now = new Date('2026-08-10T12:00:00.001Z');
    expect(isReleased(policy, verifiedAt, now)).toBe(true);
  });

  it('is NOT released before the delay window has elapsed', () => {
    const policy: ReleasePolicy = { mode: 'delayed', delayHours: 24 };
    const verifiedAt = new Date('2026-08-10T12:00:00.000Z');
    const now = new Date('2026-08-10T13:00:00.000Z'); // only 1h later
    expect(isReleased(policy, verifiedAt, now)).toBe(false);
  });

  it('becomes released exactly at the delay boundary (inclusive)', () => {
    const policy: ReleasePolicy = { mode: 'delayed', delayHours: 1 };
    const verifiedAt = new Date('2026-08-10T12:00:00.000Z');
    const now = new Date('2026-08-10T13:00:00.000Z'); // exactly 1h later
    expect(isReleased(policy, verifiedAt, now)).toBe(true);
  });

  it('is released well after the delay window has elapsed', () => {
    const policy: ReleasePolicy = { mode: 'delayed', delayHours: 1 };
    const verifiedAt = new Date('2026-08-10T12:00:00.000Z');
    const now = new Date('2026-08-11T12:00:00.000Z'); // 24h later
    expect(isReleased(policy, verifiedAt, now)).toBe(true);
  });

  it('a zero-hour delayed policy behaves like immediate release', () => {
    const policy: ReleasePolicy = { mode: 'delayed', delayHours: 0 };
    const verifiedAt = new Date('2026-08-10T12:00:00.000Z');
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isReleased(policy, verifiedAt, now)).toBe(true);
  });
});
