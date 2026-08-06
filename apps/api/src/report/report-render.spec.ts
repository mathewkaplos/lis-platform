import { describe, expect, it } from 'vitest';
import {
  computeReportContentHash,
  renderChemistryReport,
} from './report-render';
import type { ChemistryReportInput } from './report.types';

/**
 * TASK-058 (FEAT-016, docs/plans/feat-016-minimal-report.md §7/§8). Mirrors
 * `label-render.spec.ts`'s (TASK-046) own differential-testing pattern:
 * real calls into the rendering module, not mocked, since the actual
 * proof needed is that the same input always produces the same output and
 * different inputs produce different output -- exactly what the AC
 * ("output is deterministic and the content hash is recorded") requires,
 * not something a mock could demonstrate.
 */
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
        analyteName: 'Sodium',
        value: '140',
        unit: 'mmol/L',
        flags: ['N'],
        referenceRangeText: '136-145 mmol/L',
        isCritical: false,
      },
      {
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

describe('renderChemistryReport', () => {
  it('renders a well-formed PDF buffer', async () => {
    const { pdf } = await renderChemistryReport(buildInput());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    // PDF magic bytes / trailer -- proves this is a real PDF, not an empty
    // or malformed buffer.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('is deterministic: the same input twice produces the identical content hash', async () => {
    const input = buildInput();
    const first = await renderChemistryReport(input);
    const second = await renderChemistryReport(input);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeReportContentHash alone is also deterministic for the same input', () => {
    const input = buildInput();
    expect(computeReportContentHash(input)).toBe(
      computeReportContentHash(input),
    );
  });

  it('produces a different content hash for a different input (differential proof)', async () => {
    const a = await renderChemistryReport(buildInput());
    const b = await renderChemistryReport(
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
    const a = await renderChemistryReport(buildInput());
    const changed = buildInput();
    changed.results[0].value = '141';
    const b = await renderChemistryReport(changed);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  /**
   * Not contractually required (proposal §10 Q2: only the *hash* must be
   * identical) but empirically true and worth locking in as a real
   * assertion, not just a log line: with every `PDFDocument.info` field
   * pinned via the *constructor's own* `info` option (see `report-
   * render.ts`'s own header comment on why passing it post-construction
   * doesn't work -- pdfkit's trailer `/ID` is derived from `info` inside
   * the constructor itself), two renders of the same input are actually
   * byte-for-byte identical, not merely hash-identical.
   */
  it('PDF bytes are byte-identical across two runs of the same input', async () => {
    const input = buildInput();
    const first = await renderChemistryReport(input);
    const second = await renderChemistryReport(input);
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });
});
