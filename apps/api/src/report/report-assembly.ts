import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import {
  analyte,
  observation,
  order,
  orderedTest,
  patient,
  report,
  reportTemplate,
  reportTemplateVersion,
  specimen,
  specimenFulfillment,
  testAnalyte,
  writeAuditEvent,
} from '@lis/db';
import { renderTemplateReport } from './report-render';
import type { ReportTemplateDefinition } from '@lis/domain';
import type {
  ChemistryReportAnalyteResult,
  ChemistryReportInput,
} from './report.types';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

export interface AssembleReportParams {
  tenantId: string;
  orderedTestId: string;
  /** Audited as the actor -- no route/session exists yet in this task
   * (proposal §10 Q2), so the caller supplies these directly. TASK-060's
   * real route will pass its own `CurrentUser`/granting-role values here. */
  actorPrincipalId: string;
  actorRole: string;
}

export interface AssembledReport {
  reportId: string;
  contentHash: string;
  pdf: Buffer;
}

/**
 * TASK-059 (FEAT-016 revision, docs/plans/feat-016-minimal-report.md §1
 * findings #1-#5). No range re-resolution happens anywhere in this
 * function -- every analyte's range/flags come straight off its own
 * `observation` row (`refLow`/`refHigh`/`refCondition`/`refSource`,
 * snapshotted once at write time by TASK-049/050/051), which is the
 * entire proof of this task's literal AC: a `reference_range` row edited
 * or superseded years later cannot change what an already-written
 * observation reports.
 *
 * Exported (FEAT-033): `cumulative-report-assembly.ts` reuses this verbatim
 * rather than writing a third copy of the same formatting logic -- pure
 * visibility change, no behavior change.
 */
export function formatReferenceRangeText(
  refLow: number | null,
  refHigh: number | null,
  refCondition: string | null,
): string {
  const condition = refCondition ? ` (${refCondition})` : '';
  if (refLow === null && refHigh === null) return 'No range established';
  if (refLow !== null && refHigh !== null)
    return `${refLow} - ${refHigh}${condition}`;
  if (refHigh !== null) return `< ${refHigh}${condition}`;
  return `> ${refLow}${condition}`;
}

/**
 * Real finding, caught only by actually opening a real rendered PDF during
 * this task's own local `web-verify` pass (2026-08-07), not by any
 * automated test: `specimen.collectedAt`/`receivedAt` and
 * `observation.verifiedAt` were passed into `ChemistryReportInput` via a
 * bare `.toISOString()`, rendering a raw machine timestamp
 * ("2026-08-07T09:20:56.870Z") on an otherwise human-readable report.
 * `dateOfBirth` (a date-only field, `.slice(0, 10)`) is unaffected -- this
 * only formats real datetimes. `timeZone: 'UTC'`/`locale: 'en-US'` are both
 * explicit, not server-default -- the same determinism discipline
 * `formatReferenceRangeText` above already applies to numbers, extended to
 * dates: a locale/timezone-dependent format would make this repo's own
 * "same input, byte-identical PDF" AC (TASK-058) depend on which
 * environment rendered it.
 */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

export function formatObservationValue(
  row: typeof observation.$inferSelect,
): string {
  if (row.dataType === 'quantity') {
    return row.valueNum === null ? '' : String(Number(row.valueNum));
  }
  if (row.dataType === 'coded') {
    return row.valueCode ?? '';
  }
  return row.valueText ?? '';
}

/**
 * One report per `ordered_test` (a chemistry panel) -- finding #2: KB-02's
 * own "Open questions" section names chemistry = per panel directly, and
 * every existing precedent in this schema (draft/finalize/verify/results
 * grid) is already scoped this way.
 *
 * Requires every analyte named by the ordered test's own `test_analyte`
 * rows to have a current (`superseded_by IS NULL`), `'verified'`
 * observation -- assembling from a partially-verified panel is rejected
 * (409), not silently produced with gaps (proposal §5/§10 Q3). This is
 * the deliberate reading of KB line 111 ("A Report cannot be final unless
 * all required Observations are present and validated") without building
 * KB-02's own full `Report` state machine (finding #3) -- this function
 * has no `report.status`, no draft/preliminary concept of its own.
 *
 * Persists a provenance record (hash + the exact observation versions
 * included) and writes a `report.generate` audit event in the SAME
 * transaction as the insert (Constitution Law #5) -- no PDF bytes stored
 * (§10 Q1: Option A), matching TASK-046's own "every print, first or
 * repeat, audited identically" precedent rather than a once-only /
 * cached-artifact model this task's own scope doesn't ask for.
 */
