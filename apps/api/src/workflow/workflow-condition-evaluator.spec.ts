import {
  evaluateCondition,
  findUnallowedFields,
} from './workflow-condition-evaluator';
import { ALLOWED_FIELDS, type ConditionNode } from './workflow-types';

describe('evaluateCondition', () => {
  it('eq matches an equal value', () => {
    const node: ConditionNode = {
      field: 'status',
      op: 'eq',
      value: 'verified',
    };
    expect(evaluateCondition(node, { status: 'verified' })).toBe(true);
    expect(evaluateCondition(node, { status: 'preliminary' })).toBe(false);
  });

  it('neq matches a different value', () => {
    const node: ConditionNode = {
      field: 'status',
      op: 'neq',
      value: 'verified',
    };
    expect(evaluateCondition(node, { status: 'preliminary' })).toBe(true);
    expect(evaluateCondition(node, { status: 'verified' })).toBe(false);
  });

  it('gt/gte/lt/lte compare numbers, false for non-numbers', () => {
    expect(
      evaluateCondition(
        { field: 'valueNum', op: 'gt', value: 5 },
        { valueNum: 6 },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'valueNum', op: 'gt', value: 5 },
        { valueNum: 5 },
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        { field: 'valueNum', op: 'gte', value: 5 },
        { valueNum: 5 },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'valueNum', op: 'lt', value: 5 },
        { valueNum: 4 },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'valueNum', op: 'lte', value: 5 },
        { valueNum: 5 },
      ),
    ).toBe(true);
    expect(
      evaluateCondition(
        { field: 'valueNum', op: 'gt', value: 5 },
        { valueNum: 'not-a-number' },
      ),
    ).toBe(false);
  });

  it("in matches membership in the rule's own value array", () => {
    const node: ConditionNode = {
      field: 'status',
      op: 'in',
      value: ['verified', 'preliminary'],
    };
    expect(evaluateCondition(node, { status: 'verified' })).toBe(true);
    expect(evaluateCondition(node, { status: 'registered' })).toBe(false);
  });

  it("includes matches membership in the context's own array field", () => {
    const node: ConditionNode = { field: 'flags', op: 'includes', value: 'HH' };
    expect(evaluateCondition(node, { flags: ['HH', 'D'] })).toBe(true);
    expect(evaluateCondition(node, { flags: ['N'] })).toBe(false);
    expect(evaluateCondition(node, { flags: 'not-an-array' })).toBe(false);
  });

  it('and requires every child to match', () => {
    const node: ConditionNode = {
      and: [
        { field: 'status', op: 'eq', value: 'verified' },
        { field: 'flags', op: 'includes', value: 'HH' },
      ],
    };
    expect(evaluateCondition(node, { status: 'verified', flags: ['HH'] })).toBe(
      true,
    );
    expect(evaluateCondition(node, { status: 'verified', flags: ['N'] })).toBe(
      false,
    );
  });

  it('or requires at least one child to match', () => {
    const node: ConditionNode = {
      or: [
        { field: 'flags', op: 'includes', value: 'HH' },
        { field: 'flags', op: 'includes', value: 'LL' },
      ],
    };
    expect(evaluateCondition(node, { flags: ['LL'] })).toBe(true);
    expect(evaluateCondition(node, { flags: ['N'] })).toBe(false);
  });

  it('not inverts its child', () => {
    const node: ConditionNode = {
      not: { field: 'status', op: 'eq', value: 'verified' },
    };
    expect(evaluateCondition(node, { status: 'preliminary' })).toBe(true);
    expect(evaluateCondition(node, { status: 'verified' })).toBe(false);
  });

  it('nests and/or/not arbitrarily deep', () => {
    const node: ConditionNode = {
      and: [
        { field: 'status', op: 'eq', value: 'verified' },
        {
          or: [
            { field: 'flags', op: 'includes', value: 'HH' },
            { not: { field: 'source', op: 'eq', value: 'manual' } },
          ],
        },
      ],
    };
    expect(
      evaluateCondition(node, {
        status: 'verified',
        flags: ['N'],
        source: 'analyzer',
      }),
    ).toBe(true);
    expect(
      evaluateCondition(node, {
        status: 'verified',
        flags: ['N'],
        source: 'manual',
      }),
    ).toBe(false);
  });
});

describe('findUnallowedFields', () => {
  it('returns empty for every allow-listed field', () => {
    const node: ConditionNode = {
      and: [
        { field: 'flags', op: 'includes', value: 'HH' },
        { field: 'status', op: 'eq', value: 'verified' },
      ],
    };
    expect(findUnallowedFields(node, ALLOWED_FIELDS)).toEqual([]);
  });

  it('finds a field not in the allow-list, nested inside and/or/not', () => {
    const node: ConditionNode = {
      or: [
        { field: 'flags', op: 'includes', value: 'HH' },
        { not: { field: 'patientAgeYears', op: 'gt', value: 65 } },
      ],
    };
    expect(findUnallowedFields(node, ALLOWED_FIELDS)).toEqual([
      'patientAgeYears',
    ]);
  });

  it('accepts a caller-supplied allow-list different from workflow ALLOWED_FIELDS (FEAT-032 reuse)', () => {
    const node: ConditionNode = {
      field: 'analyteName',
      op: 'eq',
      value: 'TSH',
    };
    expect(findUnallowedFields(node, ['analyteName'])).toEqual([]);
    expect(findUnallowedFields(node, ALLOWED_FIELDS)).toEqual(['analyteName']);
  });
});
