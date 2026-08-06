import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { stableStringify } from '@lis/db';
import type { ChemistryReportInput } from './report.types';

/**
 * TASK-058 (FEAT-016, docs/plans/feat-016-minimal-report.md §10 Q2,
 * resolved). "Config template" here means one fixed, parameterized
 * chemistry-report layout (finding #2) -- not FEAT-032's own
 * config-driven/versioned template engine.
 *
 * Determinism strategy: hash the canonical *input*, not the rendered PDF
 * bytes. `engineering/pdf-generation` Skill entry #3 (confirmed live
 * against pdfkit's own docs, not assumed): pdfkit's `doc.info.CreationDate`/
 * `ModDate` are "automatically managed" by default, a real source of
 * byte-level non-determinism unrelated to the report's actual content. This
 * repo's existing canonicalize-then-SHA-256 convention
 * (`packages/db/src/audit.ts`'s `stableStringify`, FEAT-009) is reused
 * as-is rather than inventing a second hashing convention -- see that
 * module's own header comment for why key-sorting matters. The hash
 * represents "what data produced this report", computed from the input;
 * it intentionally says nothing about the PDF bytes themselves.
 */
export function computeReportContentHash(input: ChemistryReportInput): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

const RESULT_TABLE_COLUMN_WIDTHS = [130, 70, 55, 45, 175];

/**
 * Draws the fixed chemistry-report layout via pdfkit's own imperative
 * drawing API. Real finding, correcting the proposal's own assumption
 * (`engineering/pdf-generation` Skill, written before this task's
 * implementation): pdfkit >=0.14 ships a native `doc.table()` primitive
 * (`@types/pdfkit`'s `PDFTable` mixin) -- the Skill's "pdfkit has no
 * built-in table primitive, lay out rows/columns manually" is stale
 * against the pinned version (`^0.19.1`) this task actually installed.
 * Used here instead of manual x/y column positioning; see this task's own
 * Skill update.
 */
function drawChemistryReport(
  doc: PDFKit.PDFDocument,
  input: ChemistryReportInput,
): void {
  const { patient, specimen, order, results, verifier } = input;

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Chemistry Result Report', { align: 'center' });
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(11).text('Patient / Specimen');
  doc.font('Helvetica').fontSize(10);
  doc.text(
    `Patient: ${patient.name}    MRN: ${patient.mrn}    DOB: ${patient.dateOfBirth}${patient.sex ? `    Sex: ${patient.sex}` : ''}`,
  );
  doc.text(
    `Specimen Accession #: ${specimen.accessionNumber}    Collected: ${specimen.collectedAt}${
      specimen.receivedAt ? `    Received: ${specimen.receivedAt}` : ''
    }`,
  );
  doc.text(
    `Ordering Provider: ${order.orderingProviderName}${order.orderId ? `    Order: ${order.orderId}` : ''}`,
  );
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(11).text('Results');
  doc.moveDown(0.25);

  const headerRow = ['Analyte', 'Value', 'Unit', 'Flag', 'Reference Range'].map(
    (text) => ({
      text,
      font: { family: 'Helvetica-Bold' },
      backgroundColor: '#eeeeee',
    }),
  );
  const dataRows = results.map((result) => {
    const cellStyle = result.isCritical ? { textColor: 'red' as const } : {};
    return [
      { text: result.analyteName, ...cellStyle },
      { text: result.value, ...cellStyle },
      { text: result.unit, ...cellStyle },
      { text: result.flags.join(',') || '-', ...cellStyle },
      { text: result.referenceRangeText, ...cellStyle },
    ];
  });

  doc.table({
    columnStyles: RESULT_TABLE_COLUMN_WIDTHS,
    defaultStyle: { padding: 4, border: 0.5, borderColor: '#999999' },
    data: [headerRow, ...dataRows],
  });

  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(11).text('Verification');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Status: ${verifier.status}`);
  doc.text(`Verified by: ${verifier.name}`);
  doc.text(`Verified at: ${verifier.verifiedAt}`);
}

export function renderChemistryReportPdf(
  input: ChemistryReportInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Real gotcha, not assumed from docs (see this task's own Skill
    // update): pdfkit's constructor computes its trailer `/ID` fingerprint
    // -- `PDFSecurity.generateFileID(this.info)`, an md5 of every `info`
    // field including `CreationDate.getTime()` -- synchronously inside
    // `new PDFDocument(...)`, *before* any code gets a chance to run.
    // Setting `doc.info.CreationDate = ...` *after* construction (the
    // pattern that looks obvious from the "automatically managed" docs
    // wording) is already too late: the file ID was already derived from
    // the real, wall-clock `new Date()` default at that point, making
    // every render's PDF bytes differ even though `doc.info` itself looks
    // identical afterward. Fix: pass every `info` field, pinned, via the
    // constructor's own `info` option so it's in place before the file ID
    // is generated. Confirmed empirically (not just reasoned): with the
    // fields passed this way, two renders of the same input are
    // byte-for-byte identical, not just hash-identical.
    const doc = new PDFDocument({
      margin: 50,
      bufferPages: true,
      info: {
        CreationDate: new Date(0),
        ModDate: new Date(0),
        Title: `Chemistry Result Report - ${input.specimen.accessionNumber}`,
        Author: 'LIS Platform',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawChemistryReport(doc, input);

    doc.end();
  });
}

export interface RenderedChemistryReport {
  pdf: Buffer;
  contentHash: string;
}

/**
 * The one public entry point (proposal §10 Q3: no persistence in this
 * task -- returns both pieces for TASK-059 to persist later).
 */
export async function renderChemistryReport(
  input: ChemistryReportInput,
): Promise<RenderedChemistryReport> {
  const pdf = await renderChemistryReportPdf(input);
  const contentHash = computeReportContentHash(input);
  return { pdf, contentHash };
}
