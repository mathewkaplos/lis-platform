import { z } from "zod";

/**
 * `apps/interop`'s internal ORU-data read shape (FEAT-036, AC #2) --
 * everything `OruBuilderService` needs to build a real ORU^R01 message from
 * an already-verified Observation (KB-30's OBX-3/5/6/7/8 mapping: analyte
 * code, typed value, unit, reference range, flag). Deliberately not the
 * `Observation`/`ObservationResult` domain shape itself -- this is a
 * purpose-built read projection (same reasoning `ChemistryReportInput`
 * already established for report assembly), scoped to exactly what an ORU
 * needs, not a general-purpose observation DTO.
 *
 * v1 scope: one Observation -> one ORU with exactly one OBX segment,
 * mirroring the inbound ORM mapper's own single-OBR simplification -- a
 * real multi-analyte ORU (one message per verified panel, not per
 * analyte) is a deliberately deferred follow-up, same reasoning as the
 * inbound side's single-test-per-message scope.
 */
export const interopOruDataSchema = z.object({
  patientMrn: z.string(),
  patientFirstName: z.string(),
  patientLastName: z.string(),
  analyteCode: z.string(),
  analyteDisplay: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
  refLow: z.number().nullable(),
  refHigh: z.number().nullable(),
  flags: z.array(z.string()),
  verifiedAt: z.iso.datetime(),
});
export type InteropOruData = z.infer<typeof interopOruDataSchema>;
