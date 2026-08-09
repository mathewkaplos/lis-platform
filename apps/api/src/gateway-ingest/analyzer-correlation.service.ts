import { Injectable } from '@nestjs/common';
import type { RawResult } from '@lis/domain';
import {
  instrumentAnalyteMapping,
  orderedTest,
  specimen,
  specimenFulfillment,
  testAnalyte,
} from '@lis/db';
import { and, eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

/** KB-29: "unmatched results park in a pending-match queue rather than
 * being dropped" -- every one of these reasons is a caller
 * (gateway-ingest.controller.ts) "unmatched, try again later" case, never a
 * hard failure. Shared with `UnmatchedResultException`/`GatewayIngestService`
 * so all three agree on the exact same set of reasons. */
export type UnmatchedReason =
  | 'unknown_specimen'
  | 'no_published_mapping'
  | 'no_matching_ordered_test'
  | 'ambiguous_match'
  | 'non_numeric_value';

export type CorrelationResult =
  | {
      matched: true;
      orderedTestId: string;
      analyteId: string;
      /** Already multiplied by the mapping's conversionFactor -- the
       * analyte's canonical-unit value, not the instrument's raw one. */
      valueNum: number;
    }
  | {
      matched: false;
      reason: UnmatchedReason;
    };

/**
 * FEAT-027 (KB-29 ingestion pipeline step 3-5): resolves a raw analyzer
 * result's `specimenId` (an accession-number barcode string, KB-29's own
 * "instrument sample ID/barcode -> accession" framing) and `analyte`
 * (instrument channel code) into a real `orderedTest`/`analyte` pair, and
 * converts the reported value into the analyte's canonical unit via the
 * matched mapping's `conversionFactor`.
 */
@Injectable()
export class AnalyzerCorrelationService {
  async correlate(
    tx: Tx,
    tenantId: string,
    rawResult: RawResult,
  ): Promise<CorrelationResult> {
    const [specimenRow] = await tx
      .select({ id: specimen.id })
      .from(specimen)
      .where(eq(specimen.accessionNumber, rawResult.specimenId))
      .limit(1);
    if (!specimenRow) {
      return { matched: false, reason: 'unknown_specimen' };
    }

    const [mappingRow] = await tx
      .select({
        analyteId: instrumentAnalyteMapping.analyteId,
        conversionFactor: instrumentAnalyteMapping.conversionFactor,
      })
      .from(instrumentAnalyteMapping)
      .where(
        and(
          eq(instrumentAnalyteMapping.tenantId, tenantId),
          eq(instrumentAnalyteMapping.instrumentId, rawResult.instrumentId),
          eq(instrumentAnalyteMapping.channelCode, rawResult.analyte),
          eq(instrumentAnalyteMapping.status, 'published'),
        ),
      )
      .limit(1); // ux_instrument_mapping_published guarantees at most one row
    if (!mappingRow) {
      return { matched: false, reason: 'no_published_mapping' };
    }

    const candidateFulfillments = await tx
      .select({ orderedTestId: specimenFulfillment.orderedTestId })
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.specimenId, specimenRow.id));
    if (candidateFulfillments.length === 0) {
      return { matched: false, reason: 'no_matching_ordered_test' };
    }

    const matches: string[] = [];
    for (const { orderedTestId } of candidateFulfillments) {
      const [orderedTestRow] = await tx
        .select({ testDefinitionId: orderedTest.testDefinitionId })
        .from(orderedTest)
        .where(eq(orderedTest.id, orderedTestId))
        .limit(1);
      if (!orderedTestRow) continue;

      const [linkRow] = await tx
        .select({ id: testAnalyte.id })
        .from(testAnalyte)
        .where(
          and(
            eq(testAnalyte.testDefinitionId, orderedTestRow.testDefinitionId),
            eq(testAnalyte.analyteId, mappingRow.analyteId),
          ),
        )
        .limit(1);
      if (linkRow) {
        matches.push(orderedTestId);
      }
    }

    if (matches.length === 0) {
      return { matched: false, reason: 'no_matching_ordered_test' };
    }
    if (matches.length > 1) {
      // A specimen fulfilling more than one ordered test for the same
      // analyte is ambiguous -- treated as unmatched (parked, retried),
      // never guessed (FEAT-027 proposal §5).
      return { matched: false, reason: 'ambiguous_match' };
    }

    if (
      typeof rawResult.value !== 'number' &&
      Number.isNaN(Number(rawResult.value))
    ) {
      return { matched: false, reason: 'non_numeric_value' };
    }
    const rawValue = Number(rawResult.value);
    const valueNum = rawValue * Number(mappingRow.conversionFactor);

    return {
      matched: true,
      orderedTestId: matches[0],
      analyteId: mappingRow.analyteId,
      valueNum,
    };
  }
}
