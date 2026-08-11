import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import {
  analyte,
  antimicrobial,
  codeSystemValue,
  observation,
  order,
  orderedTest,
  organism,
  resolveSusceptibility,
  specimenFulfillment,
  writeAuditEvent,
} from '@lis/db';
import type { AntibiogramResult, AntibiogramResultEntry } from '@lis/domain';

type Tx = Parameters<
  Parameters<ReturnType<typeof createDb>['transaction']>[0]
>[0];

export interface RecordAntibiogramEntryInput {
  antimicrobialId: string;
  micValue: number;
}

export interface RecordAntibiogramParams {
  tenantId: string;
  orderedTestId: string;
  entries: RecordAntibiogramEntryInput[];
  actorPrincipalId: string;
  actorRole: string;
}

// FEAT-052's own "Organism Identified" analyte, LOINC 634-6 -- this
// feature's own hard read dependency on that feature's schema, resolved by
// LOINC code rather than a hardcoded id, matching every other cross-feature
// lookup in this codebase (e.g. `report-assembly.ts`'s own template lookup
// by testDefinitionId, never a hardcoded row id).
const ORGANISM_IDENTIFIED_LOINC = '634-6';
// FEAT-053's own "Antibiogram (MIC)" table analyte, per this feature's own
// seed file.
const ANTIBIOGRAM_TABLE_LOINC = '50545-3';

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
 * FEAT-053 (docs/plans/feat-053-susceptibility-interpretation-antibiogram.md).
 * "Recording an antibiogram is one all-at-once human action" (proposal §5/
 * §10 Q3, approved) -- a real, technologist-entered MIC per antimicrobial,
 * resolved against `resolveSusceptibility` (FEAT-051), written as a
 * dual-emission result: one `table` Observation (the readable grid) plus
 * one discrete coded Observation per antimicrobial (the queryable atoms,
 * KB-21/KB-44's own "all carbapenem-resistant E. coli this quarter" AC).
 *
 * All-or-nothing on unmatched breakpoints (proposal's own "never fabricate"
 * discipline extended here): if any requested antimicrobial has no
 * configured breakpoint for the identified organism, the whole request is
 * rejected (409) naming which ones -- a silently partial antibiogram
 * (missing some drugs with no clear signal why) is a worse safety outcome
 * than a clear upfront rejection.
 *
 * Both emissions land as `status: 'preliminary'` -- the same two-person
 * verification control every other discipline's result already has;
 * `POST .../results/:analyteId/verify` (existing, unmodified) verifies
 * each one, confirmed to require only a `'preliminary'` row for that
 * (orderedTestId, analyteId), never `test_analyte` membership (this
 * feature's own seed file deliberately does not link the four
 * antimicrobial-susceptibility analytes to ORGID's test_analyte set --
 * which antimicrobials are actually tested varies by organism, unlike a
 * fixed chemistry panel's own fixed analyte set).
 */
export async function assembleAndPersistAntibiogram(
  tx: Tx,
  params: RecordAntibiogramParams,
): Promise<AntibiogramResult> {
  const { tenantId, orderedTestId, entries, actorPrincipalId, actorRole } =
    params;

  const [orderedTestRow] = await tx
    .select()
    .from(orderedTest)
    .where(eq(orderedTest.id, orderedTestId))
    .limit(1);
  if (!orderedTestRow) {
    throw new NotFoundException('Ordered test not found');
  }

  const organismIdentifiedAnalyte = await findAnalyteByLoincCode(
    tx,
    ORGANISM_IDENTIFIED_LOINC,
  );
  if (!organismIdentifiedAnalyte) {
    throw new ConflictException(
      'Organism Identified analyte (LOINC 634-6) is not seeded -- run `pnpm db:reset`',
    );
  }

  const [organismObs] = await tx
    .select()
    .from(observation)
    .where(
      and(
        eq(observation.orderedTestId, orderedTestId),
        eq(observation.analyteId, organismIdentifiedAnalyte.id),
        isNull(observation.supersededBy),
      ),
    )
    .limit(1);
  if (!organismObs || !organismObs.valueCode) {
    throw new ConflictException(
      `Ordered test ${orderedTestId} has no organism identified yet -- an antibiogram cannot be recorded until one is`,
    );
  }

  const [organismRow] = await tx
    .select({ id: organism.id, display: organism.display })
    .from(organism)
    .innerJoin(
      codeSystemValue,
      eq(organism.codeSystemValueId, codeSystemValue.id),
    )
    .where(eq(codeSystemValue.code, organismObs.valueCode))
    .limit(1);
  if (!organismRow) {
    throw new ConflictException(
      `Identified organism (SNOMED ${organismObs.valueCode}) is not in the organism catalog`,
    );
  }

  const antimicrobialIds = entries.map((e) => e.antimicrobialId);
  const antimicrobialRows = await tx
    .select()
    .from(antimicrobial)
    .where(inArray(antimicrobial.id, antimicrobialIds));
  const antimicrobialById = new Map(antimicrobialRows.map((r) => [r.id, r]));
  for (const id of antimicrobialIds) {
    if (!antimicrobialById.has(id)) {
      throw new BadRequestException(`Unknown antimicrobial id: ${id}`);
    }
  }
  for (const row of antimicrobialRows) {
    if (!row.analyteId) {
      throw new ConflictException(
        `Antimicrobial ${row.display} has no susceptibility-result analyte configured`,
      );
    }
  }

  const resolvedEntries: {
    entry: RecordAntibiogramEntryInput;
    antimicrobial: (typeof antimicrobialRows)[number];
    interpretation: 'S' | 'I' | 'R';
  }[] = [];
  const unmatched: string[] = [];
  for (const entry of entries) {
    const am = antimicrobialById.get(entry.antimicrobialId)!;
    const result = await resolveSusceptibility(tx, {
      organismId: organismRow.id,
      antimicrobialId: entry.antimicrobialId,
      method: 'MIC',
      micValue: entry.micValue,
    });
    if (!result.matched) {
      unmatched.push(am.display);
      continue;
    }
    resolvedEntries.push({
      entry,
      antimicrobial: am,
      interpretation: result.interpretation,
    });
  }
  if (unmatched.length > 0) {
    throw new ConflictException(
      `No breakpoint configured for: ${unmatched.join(', ')} against the identified organism (${organismRow.display})`,
    );
  }

  const [fulfillment] = await tx
    .select({ specimenId: specimenFulfillment.specimenId })
    .from(specimenFulfillment)
    .where(eq(specimenFulfillment.orderedTestId, orderedTestId))
    .limit(1);
  if (!fulfillment) {
    throw new ConflictException(
      'Ordered test has no associated specimen (specimen_fulfillment)',
    );
  }
  const [orderRow] = await tx
    .select()
    .from(order)
    .where(eq(order.id, orderedTestRow.orderId))
    .limit(1);
  if (!orderRow) {
    throw new ConflictException('Ordered test has no associated order');
  }

  const now = new Date();
  const discreteResults: AntibiogramResultEntry[] = [];
  for (const r of resolvedEntries) {
    const [inserted] = await tx
      .insert(observation)
      .values({
        tenantId,
        orderedTestId,
        analyteId: r.antimicrobial.analyteId!,
        specimenId: fulfillment.specimenId,
        patientId: orderRow.patientId,
        isControl: false,
        dataType: 'coded',
        valueCode: r.interpretation,
        status: 'preliminary',
        source: 'manual',
        operatorUserId: actorPrincipalId,
        producedAt: now,
      })
      .returning();
    discreteResults.push({
      antimicrobialId: r.entry.antimicrobialId,
      antimicrobialDisplay: r.antimicrobial.display,
      micValue: r.entry.micValue,
      interpretation: r.interpretation,
      observationId: inserted.id,
    });
  }

  const antibiogramTableAnalyte = await findAnalyteByLoincCode(
    tx,
    ANTIBIOGRAM_TABLE_LOINC,
  );
  if (!antibiogramTableAnalyte) {
    throw new ConflictException(
      'Antibiogram (MIC) analyte (LOINC 50545-3) is not seeded -- run `pnpm db:reset`',
    );
  }

  const [tableObs] = await tx
    .insert(observation)
    .values({
      tenantId,
      orderedTestId,
      analyteId: antibiogramTableAnalyte.id,
      specimenId: fulfillment.specimenId,
      patientId: orderRow.patientId,
      isControl: false,
      dataType: 'table',
      valueJson: {
        organismId: organismRow.id,
        organismDisplay: organismRow.display,
        results: discreteResults,
      },
      status: 'preliminary',
      source: 'manual',
      operatorUserId: actorPrincipalId,
      producedAt: now,
    })
    .returning();

  // One action, one audit entry -- the discrete Observations are folded
  // into `after`, not each independently audited, matching
  // `control-lot.controller.ts`'s own `recordResult` precedent for a
  // single human action producing multiple related rows.
  await writeAuditEvent(tx, {
    tenantId,
    actorPrincipalId,
    actorRole,
    actorType: 'human',
    action: 'antibiogram.record',
    resourceType: 'observation',
    resourceId: tableObs.id,
    after: {
      organismId: organismRow.id,
      tableObservationId: tableObs.id,
      results: discreteResults,
    },
  });

  return {
    organismId: organismRow.id,
    organismDisplay: organismRow.display,
    tableObservationId: tableObs.id,
    results: discreteResults,
  };
}
