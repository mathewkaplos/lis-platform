import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { stableStringify } from '@lis/db';
import { evaluateCondition } from '../workflow/workflow-condition-evaluator';
import type {
  ReportTemplateDefinition,
  TemplateFieldDefinition,
} from '@lis/domain';
import type {
  ChemistryReportAnalyteResult,
  ChemistryReportInput,
} from './report.types';

/**
 * TASK-058 (FEAT-016) originally drew one fixed, hard-coded pdfkit layout
 * (`drawChemistryReport`). FEAT-032 (docs/plans/feat-032-template-engine-
 * config-driven-versioned.md finding #3) generalizes the results-body
 * portion into this interpreter, walking a `report_template_version`'s own
 * `definition.sections`/`fields` tree instead. The patient/specimen/order
 * header and verification footer stay fixed structural chrome, rendered
 * identically regardless of template (proposal's own field-type scoping,
 * `packages/domain/src/report-template.ts`'s header comment) -- no field type in this
 * proposal's 5-type scope models "patient info," so templating only the
 * results body (not the whole document) is the honest boundary of what's
 * actually configurable here.
 *
 * Determinism strategy unchanged from TASK-058: hash the canonical *input*
 * (now `{ templateVersionId, input }`, so a different published template
 * rendering the exact same data produces a different hash -- the template
 * is real content, not incidental metadata), not the rendered PDF bytes.
 * `PDFDocument`'s `info` is still pinned entirely via the constructor's own
 * `info` option (`engineering/pdf-generation` Skill entry #6) -- unchanged
 * by this generalization, since that finding is about pdfkit's own trailer
 * `/ID` computation, orthogonal to what gets drawn.
 */
export interface RenderReportInput {
  templateVersionId: string;
  definition: ReportTemplateDefinition;
  input: ChemistryReportInput;
}

export function computeReportContentHash(params: RenderReportInput): string {
  return createHash('sha256')
    .update(
      stableStringify({
        templateVersionId: params.templateVersionId,
        definition: params.definition,
        input: params.input,
      }),
    )
    .digest('hex');
}

const RESULT_TABLE_COLUMN_WIDTHS = [130, 70, 55, 45, 175];

function conditionContextFor(
  result: ChemistryReportAnalyteResult,
): Record<string, unknown> {
  return {
    analyteName: result.analyteName,
    unit: result.unit,
    flags: result.flags,
    isCritical: result.isCritical,
  };
}

/**
 * Exported for direct unit testing (`report-render.spec.ts`) -- pdfkit's
 * own content-stream text encoding (hex-bracketed `TJ` glyph runs, not
 * plain parenthesized ASCII strings) makes asserting "field X's text
 * appears/doesn't appear" against raw rendered bytes unreliable; testing
 * this pure decision function directly is the honest way to prove
 * conditional visibility actually gates rendering.
 *
 * The single source of truth for "should this field draw at all": false
 * with no resolved data (nothing to draw -- this is a real, expected case:
 * a field bound to an analyte the guardrail proved is on the test's own
 * `test_analyte` set at publish time, but this particular ordered test's
 * assembled results don't happen to include, matching entry #4's own
 * "logged no-op over crash for an expected-shaped gap" discipline), true
 * with resolved data and no `visibilityCondition`, otherwise the evaluated
 * condition.
 */
export function isFieldVisible(
  field: TemplateFieldDefinition,
  resolved: ChemistryReportAnalyteResult | undefined,
): boolean {
  if (!resolved) return false;
  if (!field.visibilityCondition) return true;
  return evaluateCondition(
    field.visibilityCondition,
    conditionContextFor(resolved),
  );
}

