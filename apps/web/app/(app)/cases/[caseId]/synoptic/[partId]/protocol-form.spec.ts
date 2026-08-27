import { describe, expect, it } from 'vitest';
import type { SynopticElement, SynopticResponseResultEntry } from '@lis/domain';
import { formatResultValue } from './format-result-value';

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
    responseOptions: [
      {
        id: crypto.randomUUID(),
        value: 'low_anterior_resection',
        display: 'Low anterior resection',
        displayOrder: 1,
        codeSystemValueId: null,
        codeSystemCode: null,
        codeSystemDisplay: null,
      },
      {
        id: crypto.randomUUID(),
        value: 'right_hemicolectomy',
        display: 'Right hemicolectomy',
        displayOrder: 2,
        codeSystemValueId: null,
        codeSystemCode: null,
        codeSystemDisplay: null,
      },
    ],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<SynopticResponseResultEntry> = {}): SynopticResponseResultEntry {
  return {
    elementKey: 'operative_procedure',
    elementLabel: 'Operative procedure',
    value: 'low_anterior_resection',
    observationId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('formatResultValue', () => {
  it('resolves a coded value to its display label, not the raw stored code', () => {
    const element = makeElement();
    const map = new Map([[element.key, element]]);
    const entry = makeEntry({ value: 'low_anterior_resection' });
    expect(formatResultValue(entry, map)).toBe('Low anterior resection');
  });

  it('resolves every value in a coded_multi array to its own display label', () => {
    const element = makeElement({
      key: 'additional_findings',
      dataType: 'coded_multi',
      responseOptions: [
        {
          id: crypto.randomUUID(),
          value: 'adenoma',
          display: 'Adenoma(s)',
          displayOrder: 1,
          codeSystemValueId: null,
          codeSystemCode: null,
          codeSystemDisplay: null,
        },
        {
          id: crypto.randomUUID(),
          value: 'crohn_disease',
          display: 'Crohn disease',
          displayOrder: 2,
          codeSystemValueId: null,
          codeSystemCode: null,
          codeSystemDisplay: null,
        },
      ],
    });
    const map = new Map([[element.key, element]]);
    const entry = makeEntry({
      elementKey: 'additional_findings',
      elementLabel: 'Additional findings',
      value: ['adenoma', 'crohn_disease'],
    });
    expect(formatResultValue(entry, map)).toBe('Adenoma(s), Crohn disease');
  });

  it('strips a repeatable instance suffix before looking up the element', () => {
    const element = makeElement();
    const map = new Map([[element.key, element]]);
    const entry = makeEntry({
      elementKey: 'operative_procedure@abc123',
      value: 'right_hemicolectomy',
    });
    expect(formatResultValue(entry, map)).toBe('Right hemicolectomy');
  });

  it('falls back to the raw value when no matching response option is found (e.g. quantity/text elements)', () => {
    const element = makeElement({
      key: 'tumor_size_mm',
      dataType: 'quantity',
      responseOptions: [],
    });
    const map = new Map([[element.key, element]]);
    const entry = makeEntry({ elementKey: 'tumor_size_mm', value: 35 });
    expect(formatResultValue(entry, map)).toBe('35');
  });

  it('falls back to the raw value when the element itself cannot be found', () => {
    const map = new Map<string, SynopticElement>();
    const entry = makeEntry({ elementKey: 'unknown_element', value: 'some_code' });
    expect(formatResultValue(entry, map)).toBe('some_code');
  });
});
