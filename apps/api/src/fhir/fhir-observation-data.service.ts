import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { analyte, codeSystemValue, observation } from '@lis/db';
import { eq } from 'drizzle-orm';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import type { FhirObservationInput } from './observation-mapper';

type Tx = RequestWithTx['tx'];

/**
 * FEAT-037: resolves everything `mapObservationToFhir` needs from an
 * internal `Observation`. Mirrors `InteropOruDataService`'s own shape
 * (FEAT-036) -- a read/query operation, not a write.
 *
 * v1 scope (proposal §5): only `dataType: 'quantity'` and only observations
 * already `verified` or later (`verified`/`reported`/`amended`/`corrected`)
 * are eligible -- an unverified result has no stable external-facing FHIR
 * representation yet, and non-quantity value types are real, deliberately
 * deferred follow-up work.
 */
const ELIGIBLE_STATUSES = ['verified', 'reported', 'amended', 'corrected'];

@Injectable()
export class FhirObservationDataService {
  async getObservationData(
    tx: Tx,
    observationId: string,
  ): Promise<FhirObservationInput> {
    const [observationRow] = await tx
      .select()
      .from(observation)
      .where(eq(observation.id, observationId))
      .limit(1);
    if (!observationRow) {
      throw new NotFoundException(`Observation not found: ${observationId}`);
    }
    if (!ELIGIBLE_STATUSES.includes(observationRow.status)) {
      throw new ConflictException(
        `Observation ${observationId} is not eligible for the FHIR facade yet ` +
          `(status: ${observationRow.status}) -- only verified results are exposed.`,
      );
    }
    if (observationRow.dataType !== 'quantity') {
      throw new ConflictException(
        `Observation ${observationId} has dataType '${observationRow.dataType}' -- ` +
          "the FHIR facade currently maps 'quantity' observations only (proposal §5).",
      );
    }
    if (!observationRow.patientId) {
      throw new ConflictException(
        `Observation ${observationId} has no associated patient (QC row?) -- not eligible for the FHIR facade`,
      );
    }

    const [analyteRow] = await tx
      .select({
        code: codeSystemValue.code,
        display: analyte.display,
      })
      .from(analyte)
      .innerJoin(
        codeSystemValue,
        eq(analyte.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(analyte.id, observationRow.analyteId))
      .limit(1);
    if (!analyteRow) {
      throw new ConflictException(
        `Observation ${observationId} references an unknown analyte`,
      );
    }

    const effectiveAt = observationRow.producedAt ?? observationRow.createdAt;

    return {
      id: observationRow.id,
      status: observationRow.status,
      patientId: observationRow.patientId,
      analyteCode: analyteRow.code,
      analyteDisplay: analyteRow.display,
      value: Number(observationRow.valueNum),
      unit: observationRow.unit,
      refLow:
        observationRow.refLow === null ? null : Number(observationRow.refLow),
      refHigh:
        observationRow.refHigh === null ? null : Number(observationRow.refHigh),
      flags: observationRow.flags,
      effectiveAt: effectiveAt.toISOString(),
    };
  }
}
