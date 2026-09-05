import { describe, expect, it } from 'vitest';
import type { SynopticElement } from '@lis/domain';
import { countRequiredProgress } from './progress-count';

const her2PositiveCondition = { field: 'her2_status', op: 'eq' as const, value: 'positive_3plus' };

function makeElement(overrides: Partial<SynopticElement> = {}): SynopticElement {
  return {
    id: crypto.randomUUID(),
    synopticProtocolVersionId: crypto.randomUUID(),
    parentElementId: null,
    key: 'operative_procedure',
    label: 'Operative procedure',
    dataType: 'coded',
    requirement: 'required',
    analyteId: crypto.randomUUID(),
    unitId: null,
    unitDisplay: null,
    visibilityCondition: null,
    displayOrder: 1,
    repeatable: false,
    identityElementKey: null,
    responseOptions: [],
    ...overrides,
  };
}

describe('countRequiredProgress', () => {
  it('counts required and conditional elements, excludes recommended ones', () => {
    const elements = [
      makeElement({ key: 'a', requirement: 'required' }),
      makeElement({ key: 'b', requirement: 'conditional', id: crypto.randomUUID() }),
      makeElement({ key: 'c', requirement: 'recommended', id: crypto.randomUUID() }),
    ];
    expect(countRequiredProgress(elements, {})).toEqual({ answered: 0, total: 2 });
  });

  it('counts an element as answered once its key has a value, matching handleChange/handleToggleMulti\'s own "empty means unanswered" convention', () => {
    const elements = [makeElement({ key: 'a', requirement: 'required' })];
    expect(countRequiredProgress(elements, { a: 'low_anterior_resection' })).toEqual({
      answered: 1,
      total: 1,
    });
  });

  it('excludes an element hidden by its own visibilityCondition from the total', () => {
    const parent = makeElement({ key: 'her2_status', requirement: 'required' });
    const child = makeElement({
      id: crypto.randomUUID(),
      key: 'her2_percent_membrane_staining',
      requirement: 'conditional',
      visibilityCondition: her2PositiveCondition,
    });
    const elements = [parent, child];
    expect(countRequiredProgress(elements, { her2_status: 'negative' })).toEqual({
      answered: 1,
      total: 1,
    });
    expect(
      countRequiredProgress(elements, { her2_status: 'positive_3plus' }),
    ).toEqual({ answered: 1, total: 2 });
  });

  it('excludes a repeatable element and its own children from the count entirely', () => {
    const repeatableParent = makeElement({
      key: 'additional_specimen',
      requirement: 'required',
      repeatable: true,
    });
    const child = makeElement({
      id: crypto.randomUUID(),
      parentElementId: repeatableParent.id,
      key: 'additional_specimen_type',
      requirement: 'required',
    });
    expect(countRequiredProgress([repeatableParent, child], {})).toEqual({
      answered: 0,
      total: 0,
    });
  });

  it('still counts a non-repeatable element with children (both the parent and its child)', () => {
    const parent = makeElement({ key: 'margin_distance_mm', requirement: 'required' });
    const child = makeElement({
      id: crypto.randomUUID(),
      parentElementId: parent.id,
      key: 'margin_distance_mm_precision',
      requirement: 'conditional',
    });
    expect(
      countRequiredProgress([parent, child], { margin_distance_mm: 2 }),
    ).toEqual({ answered: 1, total: 2 });
  });
});
