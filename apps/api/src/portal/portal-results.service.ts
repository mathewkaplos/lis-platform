import { Injectable } from '@nestjs/common';
import { analyte, observation } from '@lis/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import {
  formatDateTime,
  formatObservationValue,
  formatReferenceRangeText,
} from '../report/report-assembly';
import { getReleasePolicy, isReleased } from './release-policy';

type Tx = RequestWithTx['tx'];

export interface PortalResultEntry {
  observationId: string;
  producedAt: string;
  value: string;
  unit: string;
  flags: string[];
  referenceRangeText: string;
  isCritical: boolean;
}

export interface PortalAnalyteResults {
  analyteId: string;
  analyteDisplay: string;
  latest: PortalResultEntry;
  trend: PortalResultEntry[];
}

const PORTAL_RESULT_LIMIT = 500;

/**
 * FEAT-039: reuses `cumulative-report-assembly.ts`'s own "verified-only,
 * snapshot value/range, current-version-only" query discipline
 * (`assembleCumulativeReport`), generalized across every analyte the
 * patient has eligible results for (not one requested analyteId) and
 * additionally gated by the tenant's `result_release_policy`
 * (`isReleased`) -- the one real difference from the existing staff-facing
 * cumulative report, which has no release-policy concept at all (it's
 * already internal-only).
 */
@Injectable()
export class PortalResultsService {
  async getResultsForPatient(
    tx: Tx,
    tenantId: string,
    patientId: string,
  ): Promise<PortalAnalyteResults[]> {
    const policy = await getReleasePolicy(tx, tenantId);
    const now = new Date();

    // Full observation rows, matching `assembleCumulativeReport`'s own
    // shape -- `formatObservationValue` needs the whole row (dataType +
    // every value[X] column), not a narrowed column list.
    const rows = await tx
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.patientId, patientId),
          eq(observation.status, 'verified'),
          isNull(observation.supersededBy),
        ),
      )
      .orderBy(asc(observation.producedAt), asc(observation.createdAt))
      .limit(PORTAL_RESULT_LIMIT);

    const analyteIds = Array.from(new Set(rows.map((row) => row.analyteId)));
    const analyteRows =
      analyteIds.length > 0
        ? await tx
            .select({ id: analyte.id, display: analyte.display })
            .from(analyte)
            .where(inArray(analyte.id, analyteIds))
        : [];
    const analyteDisplayById = new Map(
      analyteRows.map((row) => [row.id, row.display]),
    );

    const byAnalyte = new Map<
      string,
      { display: string; entries: PortalResultEntry[] }
    >();

    for (const row of rows) {
      // A `verified` row always has `verifiedAt` set (the column that
      // transitions it to 'verified' in the first place) -- defensive only.
      if (!row.verifiedAt || !isReleased(policy, row.verifiedAt, now)) {
        continue;
      }

      const entry: PortalResultEntry = {
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
      };

      const existing = byAnalyte.get(row.analyteId);
      if (existing) {
        existing.entries.push(entry);
      } else {
        byAnalyte.set(row.analyteId, {
          display: analyteDisplayById.get(row.analyteId) ?? 'Unknown analyte',
          entries: [entry],
        });
      }
    }

    return Array.from(byAnalyte.entries()).map(([analyteId, group]) => ({
      analyteId,
      analyteDisplay: group.display,
      latest: group.entries[group.entries.length - 1],
      trend: group.entries,
    }));
  }
}
