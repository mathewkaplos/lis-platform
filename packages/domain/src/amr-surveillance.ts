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

/**
 * FEAT-056 (docs/plans/feat-056-cross-tenant-deidentified-aggregation.md,
 * ADR-0048). `month` (not an arbitrary `from`/`to` range) is the query
 * granularity itself -- ADR-0048 decision 6's own "coarsened to monthly
 * minimum, never daily/weekly" is enforced by the request shape, not by a
 * server-side rounding step a caller could route around by asking for a
 * narrower window.
 */
export const networkAmrSurveillanceQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM"),
});
export type NetworkAmrSurveillanceQuery = z.infer<typeof networkAmrSurveillanceQuerySchema>;

/**
 * ADR-0048 decision 5: every count field is `null` when `suppressed: true`
 * -- never a fabricated/rounded number standing in for a real one below the
 * n<5 threshold. No `organismId`/`antimicrobialId`/tenant/facility field
 * anywhere in this shape (decision 4): display names only, a presentation
 * artifact, not an API type meant for further joins back to internal ids.
 */
export const networkAmrSurveillanceEntrySchema = z.object({
  organismDisplay: z.string(),
  antimicrobialDisplay: z.string(),
  timeBucket: z.string(),
  suppressed: z.boolean(),
  susceptibleCount: z.number().nullable(),
  intermediateCount: z.number().nullable(),
  resistantCount: z.number().nullable(),
  totalCount: z.number().nullable(),
});
export type NetworkAmrSurveillanceEntry = z.infer<typeof networkAmrSurveillanceEntrySchema>;

export const networkAmrSurveillanceReportSchema = z.object({
  entries: z.array(networkAmrSurveillanceEntrySchema),
});
export type NetworkAmrSurveillanceReport = z.infer<typeof networkAmrSurveillanceReportSchema>;