export async function assembleAndPersistReport(
  tx: Tx,
  params: AssembleReportParams,
): Promise<AssembledReport> {
  const { tenantId, orderedTestId, actorPrincipalId, actorRole } = params;

  const [orderedTestRow] = await tx
    .select()
    .from(orderedTest)
    .where(eq(orderedTest.id, orderedTestId))
    .limit(1);
  if (!orderedTestRow) {
    throw new NotFoundException('Ordered test not found');
  }

  const requiredAnalytes = await tx
    .select({ analyteId: testAnalyte.analyteId })
    .from(testAnalyte)
    .where(eq(testAnalyte.testDefinitionId, orderedTestRow.testDefinitionId));
  if (requiredAnalytes.length === 0) {
    throw new ConflictException(
      `Test definition ${orderedTestRow.testDefinitionId} has no analytes defined`,
    );
  }
  const requiredAnalyteIds = requiredAnalytes.map((row) => row.analyteId);

  // Current (non-superseded) observation per analyte on this ordered test —
  // `superseded_by IS NULL` is this schema's own "current observations
  // only" filter (observation.ts's header comment).
  const observationRows = await tx
    .select()
    .from(observation)
    .where(
      and(
        eq(observation.orderedTestId, orderedTestId),
        isNull(observation.supersededBy),
      ),
    );
  const observationByAnalyteId = new Map(
    observationRows.map((row) => [row.analyteId, row]),
  );

  const unresolvedAnalyteIds = requiredAnalyteIds.filter((analyteId) => {
    const row = observationByAnalyteId.get(analyteId);
    return !row || row.status !== 'verified';
  });
  if (unresolvedAnalyteIds.length > 0) {
    throw new ConflictException(
      `Ordered test ${orderedTestId} has ${unresolvedAnalyteIds.length} of ${requiredAnalyteIds.length} analyte(s) not yet verified; ` +
        'a report cannot be assembled until every result on this panel is verified',
    );
  }

  const analyteRows = await tx
    .select({ id: analyte.id, display: analyte.display })
    .from(analyte)
    .where(inArray(analyte.id, requiredAnalyteIds));
  const analyteDisplayById = new Map(
    analyteRows.map((row) => [row.id, row.display]),
  );

  const includedObservations = requiredAnalyteIds.map((analyteId) => {
    const row = observationByAnalyteId.get(analyteId)!;
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  });

  const results: ChemistryReportAnalyteResult[] = requiredAnalyteIds.map(
    (analyteId) => {
      const row = observationByAnalyteId.get(analyteId)!;
      return {
        analyteId,
        analyteName: analyteDisplayById.get(analyteId) ?? 'Unknown analyte',
        value: formatObservationValue(row),
        unit: row.unit ?? '',
        flags: row.flags,
        referenceRangeText: formatReferenceRangeText(
          row.refLow === null ? null : Number(row.refLow),
          row.refHigh === null ? null : Number(row.refHigh),
          row.refCondition,
        ),
        isCritical: row.flags.includes('HH') || row.flags.includes('LL'),
      };
    },
  );

  const [orderRow] = await tx
    .select()
    .from(order)
    .where(eq(order.id, orderedTestRow.orderId))
    .limit(1);
  if (!orderRow) {
    throw new ConflictException('Ordered test has no associated order');
  }

  const [patientRow] = await tx
    .select()
    .from(patient)
    .where(eq(patient.id, orderRow.patientId))
    .limit(1);
  if (!patientRow) {
    throw new ConflictException('Order has no associated patient');
  }

  const [fulfillmentRow] = await tx
    .select({ specimenId: specimenFulfillment.specimenId })
    .from(specimenFulfillment)
    .where(eq(specimenFulfillment.orderedTestId, orderedTestId))
    .limit(1);
  if (!fulfillmentRow) {
    throw new ConflictException(
      'Ordered test has no associated specimen (specimen_fulfillment)',
    );
  }
  const [specimenRow] = await tx
    .select()
    .from(specimen)
    .where(eq(specimen.id, fulfillmentRow.specimenId))
    .limit(1);
  if (!specimenRow) {
    throw new ConflictException(
      'Specimen fulfillment references a missing specimen',
    );
  }

  // Verifier block: the most-recently-verified analyte on this panel
  // (proposal §5 assumption) -- a single-line proxy for "who signed this
  // off," not a per-analyte verifier list. Unreachable-if-undefined given
  // the all-verified precondition above; typed defensively regardless.
  const [mostRecentlyVerified] = observationRows
    .filter((row) => row.status === 'verified' && row.verifiedAt)
    .sort((a, b) => b.verifiedAt!.getTime() - a.verifiedAt!.getTime());
  if (!mostRecentlyVerified) {
    throw new ConflictException(
      'No verified observation found on this ordered test',
    );
  }

  const input: ChemistryReportInput = {
    patient: {
      name: `${patientRow.firstName} ${patientRow.lastName}`,
      mrn: patientRow.mrn,
      dateOfBirth: patientRow.birthDate
        ? patientRow.birthDate.toISOString().slice(0, 10)
        : 'Unknown',
      sex: patientRow.sex,
    },
    specimen: {
      accessionNumber: specimenRow.accessionNumber,
      collectedAt: specimenRow.collectedAt
        ? formatDateTime(specimenRow.collectedAt)
        : 'Unknown',
      receivedAt: specimenRow.receivedAt
        ? formatDateTime(specimenRow.receivedAt)
        : undefined,
    },
    order: {
      // No ordering-provider column exists anywhere in this schema yet —
      // order.ts's own header comment names this as deliberately out of
      // scope ("no consuming code or a catalog table yet"). States the
      // real gap plainly rather than fabricating a name, matching this
      // schema's own explicit-unknown convention (patient.sex = 'U').
      orderingProviderName: 'Not recorded',
      orderId: orderRow.id,
    },
    results,
    verifier: {
      // No user table exists yet (M2) — the raw id is shown, matching
      // TASK-057's own identical convention in the results-grid UI.
      name: mostRecentlyVerified.verifierUserId ?? 'Unknown',
      status: 'verified',
      verifiedAt: formatDateTime(mostRecentlyVerified.verifiedAt!),
    },
  };

  // FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md
  // finding #3): a report can only be assembled once its test_definition
  // has a published report_template_version -- there is no fixed fallback
  // layout anymore. `report_template` is unique on (tenant, test_definition)
  // and `report_template_version` allows at most one `published` row per
  // template (both DB-enforced), so this lookup can return at most one row
  // either way; it's still two real states worth distinguishing for the
  // caller: no template configured at all (404, a real gap to fix) vs. a
  // template exists but nothing has been published yet (409, a real but
  // different gap -- someone left every version in draft).
  const [templateRow] = await tx
    .select()
    .from(reportTemplate)
    .where(eq(reportTemplate.testDefinitionId, orderedTestRow.testDefinitionId))
    .limit(1);
  if (!templateRow) {
    throw new NotFoundException(
      `No report template configured for test definition ${orderedTestRow.testDefinitionId}`,
    );
  }
  const [publishedVersion] = await tx
    .select()
    .from(reportTemplateVersion)
    .where(
      and(
        eq(reportTemplateVersion.reportTemplateId, templateRow.id),
        eq(reportTemplateVersion.status, 'published'),
      ),
    )
    .limit(1);
  if (!publishedVersion) {
    throw new ConflictException(
      `Report template for test definition ${orderedTestRow.testDefinitionId} has no published version`,
    );
  }

  const { pdf, contentHash } = await renderTemplateReport({
    templateVersionId: publishedVersion.id,
    definition: publishedVersion.definition as ReportTemplateDefinition,
    input,
  });

  const [reportRow] = await tx
    .insert(report)
    .values({
      tenantId,
      orderedTestId,
      contentHash,
      includedObservations,
      generatedByUserId: actorPrincipalId,
      templateVersionId: publishedVersion.id,
    })
    .returning();

  await writeAuditEvent(tx, {
    tenantId,
    actorPrincipalId,
    actorRole,
    actorType: 'human',
    action: 'report.generate',
    resourceType: 'report',
    resourceId: reportRow.id,
    after: { contentHash, orderedTestId, includedObservations },
  });

  return { reportId: reportRow.id, contentHash, pdf };
}
