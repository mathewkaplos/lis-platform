import { Injectable } from '@nestjs/common';
import { patient, testDefinition } from '@lis/db';
import { and, eq } from 'drizzle-orm';
import type { InteropOrderIngestInput } from '@lis/domain';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

export type InteropUnmatchedReason = 'unknown_mrn' | 'unknown_test_code';

export type InteropCorrelationResult =
  | { matched: true; patientId: string; testDefinitionId: string }
  | { matched: false; reason: InteropUnmatchedReason };

/**
 * Resolves an inbound ORM's already-parsed MRN/test-code strings to real
 * UUIDs (FEAT-036, §10 Q5: MRN-only exact match -- reject/queue for manual
 * review on no-match, never fuzzy-match or auto-create a patient). Mirrors
 * `AnalyzerCorrelationService`'s own shape: direct table queries inside the
 * caller's own RLS-scoped transaction, no cross-module service dependency,
 * "park, never drop" on a miss (KB-29's own phrase, reused here for the
 * same reason -- an inbound order with no correlatable patient/test still
 * needs a human to notice it, not a silent 500 or a wrong write).
 */
@Injectable()
export class InteropOrderCorrelationService {
  async correlate(
    tx: Tx,
    tenantId: string,
    input: Pick<InteropOrderIngestInput, 'mrn' | 'testCode'>,
  ): Promise<InteropCorrelationResult> {
    const [patientRow] = await tx
      .select({ id: patient.id })
      .from(patient)
      .where(and(eq(patient.tenantId, tenantId), eq(patient.mrn, input.mrn)))
      .limit(1);
    if (!patientRow) {
      return { matched: false, reason: 'unknown_mrn' };
    }

    const [testDefRow] = await tx
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, tenantId),
          eq(testDefinition.code, input.testCode),
        ),
      )
      .limit(1);
    if (!testDefRow) {
      return { matched: false, reason: 'unknown_test_code' };
    }

    return {
      matched: true,
      patientId: patientRow.id,
      testDefinitionId: testDefRow.id,
    };
  }
}
