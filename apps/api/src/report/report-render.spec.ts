import { describe, expect, it } from 'vitest';
import {
  computeReportContentHash,
  isFieldVisible,
  renderTemplateReport,
} from './report-render';
import type { ChemistryReportInput } from './report.types';
import type { ReportTemplateDefinition } from '../report-template/report-template-types';

/**
 * TASK-058 (FEAT-016) originally exercised `renderChemistryReport` directly
 * against a fixed layout. FEAT-032 (docs/plans/feat-032-template-engine-
 * config-driven-versioned.md §6's own top risk) adapts this spec to the
 * generic interpreter's new signature (`templateVersionId` + `definition` +
 * `input`) -- the determinism proofs themselves are unchanged: real calls
 * into the rendering module, not mocked, same as `label-render.spec.ts`'s
 * (TASK-046) own differential-testing pattern.
 */
const SODIUM_ID = '11111111-1111-1111-1111-111111111111';
const POTASSIUM_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_VERSION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const DEFAULT_DEFINITION: ReportTemplateDefinition = {
  sections: [
    {
      title: 'Results',
      fields: [
        {
          key: 'results-table',
          label: 'Results',
          type: 'table',
          analyteBindings: [SODIUM_ID, POTASSIUM_ID],
        },
      ],
    },
  ],
};

function buildInput(
  overrides: Partial<ChemistryReportInput> = {},
): ChemistryReportInput {
  return {
    patient: {
      name: 'Jane Doe',
      mrn: 'MRN-000123',
      dateOfBirth: '1980-04-12',
      sex: 'F',
    },
    specimen: {
      accessionNumber: '260805-000123',
      collectedAt: '2026-08-05T09:30:00Z',
    },
    order: { orderingProviderName: 'Dr. Alice Smith', orderId: 'ORD-1' },
    results: [
      {
        analyteId: SODIUM_ID,
        analyteName: 'Sodium',
        value: '140',
        unit: 'mmol/L',
        flags: ['N'],
        referenceRangeText: '136-145 mmol/L',
        isCritical: false,
      },
      {
        analyteId: POTASSIUM_ID,
        analyteName: 'Potassium',
        value: '6.8',
        unit: 'mmol/L',
        flags: ['HH'],
        referenceRangeText: '3.5-5.1 mmol/L',
        isCritical: true,
      },
    ],
    verifier: {
      name: 'Bob Verifier',
      status: 'verified',
      verifiedAt: '2026-08-05T10:00:00Z',
    },
    ...overrides,
  };
}

function render(input: ChemistryReportInput, definition = DEFAULT_DEFINITION) {
  return renderTemplateReport({
    templateVersionId: TEMPLATE_VERSION_ID,
    definition,
    input,
  });
}

describe('renderTemplateReport', () => {
  it('renders a well-formed PDF buffer', async () => {
    const { pdf } = await render(buildInput());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    // PDF magic bytes / trailer -- proves this is a real PDF, not an empty
    // or malformed buffer.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('is deterministic: the same input twice produces the identical content hash', async () => {
    const input = buildInput();
    const first = await render(input);
    const second = await render(input);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeReportContentHash alone is also deterministic for the same input', () => {
    const input = buildInput();
    const params = {
      templateVersionId: TEMPLATE_VERSION_ID,
      definition: DEFAULT_DEFINITION,
      input,
    };
    expect(computeReportContentHash(params)).toBe(
      computeReportContentHash(params),
    );
  });

  it('produces a different content hash for a different input (differential proof)', async () => {
    const a = await render(buildInput());
    const b = await render(
      buildInput({
        specimen: {
          accessionNumber: '260805-000124',
          collectedAt: '2026-08-05T09:30:00Z',
        },
      }),
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('produces a different content hash when only a single analyte result changes', async () => {
    const a = await render(buildInput());
    const changed = buildInput();
    changed.results[0].value = '141';
    const b = await render(changed);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('produces a different content hash for a different template version rendering the same data (FEAT-032)', async () => {
    const input = buildInput();
    const a = await render(input, DEFAULT_DEFINITION);
    const differentDefinition: ReportTemplateDefinition = {
      sections: [
        {
          title: 'Results',
          fields: [
            {
              key: 'na',
              label: 'Sodium',
              type: 'numeric',
              analyteBinding: SODIUM_ID,
            },
          ],
        },
      ],
    };
    const b = await render(input, differentDefinition);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  describe('isFieldVisible (conditional visibility, reused evaluateCondition)', () => {
    const potassiumCritical = buildInput().results[1]; // isCritical: true
    const field: Parameters<typeof isFieldVisible>[0] = {
      key: 'k-note',
      label: 'Potassium (critical)',
      type: 'numeric',
      analyteBinding: POTASSIUM_ID,
      visibilityCondition: { field: 'isCritical', op: 'eq', value: true },
    };

    it('is visible when the bound result satisfies the condition', () => {
      expect(isFieldVisible(field, potassiumCritical)).toBe(true);
    });

    it('is hidden when the bound result does not satisfy the condition', () => {
      expect(
        isFieldVisible(field, { ...potassiumCritical, isCritical: false }),
      ).toBe(false);
    });

    it('is always visible when the field declares no visibilityCondition', () => {
      const unconditional = { ...field, visibilityCondition: undefined };
      expect(
        isFieldVisible(unconditional, {
          ...potassiumCritical,
          isCritical: false,
        }),
      ).toBe(true);
    });

    it('is hidden (not thrown) when the bound analyte has no resolved result at all', () => {
      expect(isFieldVisible(field, undefined)).toBe(false);
    });
  });

  it('rendering with a hidden conditional field produces a smaller PDF than with it shown -- proves the interpreter actually skips drawing, not just hides text visually', async () => {
    const definition: ReportTemplateDefinition = {
      sections: [
        {
          title: 'Critical commentary',
          fields: [
            {
              key: 'k-note',
              label:
                'Potassium (critical) -- pharmacist review required immediately',
              type: 'numeric',
              analyteBinding: POTASSIUM_ID,
              visibilityCondition: {
                field: 'isCritical',
                op: 'eq',
                value: true,
              },
            },
          ],
        },
      ],
    };
    const { pdf: shown } = await render(buildInput(), definition);

    const notCritical = buildInput();
    notCritical.results[1].isCritical = false;
    const { pdf: hidden } = await render(notCritical, definition);

    expect(hidden.length).toBeLessThan(shown.length);
  });

  /**
   * Not contractually required (only the *hash* must be identical) but
   * empirically true and worth locking in as a real assertion: with every
   * `PDFDocument.info` field pinned via the constructor's own `info`
   * option, two renders of the same input are byte-for-byte identical.
   */
  it('PDF bytes are byte-identical across two runs of the same input', async () => {
    const input = buildInput();
    const first = await render(input);
    const second = await render(input);
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });
});
