import { describe, expect, it } from 'vitest';
import {
  computeCumulativeReportContentHash,
  renderCumulativeReport,
} from './cumulative-report-render';
import type { CumulativeReportData } from './cumulative-report-assembly';

/**
 * FEAT-033 (docs/plans/feat-033-cumulative-clinical-reports.md §8). Mirrors
 * `report-render.spec.ts`'s own differential/determinism-testing pattern --
 * real calls into the rendering module, not mocked. Includes a large-N
 * render (§6's own "unbounded history" risk), not just a 2-3-entry fixture.
 */
function buildEntry(
  overrides: Partial<CumulativeReportData['entries'][number]> = {},
): CumulativeReportData['entries'][number] {
  return {
    observationId: '11111111-1111-1111-1111-111111111111',
    producedAt: 'Aug 5, 2026, 9:30:00 AM',
    value: '140',
    unit: 'mmol/L',
    flags: ['N'],
    referenceRangeText: '136-145 mmol/L',
    isCritical: false,
    verifierUserId: '22222222-2222-2222-2222-222222222222',
    ...overrides,
  };
}

function buildData(
  overrides: Partial<CumulativeReportData> = {},
): CumulativeReportData {
  return {
    patient: { name: 'Jane Doe', mrn: 'MRN-000123', dateOfBirth: '1980-04-12' },
    analyte: { display: 'Sodium' },
    entries: [buildEntry()],
    ...overrides,
  };
}

describe('renderCumulativeReport', () => {
  it('renders a well-formed PDF buffer', async () => {
    const { pdf } = await renderCumulativeReport(buildData());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('renders a real, distinguishable empty state for zero entries', async () => {
    // Not a literal-text-in-PDF-bytes assertion -- pdfkit's own hex-bracketed
    // `TJ` glyph-run encoding makes that unreliable even uncompressed
    // (`engineering/pdf-generation` Skill entry #7). A real, well-formed PDF
    // that's structurally distinct (no table drawn) from the populated case
    // is the honest proof available here.
    const empty = await renderCumulativeReport(buildData({ entries: [] }));
    const populated = await renderCumulativeReport(buildData());
    expect(Buffer.isBuffer(empty.pdf)).toBe(true);
    expect(empty.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(empty.contentHash).not.toBe(populated.contentHash);
  });

  it('is deterministic: the same input twice produces the identical content hash', async () => {
    const data = buildData();
    const first = await renderCumulativeReport(data);
    const second = await renderCumulativeReport(data);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeCumulativeReportContentHash alone is also deterministic', () => {
    const data = buildData();
    expect(computeCumulativeReportContentHash(data)).toBe(
      computeCumulativeReportContentHash(data),
    );
  });

  it('produces a different content hash for a different input (differential proof)', async () => {
    const a = await renderCumulativeReport(buildData());
    const b = await renderCumulativeReport(
      buildData({ entries: [buildEntry({ value: '141' })] }),
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('PDF bytes are byte-identical across two runs of the same input', async () => {
    const data = buildData();
    const first = await renderCumulativeReport(data);
    const second = await renderCumulativeReport(data);
    expect(first.pdf.equals(second.pdf)).toBe(true);
  });

  it('renders correctly with a large history (§6: no small-cap assumption)', async () => {
    const entries = Array.from({ length: 200 }, (_, i) =>
      buildEntry({
        observationId: `entry-${i}`,
        producedAt: `Day ${i}`,
        value: String(100 + i),
      }),
    );
    const { pdf, contentHash } = await renderCumulativeReport(
      buildData({ entries }),
    );
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