function drawResultsTable(
  doc: PDFKit.PDFDocument,
  rows: ChemistryReportAnalyteResult[],
): void {
  const headerRow = ['Analyte', 'Value', 'Unit', 'Flag', 'Reference Range'].map(
    (text) => ({
      text,
      font: { family: 'Helvetica-Bold' },
      backgroundColor: '#eeeeee',
    }),
  );
  const dataRows = rows.map((result) => {
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
}

/**
 * Walks one template field. `resolvedByAnalyteId` is built once per render
 * from `input.results` (keyed by each result's own `analyteId`, FEAT-032's
 * addition to `ChemistryReportAnalyteResult`) -- every binding this
 * function looks up was already proven to exist in the target test's own
 * `test_analyte` set at publish time (`report-template-guardrails.ts`); a
 * missing lookup here means the ordered test's own assembled results don't
 * cover that analyte and the field is silently skipped rather than
 * crashing the render, the same "logged no-op over throw for an
 * expected-shaped gap" discipline `engineering/workflow-engine` Skill entry
 * #4 already established for command handlers.
 */
function drawField(
  doc: PDFKit.PDFDocument,
  field: TemplateFieldDefinition,
  resolvedByAnalyteId: Map<string, ChemistryReportAnalyteResult>,
): void {
  doc.font('Helvetica').fontSize(10);

  switch (field.type) {
    case 'richText': {
      if (field.content) doc.text(field.content);
      return;
    }
    case 'numeric':
    case 'coded': {
      const resolved = field.analyteBinding
        ? resolvedByAnalyteId.get(field.analyteBinding)
        : undefined;
      if (!resolved || !isFieldVisible(field, resolved)) return;
      doc.text(`${field.label}: ${resolved.value} ${resolved.unit}`.trim());
      return;
    }
    case 'referenceRangeDisplay': {
      const resolved = field.analyteBinding
        ? resolvedByAnalyteId.get(field.analyteBinding)
        : undefined;
      if (!resolved || !isFieldVisible(field, resolved)) return;
      doc.text(`${field.label}: ${resolved.referenceRangeText}`);
      return;
    }
    case 'table': {
      const rows = (field.analyteBindings ?? [])
        .map((analyteId) => resolvedByAnalyteId.get(analyteId))
        .filter(
          (row): row is ChemistryReportAnalyteResult => row !== undefined,
        );
      if (rows.length === 0) return;
      doc.moveDown(0.25);
      drawResultsTable(doc, rows);
      return;
    }
  }
}

function drawTemplateReport(
  doc: PDFKit.PDFDocument,
  definition: ReportTemplateDefinition,
  input: ChemistryReportInput,
): void {
  const { patient, specimen, order, results, verifier } = input;
  const resolvedByAnalyteId = new Map(results.map((r) => [r.analyteId, r]));

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Chemistry Result Report', { align: 'center' });
  // FEAT-054 (ADR-0047): fixed chrome, not template-configurable -- same
  // boundary the patient/specimen/order header already follows. Absent
  // `reportType` (pre-FEAT-054 callers) renders no banner, same as 'final'.
  if (input.reportType === 'preliminary') {
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('red')
      .text('PRELIMINARY REPORT — subject to change', { align: 'center' })
      .fillColor('black');
  }
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

  for (const section of definition.sections) {
    doc.font('Helvetica-Bold').fontSize(11).text(section.title);
    doc.moveDown(0.25);
    for (const field of section.fields) {
      drawField(doc, field, resolvedByAnalyteId);
    }
    doc.moveDown(0.75);
  }

  doc.font('Helvetica-Bold').fontSize(11).text('Verification');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Status: ${verifier.status}`);
  // FEAT-054: a preliminary report generated before anything is verified
  // has no real verifier to show -- an honest "Pending verification"
  // state (§10 Q3), never a fabricated name/timestamp.
  if ('name' in verifier) {
    doc.text(`Verified by: ${verifier.name}`);
    doc.text(`Verified at: ${verifier.verifiedAt}`);
  }
}

export function renderTemplateReportPdf(
  templateVersionId: string,
  definition: ReportTemplateDefinition,
  input: ChemistryReportInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Real gotcha (unchanged from TASK-058, `engineering/pdf-generation`
    // Skill entry #6): pdfkit's trailer `/ID` fingerprint is computed
    // synchronously inside `new PDFDocument(...)`, from `info` --
    // `doc.info.X = ...` set after construction is already too late. Every
    // `info` field is pinned via the constructor's own `info` option.
    const doc = new PDFDocument({
      margin: 50,
      bufferPages: true,
      // Explicit, not pdfkit's own `compress: true` default -- keeps content
      // streams plain-text-inspectable (e.g. in e2e/manual verification and
      // this module's own visibility-condition unit tests), and has no
      // bearing on the determinism guarantees above (byte-identity holds
      // either way; only file size differs).
      compress: false,
      info: {
        CreationDate: new Date(0),
        ModDate: new Date(0),
        Title: `Result Report - ${input.specimen.accessionNumber}`,
        Author: 'LIS Platform',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawTemplateReport(doc, definition, input);

    doc.end();
  });
}

export interface RenderedChemistryReport {
  pdf: Buffer;
  contentHash: string;
}

/** The one public entry point -- returns both pieces for the caller
 * (`report-assembly.ts`) to persist. */
export async function renderTemplateReport(
  params: RenderReportInput,
): Promise<RenderedChemistryReport> {
  const pdf = await renderTemplateReportPdf(
    params.templateVersionId,
    params.definition,
    params.input,
  );
  const contentHash = computeReportContentHash(params);
  return { pdf, contentHash };
}
