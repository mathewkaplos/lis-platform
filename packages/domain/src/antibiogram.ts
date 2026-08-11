import { z } from "zod";
import { susceptibilityInterpretationSchema } from "./microbiology-catalog";

/**
 * FEAT-053 (docs/plans/feat-053-susceptibility-interpretation-antibiogram.md).
 * "Recording an antibiogram is one all-at-once human action" (proposal §5/
 * §10 Q3, approved) -- every antimicrobial's own MIC entered together, one
 * submit, not incremental per-antimicrobial entry.
 */

export const recordAntibiogramEntrySchema = z.object({
  antimicrobialId: z.uuid(),
  /** A real, technologist-entered MIC value in mg/L -- the raw measurement,
   * not the interpretation. `resolveSusceptibility` computes S/I/R from
   * this server-side; the caller never supplies an interpretation
   * directly. */
  micValue: z.number().positive(),
});
export type RecordAntibiogramEntry = z.infer<typeof recordAntibiogramEntrySchema>;

export const recordAntibiogramInputSchema = z.object({
  results: z.array(recordAntibiogramEntrySchema).min(1),
});
export type RecordAntibiogramInput = z.infer<typeof recordAntibiogramInputSchema>;

export const antibiogramResultEntrySchema = z.object({
  antimicrobialId: z.uuid(),
  antimicrobialDisplay: z.string(),
  micValue: z.number(),
  interpretation: susceptibilityInterpretationSchema,
  observationId: z.uuid(),
});
export type AntibiogramResultEntry = z.infer<typeof antibiogramResultEntrySchema>;

/**
 * Dual-emission response (KB-21): `tableObservationId` is the readable grid
 * (one `table` Observation, `dataType: 'table'`, holding every entry below
 * in its own `valueJson`); `results` are the discrete coded S/I/R
 * Observations, one per antimicrobial, each independently queryable via the
 * normal `observation.analyteId` join -- the literal "all
 * carbapenem-resistant E. coli this quarter" AC.
 */
export const antibiogramResultSchema = z.object({
  organismId: z.uuid(),
  organismDisplay: z.string(),
  tableObservationId: z.uuid(),
  results: z.array(antibiogramResultEntrySchema),
});
export type AntibiogramResult = z.infer<typeof antibiogramResultSchema>;
