import { z } from "zod";
import { resultEntryDataTypeSchema, resultEntrySchema } from "./observation";

/**
 * TASK-064 (FEAT-018 revision, docs/plans/feat-018-qc-materials-results-as-observations.md):
 * QC result entry reuses the exact same request shape TASK-051 already
 * built for patient results (`resultEntrySchema` -- quantity/coded/text,
 * discriminated on `dataType`) rather than defining a parallel one. Control
 * lots carry no reference-range/flagging concept (KB-27's Westgard
 * evaluation is FEAT-019's own later scope, not this task's), so the
 * response shape below is deliberately smaller than `observationSchema` --
 * no refLow/refHigh/flags/status fields a QC row never meaningfully has yet.
 */
export const qcResultEntrySchema = resultEntrySchema;
export type QcResultEntryInput = z.infer<typeof qcResultEntrySchema>;

/**
 * Response shape for a QC observation -- `controlLotId`, not `orderedTestId`/
 * `patientId` (ADR-0015: these rows have neither). Every POST creates a new
 * row (proposal §5): a control lot's QC history is a time series of
 * measurements, not a single upsertable "current result" the way a patient
 * ordered-test analyte is -- so there is no draft/finalize/status lifecycle
 * here, unlike `observationSchema`.
 */
export const qcObservationSchema = z
  .object({
    id: z.uuid(),
    controlLotId: z.uuid(),
    analyteId: z.uuid(),
    dataType: resultEntryDataTypeSchema,
    valueNum: z.number().nullable(),
    valueCode: z.string().nullable(),
    valueText: z.string().nullable(),
    unit: z.string().nullable(),
    source: z.string(),
    producedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "QcObservationDto" });
export type QcObservationResult = z.infer<typeof qcObservationSchema>;
