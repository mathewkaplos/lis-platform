import { validateReportTemplateDefinition } from './report-template-guardrails';
import type { ReportTemplateDefinition } from './report-template-types';

const ANALYTE_A = '11111111-1111-1111-1111-111111111111';
const ANALYTE_B = '22222222-2222-2222-2222-222222222222';
const VALID_ANALYTES = new Set([ANALYTE_A, ANALYTE_B]);

function definition(
  overrides: Partial<ReportTemplateDefinition> = {},
): ReportTemplateDefinition {
  return {
    sections: [
      {
        title: 'Results',
        fields: [
          {
            key: 'a',
            label: 'Analyte A',
            type: 'numeric',
            analyteBinding: ANALYTE_A,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('validateReportTemplateDefinition', () => {
  it('accepts a well-formed numeric field bound to a real analyte on this test', () => {
    expect(
      validateReportTemplateDefinition(definition(), VALID_ANALYTES),
    ).toEqual([]);
  });

  it('rejects a numeric/coded field with no analyteBinding', () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [{ key: 'a', label: 'A', type: 'coded' }],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('must declare an analyteBinding');
  });

  it("rejects a field bound to an analyte not in this test's own analyte set", () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [
              {
                key: 'a',
                label: 'A',
                type: 'numeric',
                analyteBinding: '99999999-9999-9999-9999-999999999999',
              },
            ],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not one of this test');
  });

  it('accepts a table field with valid analyteBindings', () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [
              {
                key: 't',
                label: 'Results table',
                type: 'table',
                analyteBindings: [ANALYTE_A, ANALYTE_B],
              },
            ],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toEqual([]);
  });

  it('rejects a table field with no analyteBindings', () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [{ key: 't', label: 'T', type: 'table' }],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('at least one analyteBindings');
  });

  it('rejects a visibilityCondition referencing a field not in TEMPLATE_ALLOWED_FIELDS', () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [
              {
                key: 'a',
                label: 'A',
                type: 'numeric',
                analyteBinding: ANALYTE_A,
                visibilityCondition: { field: 'valueNum', op: 'gt', value: 5 },
              },
            ],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('valueNum');
  });

  it('accepts a visibilityCondition referencing an allow-listed field', () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [
              {
                key: 'a',
                label: 'A',
                type: 'numeric',
                analyteBinding: ANALYTE_A,
                visibilityCondition: {
                  field: 'flags',
                  op: 'includes',
                  value: 'HH',
                },
              },
            ],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toEqual([]);
  });

  it('rejects a visibilityCondition on a table field', () => {
    const errors = validateReportTemplateDefinition(
      definition({
        sections: [
          {
            title: 'Results',
            fields: [
              {
                key: 't',
                label: 'T',
                type: 'table',
                analyteBindings: [ANALYTE_A],
                visibilityCondition: {
                  field: 'flags',
                  op: 'includes',
                  value: 'HH',
                },
              },
            ],
          },
        ],
      }),
      VALID_ANALYTES,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('cannot declare a visibilityCondition');
  });

  it('rejects a duplicate field key across sections', () => {
    const errors = validateReportTemplateDefinition(
      {
        sections: [
          {
            title: 'S1',
            fields: [
              {
                key: 'dup',
                label: 'A',
                type: 'numeric',
                analyteBinding: ANALYTE_A,
              },
            ],
          },
          {
            title: 'S2',
            fields: [
              {
                key: 'dup',
                label: 'B',
                type: 'numeric',
                analyteBinding: ANALYTE_B,
              },
            ],
          },
        ],
      },
      VALID_ANALYTES,
    );
    expect(errors.some((e) => e.includes('used more than once'))).toBe(true);
  });

  it('collects errors across multiple fields, not just the first', () => {
    const errors = validateReportTemplateDefinition(
      {
        sections: [
          {
            title: 'S1',
            fields: [
              { key: 'a', label: 'A', type: 'coded' },
              { key: 't', label: 'T', type: 'table' },
            ],
          },
        ],
      },
      VALID_ANALYTES,
    );
    expect(errors).toHaveLength(2);
  });
});
