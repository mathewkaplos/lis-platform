import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import { analyte, observation, patient } from '@lis/db';
import {
  formatDateTime,
  formatObservationValue,
  formatReferenceRangeText,
} from './report-assembly';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

export interface CumulativeReportEntry {
  observationId: string;
  producedAt: string;
  value: string;
  unit: string;
  flags: string[];
  referenceRangeText: string;
  isCritical: boolean;
  verifierUserId: string;
}

export interface CumulativeReportData {
  patient: {
    name: string;
    mrn: string;
    dateOfBirth: string;
  };
  analyte: {
    display: string;
  };
  entries: CumulativeReportEntry[];
}

/**
 * FEAT-033 (docs/plans/feat-033-cumulative-clinical-reports.md finding #1).
 * Generalizes `observation.controller.ts`'s own `prior()` query (TASK-057)
 * past its deliberate 3-row cap and current-ordered-test exclusion -- same
 * `ix_obs_trend` index (`tenant_id, patient_id, analyte_id, produced_at`),
 * same `patientId`/`analyteId` filter, same `supersededBy IS NULL`
 * "current version only" convention.
 *
 * **Verified-only** (`status = 'verified'`): not explicitly named by the
 * issue's own literal AC, but the same rule `report-assembly.ts`'s own
 * `assembleAndPersistReport` already established for the official report --
 * a patient-facing history mixing draft/preliminary values with confirmed
 * ones is a real safety risk, not a formality. `status = 'verified'` covers
 * both human-verified and ADR-0031 auto-verified rows identically (the
 * column doesn't distinguish the two; `verifierUserId` is null for the
 * system-verified case, same as the official report's own convention).
 *
 * No range re-resolution (finding #1's own snapshot discipline, unchanged
 * from TASK-059): every entry's range/flags/value come straight off its own
 * `observation` row, never re-resolved against the live `reference_range`.
 * `observation.unit` is itself already a snapshotted display string (no
 * join needed) -- simpler than the panel report's own analyte-level
 * default-unit lookup, since every observation already carries its own
 * resolved unit text at write time.
 */
const CUMULATIVE_REPORT_RESULT_LIMIT = 500;

export async function assembleCumulativeReport(
  tx: Tx,
  params: { tenantId: string; patientId: string; analyteId: string },
): Promise<CumulativeReportData> {
  const { patientId, analyteId } = params;

  const [patientRow] = await tx
    .select()
    .from(patient)
    .where(eq(patient.id, patientId))
    .limit(1);
  if (!patientRow) {
    throw new NotFoundException('Patient not found');
  }

  const [analyteRow] = await tx
    .select({ id: analyte.id, display: analyte.display })
    .from(analyte)
    .where(eq(analyte.id, analyteId))
    .limit(1);
  if (!analyteRow) {
    throw new NotFoundException('Analyte not found');
  }

  const rows = await tx
    .select()
    .from(observation)
    .where(
      and(
        eq(observation.patientId, patientId),
        eq(observation.analyteId, analyteId),
        eq(observation.status, 'verified'),
        isNull(observation.supersededBy),
      ),
    )
    .orderBy(asc(observation.producedAt), asc(observation.createdAt))
    .limit(CUMULATIVE_REPORT_RESULT_LIMIT);

  const entries: CumulativeReportEntry[] = rows.map((row) => ({
    observationId: row.id,
    producedAt: row.producedAt
      ? formatDateTime(row.producedAt)
      : formatDateTime(row.createdAt),
    value: formatObservationValue(row),
    unit: row.unit ?? '',
    flags: row.flags,
    referenceRangeText: formatReferenceRangeText(
      row.refLow === null ? null : Number(row.refLow),
      row.refHigh === null ? null : Number(row.refHigh),
      row.refCondition,
    ),
    isCritical: row.flags.includes('HH') || row.flags.includes('LL'),
    verifierUserId: row.verifierUserId ?? 'Unknown',
  }));

  return {
    patient: {
      name: `${patientRow.firstName} ${patientRow.lastName}`,
      mrn: patientRow.mrn,
      dateOfBirth: patientRow.birthDate
        ? patientRow.birthDate.toISOString().slice(0, 10)
        : 'Unknown',
    },
    analyte: { display: analyteRow.display },
    entries,
  };
}
