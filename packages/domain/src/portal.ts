import { z } from "zod";

/**
 * FEAT-039: `GET /v1/portal/results`'s response shape -- own-verified-
 * results-and-trends, per analyte (proposal §2/§8).
 */
export const portalResultEntrySchema = z.object({
  observationId: z.uuid(),
  producedAt: z.string(),
  value: z.string(),
  unit: z.string(),
  flags: z.array(z.string()),
  referenceRangeText: z.string(),
  isCritical: z.boolean(),
});
export type PortalResultEntry = z.infer<typeof portalResultEntrySchema>;

export const portalAnalyteResultsSchema = z.object({
  analyteId: z.uuid(),
  analyteDisplay: z.string(),
  latest: portalResultEntrySchema,
  trend: z.array(portalResultEntrySchema),
});
export type PortalAnalyteResults = z.infer<typeof portalAnalyteResultsSchema>;

export const portalResultsResponseSchema = z.object({
  analytes: z.array(portalAnalyteResultsSchema),
});
export type PortalResultsResponse = z.infer<typeof portalResultsResponseSchema>;
