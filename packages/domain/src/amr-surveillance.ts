import { z } from "zod";

/**
 * FEAT-055 (docs/plans/feat-055-amr-surveillance-report.md). One row per
 * organism-antimicrobial pair actually observed in the date range (proposal
 * §1, the literal KB-44 AMR-surveillance example) -- `resistantPct` is
 * computed over `susceptibleCount + intermediateCount + resistantCount`
 * (the only three interpretations `susceptibilityInterpretationSchema`
 * defines), not a separate denominator.
 */
export const amrSurveillanceEntrySchema = z.object({
  organismId: z.uuid(),
  organismDisplay: z.string(),
  antimicrobialId: z.uuid(),
  antimicrobialDisplay: z.string(),
  susceptibleCount: z.number(),
  intermediateCount: z.number(),
  resistantCount: z.number(),
  total: z.number(),
  resistantPct: z.number(),
});
export type AmrSurveillanceEntry = z.infer<typeof amrSurveillanceEntrySchema>;

export const amrSurveillanceReportSchema = z.object({
  entries: z.array(amrSurveillanceEntrySchema),
});
export type AmrSurveillanceReport = z.infer<typeof amrSurveillanceReportSchema>;
