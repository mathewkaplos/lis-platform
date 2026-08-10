import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { stableStringify } from '@lis/db';
import type { CumulativeReportData } from './cumulative-report-assembly';

/**
 * FEAT-033 (docs/plans/feat-033-cumulative-clinical-reports.md finding #3,
 * §10 Q1 resolved: a new, purpose-built renderer, not
 * `report-render.ts`'s `renderTemplateReport`/`report_template_version`).
 * A cumulative report's own axis -- one row per historical date for a
 * single analyte -- has no fit in FEAT-032's field-type catalog (`table`'s
 * own `analyteBindings` names *which analytes*, not *which dates*). Reuses
 * only the determinism discipline (`engineering/pdf-generation` Skill
 * entries #3/#6), not FEAT-032's data model: hash the canonical input, and
 * pin every `PDFDocument.info` field via the constructor's own `info`
 * option, never after.
 */
export function computeCumulativeReportContentHash(
  data: CumulativeReportData,
): string {
  return createHash('sha256').update(stableStringify(data)).digest('hex');
}

const ENTRY_TABLE_COLUMN_WIDTHS = [110, 70, 55, 45, 175, 90];

function drawCumulativeReport(
  doc: PDFKit.PDFDocument,
  data: CumulativeReportData,
): void {
  const { patient, analyte, entries } = data;

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Cumulative Result Report', { align: 'center' });
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(11).text('Patient / Analyte');
  doc.font('Helvetica').fontSize(10);
  doc.text(
    `Patient: ${patient.name}    MRN: ${patient.mrn}    DOB: ${patient.dateOfBirth}`,
  );
  doc.text(`Analyte: ${analyte.display}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(11).text('History');
  doc.moveDown(0.25);

  if (entries.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('No verified historical results found for this analyte.');
    return;
  }

  const headerRow = [
    'Date',
    'Value',
    'Unit',
    'Flag',
    'Reference Range',
    'Verified By',
  ].map((text) => ({
    text,
    font: { family: 'Helvetica-Bold' },
    backgroundColor: '#eeeeee',
  }));
  const dataRows = entries.map((entry) => {
    const cellStyle = entry.isCritical ? { textColor: 'red' as const } : {};
    return [
      { text: entry.producedAt, ...cellStyle },
      { text: entry.value, ...cellStyle },
      { text: entry.unit, ...cellStyle },
      { text: entry.flags.join(',') || '-', ...cellStyle },
      { text: entry.referenceRangeText, ...cellStyle },
      { text: entry.verifierUserId, ...cellStyle },
    ];
  });

  doc.table({
    columnStyles: ENTRY_TABLE_COLUMN_WIDTHS,
    defaultStyle: { padding: 4, border: 0.5, borderColor: '#999999' },
    data: [headerRow, ...dataRows],
  });
}

export function renderCumulativeReportPdf(
  data: CumulativeReportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Same gotcha as report-render.ts's own header comment: pdfkit's
    // trailer /ID fingerprint is computed synchronously inside `new
    // PDFDocument(...)`, from `info` -- every field must be pinned via the
    // constructor's own `info` option, never set afterward.
    const doc = new PDFDocument({
      margin: 50,
      bufferPages: true,
      compress: false,
      info: {
        CreationDate: new Date(0),
        ModDate: new Date(0),
        Title: `Cumulative Report - ${data.patient.mrn} - ${data.analyte.display}`,
        Author: 'LIS Platform',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCumulativeReport(doc, data);

    doc.end();
  });
}

export interface RenderedCumulativeReport {
  pdf: Buffer;
  contentHash: string;
}

export async function renderCumulativeReport(
  data: CumulativeReportData,
): Promise<RenderedCumulativeReport> {
  const pdf = await renderCumulativeReportPdf(data);
  const contentHash = computeCumulativeReportContentHash(data);
  return { pdf, contentHash };
}
