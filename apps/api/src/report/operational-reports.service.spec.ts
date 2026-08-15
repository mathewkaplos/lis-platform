import { describe, expect, it } from 'vitest';
import {
  computeWithinTargetPct,
  mean,
  median,
} from './operational-reports.service';

/**
 * FEAT-034 (docs/plans/feat-034-operational-reports-tat-workload.md §8).
 * The DB-querying aggregation functions themselves are proven against real
 * Postgres via `operational-reports.e2e-spec.ts` (`engineering/testing`
 * Skill entry #1) -- this covers only the pure math they compose.
 */
describe('mean', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([10, 20, 30])).toBe(20);
  });

  it('handles a single value', () => {
    expect(mean([42])).toBe(42);
  });
});

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('handles a single value', () => {
    expect(median([7])).toBe(7);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

/**
 * task-565 (docs/plans/task-565-operational-reports-tat-window-contamination.md).
 * Extracted from `computeTatReport`'s inline `byPriority` calculation so the
 * exact-value arithmetic proof doesn't depend on `computeTatReport`'s own
 * e2e-level `byPriority` bucket, which aggregates unscoped tenant-wide
 * activity and is contamination-prone under a full-suite run (see
 * `engineering/testing` Skill entry #13 and its task-565 follow-up entry).
 */
describe('computeWithinTargetPct', () => {
  it('returns null when no target is defined for the priority', () => {
    expect(computeWithinTargetPct([5, 10], undefined)).toBeNull();
  });

  it('returns 100 when every value is within target', () => {
    expect(computeWithinTargetPct([5, 10, 15], 20)).toBe(100);
  });

  it('returns 0 when every value exceeds target', () => {
    expect(computeWithinTargetPct([30, 40], 20)).toBe(0);
  });

  it('computes the real percentage for a mixed set, target inclusive', () => {
    // 20 counts as within target (<=), so 2 of 4 values qualify (5, 20).
    expect(computeWithinTargetPct([5, 20, 25, 30], 20)).toBe(50);
  });

  it('handles a single value', () => {
    expect(computeWithinTargetPct([10], 20)).toBe(100);
  });
});
