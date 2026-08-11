import type {
  AmrSurveillanceReport,
  OperationalReportQuery,
} from '@lis/domain';
import type { createDb } from '@lis/db';
import {
  analyte,
  antimicrobial,
  codeSystemValue,
  observation,
  organism,
} from '@lis/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

// FEAT-052/FEAT-053's own "Organism Identified" analyte, LOINC 634-6 --
// same lookup `antibiogram-assembly.ts` already performs at write time,
// duplicated here (not imported) since that module keeps it private,
// matching this codebase's own per-file LOINC-constant convention.
const ORGANISM_IDENTIFIED_LOINC = '634-6';

async function findAnalyteByLoincCode(
  tx: Tx,
  loincCode: string,
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .select({ id: analyte.id })
    .from(analyte)
    .innerJoin(
      codeSystemValue,
      eq(analyte.codeSystemValueId, codeSystemValue.id),
    )
    .where(
      and(
        eq(codeSystemValue.system, 'LOINC'),
        eq(codeSystemValue.code, loincCode),
      ),
    )
    .limit(1);
  return row;
}

/**
 * FEAT-055 (docs/plans/feat-055-amr-surveillance-report.md). The literal
 * KB-44 AMR-surveillance example: organism x antimicrobial x S/I/R rates
 * over a date range, aggregated in application code over real Observation
 * rows (proposal §5, `computeTatReport`'s own precedent) -- no new
 * storage.
 *
 * Only `status = 'verified'` discrete susceptibility Observations count
 * (proposal §5: a preliminary/in-process result is not yet a clinical
 * fact worth surveillance-counting), scoped by `verifiedAt` -- the moment
 * each S/I/R atom actually became a fact, matching `computeWorkloadReport`'s
 * own "verifier count keyed by verifiedAt" precedent.
 *
 * Organism is resolved per `orderedTestId` via that same ordered test's own
 * "Organism Identified" Observation (FEAT-052/FEAT-053's own write-time
 * join, replicated here rather than trusted from the antibiogram `table`
 * Observation's own `valueJson` snapshot -- this report's own atoms are the
 * discrete coded Observations, KB-44's own "queryable dataset", not the
 * grid artifact).
 */
export async function computeAmrSurveillanceReport(
  tx: Tx,
  params: { query: OperationalReportQuery },
): Promise<AmrSurveillanceReport> {
  const from = new Date(params.query.from);
  const to = new Date(params.query.to);

  const antimicrobialRows = await tx
    .select({
      id: antimicrobial.id,
      display: antimicrobial.display,
      analyteId: antimicrobial.analyteId,
    })
    .from(antimicrobial);
  const antimicrobialAnalyteIds = antimicrobialRows
    .map((row) => row.analyteId)
    .filter((id): id is string => id !== null);
  if (antimicrobialAnalyteIds.length === 0) {
    return { entries: [] };
  }
  const antimicrobialByAnalyteId = new Map(
    antimicrobialRows
      .filter((row) => row.analyteId !== null)
      .map((row) => [row.analyteId as string, row]),
  );

  const susceptibilityRows = await tx
    .select({
      orderedTestId: observation.orderedTestId,
      analyteId: observation.analyteId,
      valueCode: observation.valueCode,
    })
    .from(observation)
    .where(
      and(
        inArray(observation.analyteId, antimicrobialAnalyteIds),
        eq(observation.status, 'verified'),
        gte(observation.verifiedAt, from),
        lte(observation.verifiedAt, to),
        isNull(observation.supersededBy),
      ),
    );
  if (susceptibilityRows.length === 0) {
    return { entries: [] };
  }

  const organismIdentifiedAnalyte = await findAnalyteByLoincCode(
    tx,
    ORGANISM_IDENTIFIED_LOINC,
  );
  if (!organismIdentifiedAnalyte) {
    return { entries: [] };
  }

  const orderedTestIds = Array.from(
    new Set(
      susceptibilityRows
        .map((row) => row.orderedTestId)
        .filter((id): id is string => id !== null),
    ),
  );
  const organismIdentifiedRows = await tx
    .select({
      orderedTestId: observation.orderedTestId,
      valueCode: observation.valueCode,
    })
    .from(observation)
    .where(
      and(
        inArray(observation.orderedTestId, orderedTestIds),
        eq(observation.analyteId, organismIdentifiedAnalyte.id),
        isNull(observation.supersededBy),
      ),
    );
  const snomedCodeByOrderedTestId = new Map<string, string>();
  for (const row of organismIdentifiedRows) {
    if (!row.orderedTestId || !row.valueCode) continue;
    snomedCodeByOrderedTestId.set(row.orderedTestId, row.valueCode);
  }

  const snomedCodes = Array.from(new Set(snomedCodeByOrderedTestId.values()));
  const organismRows =
    snomedCodes.length === 0
      ? []
      : await tx
          .select({
            id: organism.id,
            display: organism.display,
            code: codeSystemValue.code,
          })
          .from(organism)
          .innerJoin(
            codeSystemValue,
            eq(organism.codeSystemValueId, codeSystemValue.id),
          )
          .where(inArray(codeSystemValue.code, snomedCodes));
  const organismByCode = new Map(organismRows.map((row) => [row.code, row]));

  const countsByKey = new Map<
    string,
    {
      organismId: string;
      organismDisplay: string;
      antimicrobialId: string;
      antimicrobialDisplay: string;
      susceptibleCount: number;
      intermediateCount: number;
      resistantCount: number;
    }
  >();
  for (const row of susceptibilityRows) {
    if (!row.orderedTestId || !row.analyteId || !row.valueCode) continue;
    if (
      row.valueCode !== 'S' &&
      row.valueCode !== 'I' &&
      row.valueCode !== 'R'
    ) {
      continue; // defensive -- every write path only ever emits S/I/R here
    }
    const snomedCode = snomedCodeByOrderedTestId.get(row.orderedTestId);
    if (!snomedCode) continue;
    const organismRow = organismByCode.get(snomedCode);
    if (!organismRow) continue;
    const antimicrobialRow = antimicrobialByAnalyteId.get(row.analyteId);
    if (!antimicrobialRow) continue;

    const key = `${organismRow.id}:${antimicrobialRow.id}`;
    const entry = countsByKey.get(key) ?? {
      organismId: organismRow.id,
      organismDisplay: organismRow.display,
      antimicrobialId: antimicrobialRow.id,
      antimicrobialDisplay: antimicrobialRow.display,
      susceptibleCount: 0,
      intermediateCount: 0,
      resistantCount: 0,
    };
    if (row.valueCode === 'S') entry.susceptibleCount += 1;
    else if (row.valueCode === 'I') entry.intermediateCount += 1;
    else entry.resistantCount += 1;
    countsByKey.set(key, entry);
  }

  const entries = Array.from(countsByKey.values()).map((entry) => {
    const total =
      entry.susceptibleCount + entry.intermediateCount + entry.resistantCount;
    return {
      ...entry,
      total,
      resistantPct: total === 0 ? 0 : (entry.resistantCount / total) * 100,
    };
  });

  return { entries };
}
