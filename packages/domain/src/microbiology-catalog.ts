import { z } from "zod";

/**
 * FEAT-051 (docs/plans/feat-051-microbiology-organism-breakpoint-catalog.md,
 * ADR-0045). Matches `packages/domain/src/catalog.ts`'s own established
 * pattern (schema + inferred type pairs, `xResultSchema`/`XResult` naming).
 */

export const organismResultSchema = z.object({
  id: z.uuid(),
  snomedCode: z.string(),
  display: z.string(),
});
export type OrganismResult = z.infer<typeof organismResultSchema>;

export const antimicrobialResultSchema = z.object({
  id: z.uuid(),
  atcCode: z.string(),
  display: z.string(),
});
export type AntimicrobialResult = z.infer<typeof antimicrobialResultSchema>;

export const breakpointTableResultSchema = z.object({
  id: z.uuid(),
  publisher: z.string(),
  version: z.string(),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable(),
  sourceUrl: z.string(),
});
export type BreakpointTableResult = z.infer<typeof breakpointTableResultSchema>;

/**
 * v1 scope (approved): MIC-based only, `method` is always `'MIC'` this
 * feature's own seed data ever populates. `susceptibleMax`/`resistantMin`
 * are numeric-as-string (matches `reference_range.low`/`.high`'s own
 * established convention for Postgres `numeric` columns).
 */
export const breakpointResultSchema = z.object({
  id: z.uuid(),
  breakpointTableId: z.uuid(),
  organismId: z.uuid(),
  antimicrobialId: z.uuid(),
  method: z.string(),
  susceptibleMax: z.string(),
  resistantMin: z.string(),
  sourceNote: z.string().nullable(),
});
export type BreakpointResult = z.infer<typeof breakpointResultSchema>;

export const microbiologyCatalogSchema = z.object({
  organisms: z.array(organismResultSchema),
  antimicrobials: z.array(antimicrobialResultSchema),
  breakpointTables: z.array(breakpointTableResultSchema),
  breakpoints: z.array(breakpointResultSchema),
});
export type MicrobiologyCatalog = z.infer<typeof microbiologyCatalogSchema>;

/**
 * S/I/R interpretation of a real MIC value (mg/L) against a resolved
 * breakpoint's own thresholds -- standard EUCAST logic: MIC ≤ susceptibleMax
 * is Susceptible, MIC > resistantMin is Resistant, otherwise Intermediate.
 * EUCAST's own Area of Technical Uncertainty is not modeled as a separate
 * state in this v1 schema (see db/seed/microbiology-catalog.sql's own
 * header comment) -- folded into this same three-way result.
 */
export const susceptibilityInterpretationSchema = z.enum(["S", "I", "R"]);
export type SusceptibilityInterpretation = z.infer<
  typeof susceptibilityInterpretationSchema
>;
