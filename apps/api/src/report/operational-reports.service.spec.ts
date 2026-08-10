import { describe, expect, it } from 'vitest';
import { mean, median } from './operational-reports.service';

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
