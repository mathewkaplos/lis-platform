import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  analyte,
  codeSystemValue,
  observation,
  order,
  orderedTest,
  patient,
} from '@lis/db';
import { eq } from 'drizzle-orm';
import type { InteropOruData } from '@lis/domain';
import { formatObservationValue } from '../report/report-assembly';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';

type Tx = RequestWithTx['tx'];

/**
 * FEAT-036 AC #2: resolves everything `apps/interop`'s `OruBuilderService`
 * needs from an already-verified `Observation` (KB-30's OBX-3/5/6/7/8
 * mapping). Closest existing analog is report-data assembly
 * (`report-assembly.ts`'s own `AssembleReportParams`/`ChemistryReportInput`
 * shape, proposal §5 assumption (b)) -- a read/query operation, not a write,
 * reusing `formatObservationValue` rather than a second copy of the same
 * per-dataType formatting logic.
 */
@Injectable()
export class InteropOruDataService {
  async getOruData(tx: Tx, observationId: string): Promise<InteropOruData> {
    const [observationRow] = await tx
      .select()
      .from(observation)
      .where(eq(observation.id, observationId))
      .limit(1);
    if (!observationRow) {
      throw new NotFoundException(`Observation not found: ${observationId}`);
    }
    if (observationRow.status !== 'verified' || !observationRow.verifiedAt) {
      throw new ConflictException(
        `Observation ${observationId} is not verified yet (status: ${observationRow.status}) -- ` +
          'an ORU can only be generated from a verified result (KB-30/Constitution Law #3).',
      );
    }

    // OBX-3 needs the analyte's real coded identity (KB-30: "preserving
    // codes and units"), not test_definition.code (a plain, tenant-
    // customizable string used elsewhere for "which test was ordered",
    // e.g. the inbound ORM's own OBR.4 correlation) -- codeSystemValue is
    // this schema's actual LOINC-grade catalog (ADR-0004).
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

    if (!observationRow.orderedTestId) {
      throw new ConflictException(
        `Observation ${observationId} has no associated ordered test (QC row?) -- not eligible for ORU generation`,
      );
    }
    const [orderedTestRow] = await tx
      .select({ orderId: orderedTest.orderId })
      .from(orderedTest)
      .where(eq(orderedTest.id, observationRow.orderedTestId))
      .limit(1);
    if (!orderedTestRow) {
      throw new ConflictException(
        `Observation ${observationId}'s ordered test no longer exists`,
      );
    }
    const [orderRow] = await tx
      .select({ patientId: order.patientId })
      .from(order)
      .where(eq(order.id, orderedTestRow.orderId))
      .limit(1);
    if (!orderRow) {
      throw new ConflictException(
        `Observation ${observationId}'s order no longer exists`,
      );
    }
    const [patientRow] = await tx
      .select({
        mrn: patient.mrn,
        firstName: patient.firstName,
        lastName: patient.lastName,
      })
      .from(patient)
      .where(eq(patient.id, orderRow.patientId))
      .limit(1);
    if (!patientRow) {
      throw new ConflictException(
        `Observation ${observationId}'s patient no longer exists`,
      );
    }

    return {
      patientMrn: patientRow.mrn,
      patientFirstName: patientRow.firstName,
      patientLastName: patientRow.lastName,
      analyteCode: analyteRow.code,
      analyteDisplay: analyteRow.display,
      value: formatObservationValue(observationRow),
      unit: observationRow.unit,
      refLow:
        observationRow.refLow === null ? null : Number(observationRow.refLow),
      refHigh:
        observationRow.refHigh === null ? null : Number(observationRow.refHigh),
      flags: observationRow.flags,
      verifiedAt: observationRow.verifiedAt.toISOString(),
    };
  }
}
