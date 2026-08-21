import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { stableStringify } from '@lis/db';
import type { AssembledCaseReportContent } from './case-report-content-assembler';

/**
 * Issue #648. A case-level signed report has no per-test-definition
 * template to walk (proposal §5.5 -- `report_template` is keyed strictly to
 * `testDefinitionId`, a real structural mismatch for case-level content), so
 * this renderer draws a fixed, non-configurable layout -- own input shape,
 * not a reuse of `report-render.ts`'s `ChemistryReportInput`-shaped
 * `drawTemplateReport`/`renderTemplateReportPdf`, which is structurally
 * specific to one ordered test's own analyte results.
 */
export interface CaseReportRenderInput {
  caseAccessionNumber: string;
  caseStatus: string;
  content: AssembledCaseReportContent;
  version: {
    versionNumber: number;
    status: string;
    signedByRole: string;
    signedAt: string;
    reason: string | null;
  };
}

export function computeCaseReportPdfContentHash(
  input: CaseReportRenderInput,
): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function drawCaseReport(
  doc: PDFKit.PDFDocument,
  input: CaseReportRenderInput,
): void {
  const { content, version } = input;

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Anatomic Pathology Report', { align: 'center' });
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(11).text('Case');
  doc.font('Helvetica').fontSize(10);
  doc.text(
    `Accession #: ${input.caseAccessionNumber}    Status: ${input.caseStatus}`,
  );
  doc.moveDown(1);

  if (content.parts.length > 0) {
    doc.font('Helvetica-Bold').fontSize(11).text('Specimen Parts');
    doc.font('Helvetica').fontSize(10);
    for (const part of content.parts) {
      doc.text(
        `Part ${part.accessionNumber} — Block(s): ${
          part.blockCodes.length > 0 ? part.blockCodes.join(', ') : 'none'
        }`,
      );
    }
    doc.moveDown(1);
  }

  if (content.narrative.length > 0) {
    doc.font('Helvetica-Bold').fontSize(11).text('Narrative');
    doc.font('Helvetica').fontSize(10);
    for (const entry of content.narrative) {
      doc.text(`${entry.label}: ${entry.value}`);
    }
    doc.moveDown(1);
  }

  if (content.synopticGroups.length > 0) {
    doc.font('Helvetica-Bold').fontSize(11).text('Synoptic Findings');
    for (const group of content.synopticGroups) {
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(10).text(group.protocolName);
      doc.font('Helvetica').fontSize(10);
      for (const response of group.responses) {
        doc.text(`${response.elementLabel}: ${response.value}`);
      }
      // Issue #669: each repeating-group instance (multifocal tumors,
      // repeated nodal basins) under its own distinguishing sub-heading --
      // otherwise two instances of the same element (e.g. two "Tumor
      // Size" answers) would render as indistinguishable duplicate lines.
      for (const repeatingGroup of group.repeatingGroups) {
        for (const instance of repeatingGroup.instances) {
          doc.moveDown(0.15);
          doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .text(`${repeatingGroup.rootLabel} — ${instance.instanceLabel}`);
          doc.font('Helvetica').fontSize(10);
          for (const response of instance.responses) {
            doc.text(`${response.elementLabel}: ${response.value}`);
          }
        }
      }
    }
    doc.moveDown(1);
  }

  doc.font('Helvetica-Bold').fontSize(11).text('Signature');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Version ${version.versionNumber} — ${version.status}`);
  doc.text(
    `Signed by: ${version.signedByRole}    Signed at: ${version.signedAt}`,
  );
  if (version.reason) {
    doc.text(`Reason: ${version.reason}`);
  }
}

export function renderCaseReportPdf(
  input: CaseReportRenderInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Real gotcha (`engineering/pdf-generation` Skill entry #6, unchanged
    // from report-render.ts's own precedent): pdfkit's trailer `/ID`
    // fingerprint is computed synchronously inside `new PDFDocument(...)`,
    // from `info` -- every `info` field is pinned via the constructor's own
    // `info` option, never set afterward via `doc.info.X`.
    const doc = new PDFDocument({
      margin: 50,
      bufferPages: true,
      compress: false,
      info: {
        CreationDate: new Date(0),
        ModDate: new Date(0),
        Title: `Case Report - ${input.caseAccessionNumber} v${input.version.versionNumber}`,
        Author: 'LIS Platform',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCaseReport(doc, input);

    doc.end();
  });
}
